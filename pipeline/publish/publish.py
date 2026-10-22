"""Publish the gold layer from DuckDB to PostgreSQL (the serving layer).

Each table is replaced inside ONE transaction (truncate + COPY), so the portal
and Power BI never see a half-loaded state. Table definitions follow dbt; if
the columns change the table is recreated. Security (roles, RLS, column
grants) is re-applied on every publish, so it can never drift from the data.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import time
from pathlib import Path

import duckdb
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C  # noqa: E402
import security  # noqa: E402

TYPE_MAP = {"VARCHAR": "text", "BOOLEAN": "boolean", "DATE": "date", "DOUBLE": "double precision",
            "FLOAT": "real", "INTEGER": "integer", "BIGINT": "bigint", "HUGEINT": "numeric",
            "SMALLINT": "smallint", "TIMESTAMP": "timestamp", "TIMESTAMP WITH TIME ZONE": "timestamptz"}


def _pg_type(duck_type: str) -> str:
    if duck_type.startswith("DECIMAL"):
        return "numeric"
    return TYPE_MAP.get(duck_type, "text")


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def _source_tables(con: duckdb.DuckDBPyConnection) -> list[tuple[str, str]]:
    """(duckdb relation, postgres schema.table)"""
    gold = [r[0] for r in con.execute(
        "select table_name from information_schema.tables where table_schema = 'gold' order by 1").fetchall()]
    out = [(f"gold.{t}", f"gold.{t}") for t in gold]
    out.append(("reference.kpi_definitions", "gold.kpi_definitions"))
    out.append(("silver.slv_data_corrections", "ops.data_corrections"))
    return out


def _sync_table(pg: psycopg.Connection, con: duckdb.DuckDBPyConnection, src: str, dst: str) -> tuple[list[str], int]:
    cols = [(r[0], _pg_type(r[1])) for r in con.execute(f"describe {src}").fetchall()]
    schema, name = dst.split(".")
    existing = pg.execute(
        "select column_name, data_type from information_schema.columns where table_schema = %s and table_name = %s "
        "order by ordinal_position", (schema, name)).fetchall()
    info_name = {"timestamp": "timestamp without time zone", "timestamptz": "timestamp with time zone"}
    same = existing == [(c, info_name.get(t, t)) for c, t in cols]
    target = f"{schema}.{_q(name)}"
    if existing and same:
        # FORCE RLS also applies to the owner and blocks COPY; security re-enables it below
        pg.execute(f"ALTER TABLE {target} NO FORCE ROW LEVEL SECURITY")
        pg.execute(f"TRUNCATE {target}")
    else:
        pg.execute(f"DROP TABLE IF EXISTS {target} CASCADE")
        pg.execute(f"CREATE TABLE {target} ({', '.join(f'{_q(c)} {t}' for c, t in cols)})")
    col_list = ", ".join(_q(c) for c, _ in cols)
    rows = con.execute(f"select * from {src}").fetchall()
    with pg.cursor() as cur:
        with cur.copy(f"COPY {target} ({col_list}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row(r)
    return [c for c, _ in cols], len(rows)


def _indexes(pg: psycopg.Connection) -> None:
    for sql in [
        "CREATE INDEX IF NOT EXISTS ix_order_site_promised ON gold.fct_order_line (site_id, promised_date)",
        "CREATE INDEX IF NOT EXISTS ix_order_site_invoice ON gold.fct_order_line (site_id, invoice_date)",
        "CREATE INDEX IF NOT EXISTS ix_order_order ON gold.fct_order_line (order_id)",
        "CREATE INDEX IF NOT EXISTS ix_order_customer ON gold.fct_order_line (customer_id)",
        "CREATE INDEX IF NOT EXISTS ix_prod_site_finish ON gold.fct_production_order (site_id, finish_date)",
        "CREATE INDEX IF NOT EXISTS ix_po_site_due ON gold.fct_po_line (site_id, due_date)",
    ]:
        pg.execute(sql)


def publish(pg_url: str, run_meta: dict, dbt_results: list[dict], app_password: str | None = None,
            powerbi_password: str | None = None) -> dict:
    t0 = time.time()
    con = duckdb.connect(str(C.WAREHOUSE), read_only=True)
    published = {}
    with psycopg.connect(pg_url, autocommit=False, connect_timeout=20) as pg:
        pg.execute("SET lock_timeout = '30s'")
        for schema in ("gold", "ops", "sec"):
            pg.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
        table_cols = {}
        for src, dst in _source_tables(con):
            cols, n = _sync_table(pg, con, src, dst)
            table_cols[dst] = cols
            published[dst] = n
        _indexes(pg)

        # Run history + data-quality results (kept across runs)
        pg.execute("""CREATE TABLE IF NOT EXISTS ops.pipeline_run (
            run_id text PRIMARY KEY, started_at timestamptz, finished_at timestamptz, as_of_date date,
            status text, files_changed int, rows_ingested bigint, tests_passed int, tests_warned int,
            tests_failed int, step_seconds jsonb)""")
        pg.execute("""CREATE TABLE IF NOT EXISTS ops.dq_test (
            run_id text, test_name text, layer text, status text, failures bigint, message text)""")
        pg.execute("""CREATE TABLE IF NOT EXISTS ops.alert_log (
            exception_id text PRIMARY KEY, site_id int, headline text, severity text,
            first_seen timestamptz, notified boolean DEFAULT false)""")
        pg.execute("DELETE FROM ops.dq_test WHERE run_id IN (SELECT run_id FROM ops.pipeline_run ORDER BY started_at DESC OFFSET 50)")
        pg.execute("DELETE FROM ops.pipeline_run WHERE run_id IN (SELECT run_id FROM ops.pipeline_run ORDER BY started_at DESC OFFSET 200)")
        run_meta["steps"]["publish"] = round(time.time() - t0, 1)
        pg.execute("""INSERT INTO ops.pipeline_run VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                      ON CONFLICT (run_id) DO NOTHING""",
                   (run_meta["run_id"], run_meta["started_at"], dt.datetime.now(dt.timezone.utc), run_meta["as_of"],
                    run_meta["status"], run_meta["files_changed"], run_meta["rows_ingested"],
                    sum(r["status"] == "pass" for r in dbt_results), sum(r["status"] == "warn" for r in dbt_results),
                    sum(r["status"] in ("fail", "error") for r in dbt_results), json.dumps(run_meta["steps"])))
        with pg.cursor() as cur:
            cur.executemany("INSERT INTO ops.dq_test VALUES (%s, %s, %s, %s, %s, %s)",
                            [(run_meta["run_id"], r["name"], r["layer"], r["status"], r["failures"], r["message"])
                             for r in dbt_results])

        # Security: roles, entitlements, RLS policies, column grants
        for sql, params in security.statements(table_cols, app_password, powerbi_password):
            pg.execute(sql, params or None)
        pg.execute("TRUNCATE sec.sites")
        for (sid,) in con.execute("select site_id from gold.dim_site").fetchall():
            pg.execute("INSERT INTO sec.sites VALUES (%s)", (sid,))

        # New exceptions since the last run (for notifications)
        new_alerts = []
        for ex_id, sid, headline, sev in con.execute(
                "select exception_id, site_id, site_name || ': ' || headline, severity from gold.mart_exceptions").fetchall():
            row = pg.execute("""INSERT INTO ops.alert_log (exception_id, site_id, headline, severity, first_seen)
                                VALUES (%s, %s, %s, %s, now()) ON CONFLICT DO NOTHING RETURNING exception_id""",
                             (ex_id, sid, headline, sev)).fetchone()
            if row:
                new_alerts.append({"site_id": sid, "headline": headline, "severity": sev})
        pg.commit()
    return {"tables": published, "new_alerts": new_alerts}


def record_failed_run(pg_url: str, run_meta: dict, dbt_results: list[dict]) -> None:
    """Log a run whose tests failed (nothing is published) so it shows on the Data quality page."""
    with psycopg.connect(pg_url, connect_timeout=20) as pg:
        if not pg.execute("SELECT to_regclass('ops.pipeline_run')").fetchone()[0]:
            return
        pg.execute("""INSERT INTO ops.pipeline_run VALUES (%s, %s, now(), %s, 'failed', %s, %s, %s, %s, %s, %s)
                      ON CONFLICT (run_id) DO NOTHING""",
                   (run_meta["run_id"], run_meta["started_at"], run_meta["as_of"], run_meta["files_changed"],
                    run_meta["rows_ingested"], sum(r["status"] == "pass" for r in dbt_results),
                    sum(r["status"] == "warn" for r in dbt_results),
                    sum(r["status"] in ("fail", "error") for r in dbt_results), json.dumps(run_meta["steps"])))
        with pg.cursor() as cur:
            cur.executemany("INSERT INTO ops.dq_test VALUES (%s, %s, %s, %s, %s, %s)",
                            [(run_meta["run_id"], r["name"], r["layer"], r["status"], r["failures"], r["message"])
                             for r in dbt_results])
