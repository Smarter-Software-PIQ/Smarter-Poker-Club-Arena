/* Transport batching for the guarded PostgreSQL17.11 dumpFunc reader.
 * Included only by pg_dump.c. SQL statements, snapshot and rendering stay stock.
 * Read ahead selected DO_FUNC metadata only; stock rendering never moves.
 * This intentionally supersedes the selected-nonfunction batch barrier: the
 * pinned dumpFunc SELECT reads a stable catalog snapshot with the same secured
 * search_path/session state throughout the object loop. Other object readers,
 * including aggregates, still run through their unchanged stock paths.
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

static void
ca_function_batch_clear(void)
{
    int i;
    for (i = 0; i < CA_FUNCTION_BATCH_MAX; i++)
        if (ca_batch_results[i] != NULL)
        {
            PQclear(ca_batch_results[i]);
            ca_batch_results[i] = NULL;
        }
}

static PGresult *
ca_function_batch_result(Archive *fout, const FuncInfo *finfo)
{
    PGresult *result;
    int i;
    if (!ca_batch_cleanup_registered)
    {
        if (atexit(ca_function_batch_clear) != 0)
            pg_fatal("ISOLATED_FUNCTION_BATCH_CLEANUP");
        ca_batch_cleanup_registered = true;
    }
    if (ca_batch_next == ca_batch_count)
    {
        PQExpBuffer batch = createPQExpBuffer();
        size_t bytes = 0;
        int received = 0;
        static const char *columns[] = {
            "proretset", "prosrc", "probin", "provolatile", "proisstrict",
            "prosecdef", "lanname", "proconfig", "procost", "prorows",
            "funcargs", "funciargs", "funcresult", "proleakproof", "protrftypes",
            "proparallel", "prokind", "prosupport", "prosqlbody"
        };
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
            int field;
            bool valid = received < ca_batch_count &&
                PQresultStatus(result) == PGRES_TUPLES_OK && PQntuples(result) == 1 &&
                PQnfields(result) == (int) lengthof(columns);
            if (valid)
                for (field = 0; field < (int) lengthof(columns); field++)
                {
                    if (strcmp(PQfname(result, field), columns[field]) != 0)
                        valid = false;
                    bytes += PQgetlength(result, 0, field);
                }
            if (!valid || bytes > CA_FUNCTION_BATCH_BYTES)
            {
                PQclear(result);
                while ((result = PQgetResult(GetConnection(fout))) != NULL)
                    PQclear(result);
                for (i = 0; i < received; i++)
                {
                    PQclear(ca_batch_results[i]);
                    ca_batch_results[i] = NULL;
                }
                pg_fatal("ISOLATED_FUNCTION_BATCH_RESULT");
            }
            ca_batch_results[received++] = result;
        }
        ca_diag_query_end();
        if (received != ca_batch_count)
            pg_fatal("ISOLATED_FUNCTION_BATCH_COUNT");
    }
    if (ca_batch_next >= ca_batch_count || ca_batch_oids[ca_batch_next] != finfo->dobj.catId.oid)
        pg_fatal("ISOLATED_FUNCTION_BATCH_ORDER");
    result = ca_batch_results[ca_batch_next];
    ca_batch_results[ca_batch_next++] = NULL;
    /* Stock dumpFunc owns the returned result and clears it after rendering. */
    return result;
}
