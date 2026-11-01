/* Pinned PG17 sequence CONFIG metadata only. Stock rendering, OWNED BY, ACLs
 * and dumpSequenceData stay untouched. Included after the function helper so
 * both readers use one aggregate128-result/128MiB accounting domain. */
static PGresult *ca_sequence_results[CA_FUNCTION_BATCH_MAX];
static size_t ca_sequence_result_bytes[CA_FUNCTION_BATCH_MAX];
static Oid ca_sequence_oids[CA_FUNCTION_BATCH_MAX];
static int ca_sequence_count, ca_sequence_next;
static bool ca_sequence_cleanup_registered;

static void
ca_sequence_batch_clear(void)
{
    int i;
    for (i = 0; i < CA_FUNCTION_BATCH_MAX; i++)
        if (ca_sequence_results[i] != NULL)
        {
            ca_metadata_release(ca_sequence_result_bytes[i]);
            PQclear(ca_sequence_results[i]);
            ca_sequence_results[i] = NULL;
        }
}

static PGresult *
ca_sequence_batch_result(Archive *fout, const TableInfo *tbinfo,
                         const char *stock_query)
{
    static const char *columns[] = {"format_type", "seqstart", "seqincrement",
        "seqmax", "seqmin", "seqcache", "seqcycle"};
    PGresult *result;
    int i;
    /* The older server branch remains the original stock reader. */
    if (fout->remoteVersion < 100000)
        return ExecuteSqlQuery(fout, stock_query, PGRES_TUPLES_OK);
    /* Never overlap caches. The returned singleton remains stock-owned and is
     * checked together with all live cached results before handing it back. */
    if (ca_metadata_cache_owner == 1)
    {
        size_t bytes;
        result = ExecuteSqlQuery(fout, stock_query, PGRES_TUPLES_OK);
        if (!ca_metadata_result(result, columns, lengthof(columns), &bytes))
        {
            PQclear(result);
            pg_fatal("ISOLATED_SEQUENCE_BATCH_RESULT");
        }
        return result;
    }
    if (!ca_sequence_cleanup_registered)
    {
        if (atexit(ca_sequence_batch_clear) != 0)
            pg_fatal("ISOLATED_SEQUENCE_BATCH_CLEANUP");
        ca_sequence_cleanup_registered = true;
    }
    if (ca_sequence_next == ca_sequence_count)
    {
        PQExpBuffer batch = createPQExpBuffer();
        int received = 0;
        ca_sequence_count = ca_sequence_next = 0;
        for (i = ca_batch_position; i < ca_batch_objects_count &&
             ca_sequence_count < CA_FUNCTION_BATCH_MAX; i++)
        {
            DumpableObject *object = ca_batch_objects[i];
            const TableInfo *table;
            if (object->objType != DO_TABLE ||
                (object->dump & object->components & DUMP_COMPONENT_DEFINITION) == 0)
                continue;
            table = (const TableInfo *) object;
            if (table->relkind != RELKIND_SEQUENCE)
                continue;
            ca_sequence_oids[ca_sequence_count++] = object->catId.oid;
            appendPQExpBuffer(batch,
                "SELECT format_type(seqtypid, NULL), seqstart, seqincrement, "
                "seqmax, seqmin, seqcache, seqcycle FROM pg_catalog.pg_sequence "
                "WHERE seqrelid = '%u'::oid;", object->catId.oid);
        }
        if (ca_sequence_count == 0 || ca_sequence_oids[0] != tbinfo->dobj.catId.oid)
            pg_fatal("ISOLATED_SEQUENCE_BATCH_ORDER");
        ca_diag_query_begin();
        if (!PQsendQuery(GetConnection(fout), batch->data))
            pg_fatal("ISOLATED_SEQUENCE_BATCH_SEND");
        destroyPQExpBuffer(batch);
        while ((result = PQgetResult(GetConnection(fout))) != NULL)
        {
            size_t bytes = 0;
            bool valid = received < ca_sequence_count &&
                ca_metadata_result(result, columns, lengthof(columns), &bytes);
            if (!valid)
            {
                PQclear(result);
                while ((result = PQgetResult(GetConnection(fout))) != NULL)
                    PQclear(result);
                ca_sequence_batch_clear();
                pg_fatal("ISOLATED_SEQUENCE_BATCH_RESULT");
            }
            ca_metadata_hold(bytes, 2);
            ca_sequence_result_bytes[received] = bytes;
            ca_sequence_results[received++] = result;
        }
        ca_diag_query_end();
        if (received != ca_sequence_count)
            pg_fatal("ISOLATED_SEQUENCE_BATCH_COUNT");
    }
    if (ca_sequence_next >= ca_sequence_count ||
        ca_sequence_oids[ca_sequence_next] != tbinfo->dobj.catId.oid)
        pg_fatal("ISOLATED_SEQUENCE_BATCH_ORDER");
    result = ca_sequence_results[ca_sequence_next];
    ca_metadata_release(ca_sequence_result_bytes[ca_sequence_next]);
    ca_sequence_results[ca_sequence_next++] = NULL;
    return result; /* Original dumpSequence renders and clears this row. */
}
