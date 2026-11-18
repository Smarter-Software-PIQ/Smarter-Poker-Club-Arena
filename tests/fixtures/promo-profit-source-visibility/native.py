"""Qualify original PostgreSQL visibility across transactions and local statements."""
import subprocess


def qualify(db, check):
    check(
        "observation primitives stay private and the schema does not enable a new monetary authority",
        """SELECT NOT has_function_privilege('authenticated','fn_ca_promo_source_observation()','EXECUTE')
            AND NOT has_table_privilege('service_role','ca_promo_source_observation_cutover','INSERT')
            AND NOT has_sequence_privilege('anon','ca_promo_source_observation_order','USAGE')
            AND NOT EXISTS(SELECT 1 FROM ca_promo_source_observation_cutover)""",
        "t",
    )
    same = db.one("""
        BEGIN;
        CREATE TEMP TABLE original_observation AS SELECT * FROM fn_ca_promo_source_observation();
        INSERT INTO ca_promo_source_observation_cutover
        SELECT true, observation_order, writer_xid, visible_xids, observed_at
        FROM fn_ca_promo_source_observation();
        WITH later AS MATERIALIZED (SELECT * FROM fn_ca_promo_source_observation())
        SELECT NOT fn_ca_promo_source_observation_is_qualified(o.observation_order,o.writer_xid,o.visible_xids)
           AND fn_ca_promo_source_observation_is_qualified(l.observation_order,l.writer_xid,l.visible_xids)
           AND fn_ca_promo_source_version_visible(o.writer_xid,o.observation_order,l.writer_xid,l.observation_order,l.visible_xids)
           AND NOT fn_ca_promo_source_version_visible(l.writer_xid,l.observation_order,o.writer_xid,o.observation_order,o.visible_xids)
           AND NOT fn_ca_promo_source_version_visible(o.writer_xid,o.observation_order,o.writer_xid,o.observation_order,o.visible_xids)
        FROM original_observation o CROSS JOIN later l;
        ROLLBACK;
    """)
    if same != "t":
        raise AssertionError("same-transaction visibility or cutover order changed")

    writer = subprocess.Popen(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-h", db.socket,
         "-p", db.port, "-U", "postgres", "-d", db.name],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        writer.stdin.write("BEGIN; SELECT writer_xid||':'||observation_order FROM fn_ca_promo_source_observation();\n")
        writer.stdin.flush()
        xid, order = writer.stdout.readline().strip().split(":")
        if not (xid.isdigit() and order.isdigit()):
            raise AssertionError("writer did not retain an original transaction and source order")
        first = db.one(f"""SELECT fn_ca_promo_source_version_visible('{xid}',{order},o.writer_xid,
                           o.observation_order,o.visible_xids) FROM fn_ca_promo_source_observation() o""")
        writer.stdin.write("COMMIT;\n")
        writer.stdin.close()
        if writer.wait(timeout=10):
            raise AssertionError(writer.stderr.read())
        second = db.one(f"""SELECT fn_ca_promo_source_version_visible('{xid}',{order},o.writer_xid,
                            o.observation_order,o.visible_xids) FROM fn_ca_promo_source_observation() o""")
        if (first, second) != ("f", "t"):
            raise AssertionError("an original concurrent fee became visible at the wrong boundary")
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.wait()
        writer.stdout.close()
        writer.stderr.close()
    invalid = db.run("SELECT fn_ca_promo_source_version_visible(NULL,1,'5',2,'4:5:')", check=False)
    if invalid.returncode == 0 or "promo_source_visibility_evidence_incomplete" not in invalid.stderr:
        raise AssertionError("missing source evidence must fail closed")
