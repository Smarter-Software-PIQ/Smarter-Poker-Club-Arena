/* Transport batching for the guarded PostgreSQL17.11 dumpFunc reader.
 * Included only by pg_dump.c. SQL statements, snapshot and rendering stay stock.
 * Read ahead selected DO_FUNC metadata only; stock rendering never moves.
 * This intentionally supersedes the selected-nonfunction batch barrier: the
 * pinned dumpFunc SELECT reads a stable catalog snapshot with the same secured
 * search_path/session state throughout the object loop. Sequence CONFIG reads
 * share the aggregate cache budget below; all stock rendering/ACL paths and
 * aggregate readers remain unchanged.
 */
#define CA_FUNCTION_BATCH_MAX 128
#define CA_FUNCTION_BATCH_BYTES (128 * 1024 * 1024)
static DumpableObject **ca_batch_objects;
static int ca_batch_position;
static int ca_batch_objects_count;
static PGresult *ca_batch_results[CA_FUNCTION_BATCH_MAX];
static Oid ca_batch_oids[CA_FUNCTION_BATCH_MAX];
static int ca_batch_count;
static int ca_batch_next;
static bool ca_batch_cleanup_registered;
/* One aggregate bound, never two independent 128-result/128MiB caches. */
static size_t ca_metadata_cached_bytes;
static int ca_metadata_cached_results;
static int ca_metadata_cache_owner; /* 0 empty, 1 function, 2 sequence */
static size_t ca_batch_result_bytes[CA_FUNCTION_BATCH_MAX];

static bool
ca_metadata_can_hold(size_t bytes)
{
    return ca_metadata_cached_results < CA_FUNCTION_BATCH_MAX &&
        bytes <= CA_FUNCTION_BATCH_BYTES - ca_metadata_cached_bytes;
}

static void
ca_metadata_hold(size_t bytes, int owner)
{
    if (!ca_metadata_can_hold(bytes) ||
        (ca_metadata_cache_owner != 0 && ca_metadata_cache_owner != owner))
        pg_fatal("ISOLATED_METADATA_CACHE_BOUND");
    ca_metadata_cached_results++;
    ca_metadata_cached_bytes += bytes;
    ca_metadata_cache_owner = owner;
}

static void
ca_metadata_release(size_t bytes)
{
    if (ca_metadata_cached_results <= 0 || bytes > ca_metadata_cached_bytes)
        pg_fatal("ISOLATED_METADATA_CACHE_RELEASE");
    ca_metadata_cached_results--;
    ca_metadata_cached_bytes -= bytes;
    if (ca_metadata_cached_results == 0)
        ca_metadata_cache_owner = 0;
}

static bool
ca_metadata_result(PGresult *result, const char *const *columns, int count,
                   size_t *bytes)
{
    int field;
    *bytes = 0;
    if (PQresultStatus(result) != PGRES_TUPLES_OK ||
        PQntuples(result) != 1 || PQnfields(result) != count)
        return false;
    for (field = 0; field < count; field++)
    {
        if (strcmp(PQfname(result, field), columns[field]) != 0)
            return false;
        *bytes += PQgetlength(result, 0, field);
    }
    return ca_metadata_can_hold(*bytes);
}

static void
ca_function_batch_clear(void)
{
    int i;
    for (i = 0; i < CA_FUNCTION_BATCH_MAX; i++)
        if (ca_batch_results[i] != NULL)
        {
            ca_metadata_release(ca_batch_result_bytes[i]);
            PQclear(ca_batch_results[i]);
            ca_batch_results[i] = NULL;
        }
}

static PGresult *
ca_function_batch_result(Archive *fout, const FuncInfo *finfo, const char *stock_query)
{
    PGresult *result;
    int i;
    static const char *columns[] = {
        "proretset", "prosrc", "probin", "provolatile", "proisstrict",
        "prosecdef", "lanname", "proconfig", "procost", "prorows",
        "funcargs", "funciargs", "funcresult", "proleakproof", "protrftypes",
        "proparallel", "prokind", "prosupport", "prosqlbody"
    };
    /* A live sequence batch keeps its exclusive cache; use the exact stock
     * singleton query and validate its result against the remaining total cap. */
    if (ca_metadata_cache_owner == 2)
    {
        size_t bytes;
        result = ExecuteSqlQueryForSingleRow(fout, stock_query);
        if (!ca_metadata_result(result, columns, lengthof(columns), &bytes))
        {
            PQclear(result);
            pg_fatal("ISOLATED_FUNCTION_BATCH_RESULT");
        }
        return result;
    }
    if (!ca_batch_cleanup_registered)
    {
        if (atexit(ca_function_batch_clear) != 0)
            pg_fatal("ISOLATED_FUNCTION_BATCH_CLEANUP");
        ca_batch_cleanup_registered = true;
    }
    if (ca_batch_next == ca_batch_count)
    {
        PQExpBuffer batch = createPQExpBuffer();
        int received = 0;
        ca_batch_count = ca_batch_next = 0;
        for (i = ca_batch_position; i < ca_batch_objects_count && ca_batch_count < CA_FUNCTION_BATCH_MAX; i++)
        {
            DumpableObject *object = ca_batch_objects[i];
            if ((object->dump & object->components) == 0)
                continue;
            if (object->objType != DO_FUNC)
                continue;
            ca_batch_oids[ca_batch_count++] = object->catId.oid;
            appendPQExpBuffer(batch, "EXECUTE dumpFunc('%u');", object->catId.oid);
        }
        if (ca_batch_count == 0 || ca_batch_oids[0] != finfo->dobj.catId.oid)
            pg_fatal("ISOLATED_FUNCTION_BATCH_ORDER");
        ca_diag_query_begin();
        if (!PQsendQuery(GetConnection(fout), batch->data))
            pg_fatal("ISOLATED_FUNCTION_BATCH_SEND");
        destroyPQExpBuffer(batch);
        /* Drain the complete command before another stock query can execute. */
        while ((result = PQgetResult(GetConnection(fout))) != NULL)
        {
            size_t bytes = 0;
            bool valid = received < ca_batch_count &&
                ca_metadata_result(result, columns, lengthof(columns), &bytes);
            if (!valid)
            {
                PQclear(result);
                while ((result = PQgetResult(GetConnection(fout))) != NULL)
                    PQclear(result);
                ca_function_batch_clear();
                pg_fatal("ISOLATED_FUNCTION_BATCH_RESULT");
            }
            ca_metadata_hold(bytes, 1);
            ca_batch_result_bytes[received] = bytes;
            ca_batch_results[received++] = result;
        }
        ca_diag_query_end();
        if (received != ca_batch_count)
            pg_fatal("ISOLATED_FUNCTION_BATCH_COUNT");
    }
    if (ca_batch_next >= ca_batch_count || ca_batch_oids[ca_batch_next] != finfo->dobj.catId.oid)
        pg_fatal("ISOLATED_FUNCTION_BATCH_ORDER");
    result = ca_batch_results[ca_batch_next];
    ca_metadata_release(ca_batch_result_bytes[ca_batch_next]);
    ca_batch_results[ca_batch_next++] = NULL;
    /* Stock dumpFunc owns the returned result and clears it after rendering. */
    return result;
}
