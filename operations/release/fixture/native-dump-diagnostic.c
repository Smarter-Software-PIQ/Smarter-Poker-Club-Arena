/* Logging-only inclusion in the exact guarded PostgreSQL 17.11 client source.
 * No SQL, result, identifier, OID, settings or error text enters this channel.
 * No signal or exit handler is installed or replaced. */
#include <errno.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static struct timespec ca_diag_origin;
static unsigned long ca_diag_seq = 0;
static int ca_diag_object = 0;
static bool ca_diag_query = false;

void
ca_diag_init(void)
{
    struct sockaddr_storage peer;
    socklen_t size = sizeof(peer);
    struct stat details;
    if (fstat(3, &details) != 0 || !S_ISSOCK(details.st_mode) ||
        getpeername(3, (struct sockaddr *) &peer, &size) != 0 ||
        peer.ss_family != AF_UNIX || clock_gettime(CLOCK_MONOTONIC, &ca_diag_origin) != 0)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_FD");
}

static void
ca_diag_emit(char level, char boundary)
{
    static const char *const groups[] = {"OTHER", "FUNCTION", "RELATION", "TYPE", "OTHER"};
    struct timespec now;
    long long elapsed;
    char line[96];
    int length;
    size_t written = 0;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_CLOCK");
    elapsed = ((long long) now.tv_sec - ca_diag_origin.tv_sec) * 1000000LL +
        ((long long) now.tv_nsec - ca_diag_origin.tv_nsec) / 1000LL;
    if (++ca_diag_seq > 100000 || elapsed < 0 || elapsed > 45000000LL ||
        ca_diag_object < 1 || ca_diag_object > 4)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_RANGE");
    length = snprintf(line, sizeof(line), "D1 %lu %c %c %s %lld\n", ca_diag_seq,
                      level, boundary, groups[ca_diag_object], elapsed);
    if (length <= 0 || length >= sizeof(line))
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_FRAME");
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

static void
ca_diag_query_begin(void)
{
    if (ca_diag_object == 0)
        return;
    if (ca_diag_query)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_PAIR");
    ca_diag_query = true;
    ca_diag_emit('Q', 'B');
}

static void
ca_diag_query_end(void)
{
    if (ca_diag_object == 0)
        return;
    if (!ca_diag_query)
        pg_fatal("ISOLATED_DUMP_DIAGNOSTIC_PAIR");
    ca_diag_emit('Q', 'E');
    ca_diag_query = false;
}
