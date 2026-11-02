/* Exact PG17 format_type metadata requests, streamed into the ORIGINAL
 * TypeInfo.ftypname cache. No fourth retained PGresult cache is introduced.
 * Called only after stock zero-OID and already-cached-name handling. */
static TypeInfo *ca_type_name_pending[CA_FUNCTION_BATCH_MAX];
static int ca_type_name_pending_count;
static size_t ca_type_name_copied_bytes;
static PGresult *ca_type_name_inflight;
static bool ca_type_name_cleanup_registered;

static void
ca_type_name_partial_clear(void)
{
    int i;
    if (ca_type_name_inflight != NULL)
    {
        PQclear(ca_type_name_inflight);
        ca_type_name_inflight = NULL;
    }
    for (i = 0; i < ca_type_name_pending_count; i++)
    {
        pg_free(ca_type_name_pending[i]->ftypname);
        ca_type_name_pending[i]->ftypname = NULL;
        ca_type_name_pending[i] = NULL;
    }
    ca_type_name_pending_count = 0;
    ca_type_name_copied_bytes = 0;
}

static bool
ca_type_name_batch_prefetch(Archive *fout, Oid requested_oid)
{
    static const char *columns[] = {"format_type"};
    Oid oids[CA_FUNCTION_BATCH_MAX];
    int count = 0, received = 0, i, j;
    bool current_argument = false;
    FuncInfo *current;
    TypeInfo *requested;
    PQExpBuffer query;
    PGresult *result;

    /* Unknown callers keep the complete stock singleton path. TypeInfo dump
     * flags are NOT a selector: selected functions can use built-in/excluded
     * types whose formatted names must still be available to stock rendering. */
    if (requested_oid == 0 || fout->remoteVersion < 170000 ||
        fout->remoteVersion >= 180000 || ca_batch_position < 0 ||
        ca_batch_position >= ca_batch_objects_count)
        return false;
    if ((ca_batch_objects[ca_batch_position]->dump &
         ca_batch_objects[ca_batch_position]->components) == 0 ||
        (ca_batch_objects[ca_batch_position]->objType != DO_FUNC &&
         ca_batch_objects[ca_batch_position]->objType != DO_AGG))
        return false;
    current = (FuncInfo *) ca_batch_objects[ca_batch_position];
    /* AggInfo begins with its FuncInfo aggfn in the pinned upstream layout. */
    for (i = 0; i < current->nargs; i++)
        if (current->argtypes[i] == requested_oid)
            current_argument = true;
    requested = findTypeByOid(requested_oid);
    if (!current_argument || requested == NULL || requested->ftypname != NULL)
        return false;
    if (ca_type_name_pending_count != 0 || ca_type_name_inflight != NULL)
        pg_fatal("ISOLATED_TYPE_NAME_BATCH_REENTRY");
    if (!ca_type_name_cleanup_registered)
    {
        if (atexit(ca_type_name_partial_clear) != 0)
            pg_fatal("ISOLATED_TYPE_NAME_BATCH_CLEANUP");
        ca_type_name_cleanup_registered = true;
    }
    oids[count++] = requested_oid;
    for (i = ca_batch_position; i < ca_batch_objects_count &&
         count < CA_FUNCTION_BATCH_MAX; i++)
    {
        DumpableObject *object = ca_batch_objects[i];
        FuncInfo *function;
        if ((object->dump & object->components) == 0 ||
            (object->objType != DO_FUNC && object->objType != DO_AGG))
            continue;
        function = (FuncInfo *) object;
        for (j = 0; j < function->nargs && count < CA_FUNCTION_BATCH_MAX; j++)
        {
            Oid oid = function->argtypes[j];
            TypeInfo *type = oid == 0 ? NULL : findTypeByOid(oid);
            int k;
            if (type == NULL || type->ftypname != NULL)
                continue;
            for (k = 0; k < count; k++)
                if (oids[k] == oid)
                    break;
            if (k == count)
                oids[count++] = oid;
        }
    }
    query = createPQExpBuffer();
    for (i = 0; i < count; i++)
        appendPQExpBuffer(query,
            "SELECT pg_catalog.format_type('%u'::pg_catalog.oid, NULL);", oids[i]);
    ca_diag_query_begin_subtype(10); /* Actual TYPE_NAME network request. */
    if (!PQsendQuery(GetConnection(fout), query->data))
    {
        destroyPQExpBuffer(query);
        pg_fatal("ISOLATED_TYPE_NAME_BATCH_SEND");
    }
    destroyPQExpBuffer(query);
    while ((result = PQgetResult(GetConnection(fout))) != NULL)
    {
        size_t bytes = 0, remaining;
        TypeInfo *type = received < count ? findTypeByOid(oids[received]) : NULL;
        bool valid = received < count && type != NULL && type->ftypname == NULL &&
            ca_metadata_result(result, columns, lengthof(columns), &bytes) &&
            !PQgetisnull(result, 0, 0) && bytes > 0;
        ca_type_name_inflight = result;
        /* Existing live PGresult bytes + ALL names copied by this request +
         * the incoming row and its pending C-string copy share the same cap.
         * Each PGresult is cleared before the next is obtained. */
        remaining = CA_FUNCTION_BATCH_BYTES - ca_metadata_cached_bytes;
        if (valid)
            valid = ca_type_name_copied_bytes <= remaining &&
                bytes < remaining - ca_type_name_copied_bytes &&
                bytes + 1 <= remaining - ca_type_name_copied_bytes - bytes;
        if (!valid)
        {
            ca_type_name_partial_clear();
            while ((result = PQgetResult(GetConnection(fout))) != NULL)
                PQclear(result);
            pg_fatal("ISOLATED_TYPE_NAME_BATCH_RESULT");
        }
        type->ftypname = pg_strdup(PQgetvalue(result, 0, 0));
        ca_type_name_pending[ca_type_name_pending_count++] = type;
        ca_type_name_copied_bytes += bytes + 1;
        PQclear(result);
        ca_type_name_inflight = NULL;
        received++;
    }
    ca_diag_query_end();
    if (received != count)
    {
        ca_type_name_partial_clear();
        pg_fatal("ISOLATED_TYPE_NAME_BATCH_COUNT");
    }
    /* Successful names now belong only to upstream TypeInfo, exactly as the
     * stock reader's pg_strdup assignment. Partial operations retain no names. */
    for (i = 0; i < ca_type_name_pending_count; i++)
        ca_type_name_pending[i] = NULL;
    ca_type_name_pending_count = 0;
    ca_type_name_copied_bytes = 0;
    return true;
}
