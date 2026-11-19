# Qualification client only. Never a production database/engine image.
FROM docker.io/library/node@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 AS node_runtime
FROM ghcr.io/supabase/postgres@sha256:178f0976b54a39237096bfa310c1a352dbc82fb1b08dda45cdb8acb5d40c1426
USER root
# The build never waits on one Ubuntu mirror (2026-11-19). archive.ubuntu.com
# stalled this step past its 8 minutes from 06:33 UTC; pinning the in-region
# azure mirror instead then failed outright on runners that cannot reach it.
# The sources read a mirror list, so apt's mirror method fails over between
# hosts, and every request is bounded and retried: one slow or unreachable
# mirror is a failover, never a hang and never a missing package.
RUN printf 'http://archive.ubuntu.com/ubuntu\tpriority:1\nhttp://azure.archive.ubuntu.com/ubuntu\tpriority:2\nhttp://us.archive.ubuntu.com/ubuntu\tpriority:3\n' > /etc/apt/ca-ubuntu-mirrors.txt \
 && for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do if [ -f "$f" ]; then sed -i -E 's#https?://([a-z0-9-]+\.)*(archive|security)\.ubuntu\.com/ubuntu/?#mirror+file:/etc/apt/ca-ubuntu-mirrors.txt#g' "$f"; fi; done \
 && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\n' > /etc/apt/apt.conf.d/80-bounded-retries \
 && apt-get update && apt-get install --no-install-recommends -y build-essential libssl-dev bison flex perl bzip2 pkg-config && rm -rf /var/lib/apt/lists/*
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY postgresql-17.11.tar.bz2 /opt/native-build/source.tar.bz2
COPY pg_dump-batched.c /opt/native-build/pg_dump-batched.c
# Stock recursive prerequisites rebuild the same common/port archives.
# Serialize both builds so libpq is never linked against a partial archive.
RUN cd /opt/native-build && echo 'dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979  source.tar.bz2' | sha256sum -c - && tar -xjf source.tar.bz2 && cd postgresql-17.11 && echo '8576b36741608e0a956b51e98e1b41b76877a95eb9091300b66c2eaa0faf78f8  src/bin/pg_dump/pg_dump.c' | sha256sum -c - && ./configure --prefix=/opt/lb-native --without-icu --without-readline --without-zlib --without-lz4 --without-zstd --with-ssl=openssl LDFLAGS='-Wl,-rpath,/opt/lb-native/lib' && make -C src/backend generated-headers && make -C src/bin/pg_dump -j1 && make -C src/interfaces/libpq install && mkdir -p /opt/lb-native/bin && cp src/bin/pg_dump/pg_dump /opt/lb-native/bin/pg_dump-stock && cp /opt/native-build/pg_dump-batched.c src/bin/pg_dump/pg_dump.c && make -C src/bin/pg_dump -j1 && cp src/bin/pg_dump/pg_dump /opt/lb-native/bin/pg_dump && rm -rf /opt/native-build
LABEL io.smarter.leaderboard.native-source="8576b36741608e0a956b51e98e1b41b76877a95eb9091300b66c2eaa0faf78f8"
