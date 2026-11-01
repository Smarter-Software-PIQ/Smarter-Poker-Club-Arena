/* Logging-only inclusion in the exact guarded PostgreSQL 17.11 client source.
 * No SQL, result, identifier, OID, settings or error text enters this channel.
 * No signal or exit handler is installed or replaced. */
#include <errno.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static struct timespec ca_diag_origin;
static unsigned long ca_diag_seq = 0;
static int ca_diag_object = 0;
static bool ca_diag_query = false;
static int ca_diag_subtype = 0;

void
ca_diag_init(void)
{
    struct sockaddr_storage peer;
    socklen_t size = sizeof(peer);
    struct stat details;
    size_t written = 0;
    if (fstat(3, &details) != 0 || !S_ISSOCK(details.st_mode) ||
        getpeername(3, (struct sockaddr *) &peer, &size) != 0 ||
        peer.ss_family != AF_UNIX || clock_gettime(CLOCK_MONOTONIC, &ca_diag_origin) != 0)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_FD");
    while (written < 2)
    {
        ssize_t size = send(3, &"D4"[written], 2 - written, MSG_NOSIGNAL);
        if (size < 0 && errno == EINTR) continue;
        if (size <= 0) pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_WRITE");
        written += size;
    }
}

static void
ca_diag_emit(char level, char boundary)
{
    struct timespec now;
    long long elapsed;
    unsigned char line[8];
    const size_t length = sizeof(line);
    size_t written = 0;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_CLOCK");
    elapsed = ((long long) now.tv_sec - ca_diag_origin.tv_sec) * 1000000LL +
        ((long long) now.tv_nsec - ca_diag_origin.tv_nsec) / 1000LL;
    if (++ca_diag_seq > 100000 || elapsed < 0 || elapsed > 45000000LL ||
        ca_diag_object < 1 || ca_diag_object > 4)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_RANGE");
    /* One D4 stream header, then every original event in exactly eight bytes. */
    line[0] = (unsigned char) (ca_diag_seq >> 16);
    line[1] = (unsigned char) (ca_diag_seq >> 8);
    line[2] = (unsigned char) ca_diag_seq;
    line[3] = (unsigned char) ((level == 'Q' ? ca_diag_subtype << 4 : 0) |
                             ((ca_diag_object - 1) << 2) |
                             (level == 'Q' ? 2 : 0) | (boundary == 'E' ? 1 : 0));
    line[4] = (unsigned char) (elapsed >> 24);
    line[5] = (unsigned char) (elapsed >> 16);
    line[6] = (unsigned char) (elapsed >> 8);
    line[7] = (unsigned char) elapsed;
    while (written < (size_t) length)
    {
        ssize_t size = send(3, line + written, length - written, MSG_NOSIGNAL);
        if (size < 0 && errno == EINTR)
            continue;
        if (size <= 0)
            pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_WRITE");
        written += size;
    }
}

void
ca_diag_object_begin(int group)
{
    if (ca_diag_object != 0 || ca_diag_query || group < 1 || group > 4)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_PAIR");
    ca_diag_object = group;
    ca_diag_emit('O', 'B');
}

void
ca_diag_object_end(void)
{
    if (ca_diag_object == 0 || ca_diag_query)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_PAIR");
    ca_diag_emit('O', 'E');
    ca_diag_object = 0;
}

static bool
ca_diag_subtype_allowed(int subtype, int group)
{
    return !(subtype < 0 || subtype > 13 ||
        ((subtype >= 1 && subtype <= 3) && group != 1) ||
        ((subtype >= 4 && subtype <= 6) && group != 2) ||
        ((subtype == 8 || subtype == 9) && group != 2) ||
        (subtype == 7 && group != 2 && group != 4) ||
        (subtype == 13 && group != 3));
}

void
ca_diag_query_begin_subtype(int subtype)
{
    if (ca_diag_object == 0)
        return;
    if (ca_diag_query || !ca_diag_subtype_allowed(subtype, ca_diag_object))
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_PAIR");
    ca_diag_subtype = subtype;
    ca_diag_query = true;
    ca_diag_emit('Q', 'B');
}

void
ca_diag_query_end(void)
{
    if (ca_diag_object == 0)
        return;
    if (!ca_diag_query)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_PAIR");
    ca_diag_emit('Q', 'E');
    ca_diag_query = false;
    ca_diag_subtype = 0;
}


void
ca_diag_query_begin(void)
{
    ca_diag_query_begin_subtype(0); /* Unknown is explicit. */
}

/* Pinned, fixed prefixes only. Never retain or emit query text/identifiers. */
void
ca_diag_query_begin_sql(const char *query)
{
    int subtype = 0;
#define CA_PREFIX(text) (strncmp(query, text, sizeof(text) - 1) == 0)
    if (CA_PREFIX("PREPARE ")) subtype = 12;
    else if (CA_PREFIX("EXECUTE dumpFunc('")) subtype = 2;
    else if (CA_PREFIX("EXECUTE dumpAgg('")) subtype = 3;
    else if (CA_PREFIX("SELECT format_type(seqtypid, NULL), seqstart, seqincrement, seqmax, seqmin, seqcache, seqcycle FROM pg_catalog.pg_sequence WHERE seqrelid = '")) subtype = 5;
    else if (CA_PREFIX("EXECUTE getColumnACLs('")) subtype = 6;
    else if (CA_PREFIX("SELECT pg_catalog.pg_get_viewdef('")) subtype = 7;
    else if (CA_PREFIX("SELECT pg_get_partkeydef('")) subtype = 8;
    else if (CA_PREFIX("SELECT fs.srvname, pg_catalog.array_to_string(ARRAY(")) subtype = 9;
    else if (CA_PREFIX("SELECT pg_catalog.format_type('")) subtype = 10;
    else if (CA_PREFIX("SELECT e.extname FROM pg_catalog.pg_depend d, pg_catalog.pg_extension e ")) subtype = 11;
    else if (CA_PREFIX("EXECUTE dumpEnumType('") || CA_PREFIX("EXECUTE dumpRangeType('") ||
             CA_PREFIX("EXECUTE dumpBaseType('") || CA_PREFIX("EXECUTE dumpDomain('") ||
             CA_PREFIX("EXECUTE dumpCompositeType('")) subtype = 13;
#undef CA_PREFIX
    if (ca_diag_object != 0 && !ca_diag_subtype_allowed(subtype, ca_diag_object))
        subtype = 0;
    ca_diag_query_begin_subtype(subtype);
}
