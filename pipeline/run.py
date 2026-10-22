"""Pipeline orchestrator: simulate -> ingest (dlt) -> transform + test (dbt) -> publish (Postgres) -> alert.

Usage (from the repo root):
    python pipeline/run.py                 # one end-to-end run
    python pipeline/run.py --loop 15       # keep running every 15 minutes ("live" demo mode)
    python pipeline/run.py --no-publish    # stop after dbt (no Postgres needed)
    python pipeline/run.py --full-refresh  # wipe local data and rebuild from scratch

Configuration comes from environment variables or a .env file in the repo root:
    PUBLISH_DATABASE_URL   Postgres URL with owner rights (Neon "owner" connection string)
    PORTAL_APP_PASSWORD    password for the least-privilege login the portal uses
    POWERBI_PASSWORD       optional: creates a read-only `powerbi_reader` login for Power BI
    TEAMS_WEBHOOK_URL / SLACK_WEBHOOK_URL   optional: post new alerts
    POC_NOW                optional: freeze the simulation clock, e.g. 2026-10-21T16:00
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "generator"))
sys.path.insert(0, str(HERE / "ingest"))
sys.path.insert(0, str(HERE / "publish"))


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(HERE.parent / ".env")
os.environ.setdefault("DO_NOT_TRACK", "1")                  # dbt telemetry off
os.environ.setdefault("RUNTIME__DLTHUB_TELEMETRY", "false")  # dlt telemetry off

import config as C  # noqa: E402


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def run_dbt(as_of: str) -> tuple[bool, list[dict]]:
    """Run `dbt build` in a child process (keeps DuckDB file locks clean) and read run_results.json."""
    env = {**os.environ, "DUCKDB_PATH": C.WAREHOUSE.as_posix(), "PYTHONWARNINGS": "ignore"}
    cmd = [sys.executable, "-m", "dbt.cli.main", "build", "--project-dir", str(C.DBT_DIR),
           "--profiles-dir", str(C.DBT_DIR), "--vars", json.dumps({"as_of_date": as_of}), "--quiet"]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if proc.returncode not in (0, 1):
        print(proc.stdout[-3000:], proc.stderr[-3000:])
    results = []
    rr = C.DBT_DIR / "target" / "run_results.json"
    if rr.exists():
        for r in json.loads(rr.read_text(encoding="utf-8"))["results"]:
            uid = r["unique_id"]
            if not uid.startswith("test."):
                continue
            name = uid.split(".")[2]
            layer = "silver" if "slv_" in name else ("reference" if any(k in name for k in ("sites", "kpi_definitions")) and "dim_site" not in name else "gold")
            results.append({"name": name, "layer": layer, "status": r["status"],
                            "failures": int(r.get("failures") or 0), "message": (r.get("message") or "")[:500]})
    return proc.returncode == 0, results


def notify(alerts: list[dict]) -> None:
    high = [a for a in alerts if a["severity"] == "High"]
    if not high:
        return
    text = "**New exceptions detected**\n" + "\n".join(f"- {a['headline']}" for a in high)
    for env, payload in (("TEAMS_WEBHOOK_URL", {"text": text}), ("SLACK_WEBHOOK_URL", {"text": text})):
        url = os.getenv(env)
        if url:
            try:
                req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=10)
                log(f"notified {env.split('_')[0].title()} of {len(high)} new high-severity exception(s)")
            except Exception as exc:  # never fail the pipeline on a notification
                log(f"notification failed ({env}): {exc}")


def run_once(publish: bool = True) -> bool:
    import simulate
    import landing_source

    run_id = uuid.uuid4().hex[:12]
    started = dt.datetime.now(dt.timezone.utc)
    now = C.now()
    as_of = now.date().isoformat()
    steps = {}

    log("simulating source systems (first run on Windows can take a minute)...")
    t = time.time()
    changed = simulate.run(now)
    steps["simulate"] = round(time.time() - t, 1)
    log(f"source systems: {len(changed)} extract file(s) changed (clock {now:%Y-%m-%d %H:%M} UTC)")

    t = time.time()
    ingest = landing_source.run()
    steps["ingest"] = round(time.time() - t, 1)
    rows = sum(ingest["rows"].values())
    log(f"dlt -> bronze: {rows:,} rows loaded")

    t = time.time()
    ok, tests = run_dbt(as_of)
    steps["dbt_build"] = round(time.time() - t, 1)
    failed = [x for x in tests if x["status"] in ("fail", "error")]
    log(f"dbt build: {'OK' if ok else 'FAILED'} - {sum(x['status'] == 'pass' for x in tests)} tests passed, "
        f"{sum(x['status'] == 'warn' for x in tests)} warned, {len(failed)} failed")
    if not ok:
        for f in failed:
            log(f"  failed: {f['name']} ({f['failures']} rows)")
        log("gold layer NOT published - the previous good version stays live")
        url = os.getenv("PUBLISH_DATABASE_URL")
        if publish and url:
            import publish as pub
            pub.record_failed_run(url, {"run_id": run_id, "started_at": started, "as_of": as_of,
                                        "files_changed": len(changed), "rows_ingested": rows, "steps": steps}, tests)
        return False

    if publish:
        url = os.getenv("PUBLISH_DATABASE_URL")
        if not url:
            log("PUBLISH_DATABASE_URL not set - skipping publish (use --no-publish to silence)")
            return True
        import publish as pub
        t = time.time()
        meta = {"run_id": run_id, "started_at": started, "as_of": as_of, "status": "success",
                "files_changed": len(changed), "rows_ingested": rows, "steps": steps}
        out = pub.publish(url, meta, tests, os.getenv("PORTAL_APP_PASSWORD"), os.getenv("POWERBI_PASSWORD"))
        log(f"published {len(out['tables'])} tables to Postgres in {steps['publish']}s; "
            f"{len(out['new_alerts'])} new exception(s)")
        notify(out["new_alerts"])
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=float, help="repeat every N minutes")
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--full-refresh", action="store_true")
    a = ap.parse_args()
    if a.full_refresh and C.DATA_DIR.exists():
        shutil.rmtree(C.DATA_DIR)
        log("local data wiped")
    while True:
        ok = run_once(publish=not a.no_publish)
        if not a.loop:
            sys.exit(0 if ok else 1)
        log(f"next run in {a.loop:g} minutes (Ctrl+C to stop)")
        time.sleep(a.loop * 60)


if __name__ == "__main__":
    main()