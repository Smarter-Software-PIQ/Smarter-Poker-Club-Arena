/* Pinned PG17 view DEFINITION metadata only. Deferred rules keep the stock
 * reader. Same snapshot/secure search_path, exact per-OID SELECT and stock
 * deparse/render/ACL code. Function, sequence and view caches never overlap. */
static PGresult *ca_view_results[CA_FUNCTION_BATCH_MAX];
static size_t ca_view_result_bytes[CA_FUNCTION_BATCH_MAX];
static Oid ca_view_oids[CA_FUNCTION_BATCH_MAX];
static int ca_view_count, ca_view_next;
static bool ca_view_cleanup_registered;

static bool
ca_view_eligible(const DumpableObject *object)
{
    const TableInfo *table;
    if (object->objType != DO_TABLE ||
        (object->dump & object->components & DUMP_COMPONENT_DEFINITION) == 0)
        return false;
    table = (const TableInfo *) object;
    return (table->relkind == RELKIND_VIEW && !table->dummy_view) ||
        table->relkind == RELKIND_MATVIEW;
}

static bool
ca_view_result_valid(PGresult *result, size_t *bytes)
{
    static const char *columns[] = {"viewdef"};
    return ca_metadata_result(result, columns, lengthof(columns), bytes) &&
        !PQgetisnull(result, 0, 0) && PQgetlength(result, 0, 0) > 0;
}

static void
ca_view_batch_clear(void)
{
    int i;
    for (i = 0; i < CA_FUNCTION_BATCH_MAX; i++)
        if (ca_view_results[i] != NULL)
        {
            ca_metadata_release(ca_view_result_bytes[i]);
            PQclear(ca_view_results[i]);
            ca_view_results[i] = NULL;
        }
}

static PGresult *
ca_view_batch_result(Archive *fout, const TableInfo *tbinfo,
                     const char *stock_query)
{
    PGresult *result;
    int i;
    /* Only an exact current selected DO_TABLE caller can consume this cache.
     * Deferred DO_RULE calls, unknown eligibility and occupied sibling caches
     * remain fully drained stock singleton requests, under the TOTAL cap. */
    if (ca_batch_position < 0 || ca_batch_position >= ca_batch_objects_count ||
        ca_batch_objects[ca_batch_position] != &tbinfo->dobj ||
        !ca_view_eligible(ca_batch_objects[ca_batch_position]) ||
        (ca_metadata_cache_owner != 0 && ca_metadata_cache_owner != 3))
    {
        size_t bytes;
        result = ExecuteSqlQuery(fout, stock_query, PGRES_TUPLES_OK);
        if (!ca_view_result_valid(result, &bytes))
        {
            PQclear(result);
            pg_fatal("ISOLATED_VIEW_BATCH_RESULT");
        }
        return result;
    }
    if (!ca_view_cleanup_registered)
    {
        if (atexit(ca_view_batch_clear) != 0)
            pg_fatal("ISOLATED_VIEW_BATCH_CLEANUP");
        ca_view_cleanup_registered = true;
    }
    if (ca_view_next == ca_view_count)
    {
        PQExpBuffer batch = createPQExpBuffer();
        int received = 0;
        ca_view_count = ca_view_next = 0;
        for (i = ca_batch_position; i < ca_batch_objects_count &&
             ca_view_count < CA_FUNCTION_BATCH_MAX; i++)
        {
            DumpableObject *object = ca_batch_objects[i];
            if (!ca_view_eligible(object))
                continue;
            ca_view_oids[ca_view_count++] = object->catId.oid;
            appendPQExpBuffer(batch,
                "SELECT pg_catalog.pg_get_viewdef('%u'::pg_catalog.oid) AS viewdef;",
                object->catId.oid);
        }
        if (ca_view_count == 0 || ca_view_oids[0] != tbinfo->dobj.catId.oid)
            pg_fatal("ISOLATED_VIEW_BATCH_ORDER");
        /* Existing VIEW_DEFINITION tag denotes an actual network request,
         * including this bounded multi-statement request; D5 is unchanged. */
        ca_diag_query_begin_subtype(7);
        if (!PQsendQuery(GetConnection(fout), batch->data))
            pg_fatal("ISOLATED_VIEW_BATCH_SEND");
        destroyPQExpBuffer(batch);
        while ((result = PQgetResult(GetConnection(fout))) != NULL)
        {
            size_t bytes = 0;
            bool valid = received < ca_view_count &&
                ca_view_result_valid(result, &bytes);
            if (!valid)
            {
                PQclear(result);
                while ((result = PQgetResult(GetConnection(fout))) != NULL)
                    PQclear(result);
                ca_view_batch_clear();
                pg_fatal("ISOLATED_VIEW_BATCH_RESULT");
            }
            ca_metadata_hold(bytes, 3);
            ca_view_result_bytes[received] = bytes;
            ca_view_results[received++] = result;
        }
        ca_diag_query_end();
        if (received != ca_view_count)
            pg_fatal("ISOLATED_VIEW_BATCH_COUNT");
    }
    if (ca_view_next >= ca_view_count ||
        ca_view_oids[ca_view_next] != tbinfo->dobj.catId.oid)
        pg_fatal("ISOLATED_VIEW_BATCH_ORDER");
    result = ca_view_results[ca_view_next];
    ca_metadata_release(ca_view_result_bytes[ca_view_next]);
    ca_view_results[ca_view_next++] = NULL;
    return result; /* Stock createViewAsClause owns validation/render/clear. */
}
