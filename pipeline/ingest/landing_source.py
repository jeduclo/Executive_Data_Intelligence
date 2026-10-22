"""dlt source: emulated source-system extracts -> bronze (DuckDB).

Each resource reads one landing folder. A file is only (re)loaded when its
content hash changes, tracked in dlt state, so runs are incremental. Monthly
partitions use merge on `_source_file` (delete-insert of that partition), which
keeps bronze an exact, append-style copy of what the source sent, duplicates
and all. Cleaning happens in silver, not here.

In production the same resources would be swapped for dlt's `rest_api`
(SAP OData), `sql_database` (QMS) and `filesystem` (MES drops / SharePoint)
sources; nothing downstream changes.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable, Iterator

import dlt
from dlt.pipeline.exceptions import PipelineStepFailed

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C  # noqa: E402
import win_compat  # noqa: E402

win_compat.apply()


def _odata(path: Path) -> Iterator[dict]:
    yield from json.loads(path.read_text(encoding="utf-8"))["d"]["results"]


def _csv(path: Path) -> Iterator[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def _json_list(path: Path) -> Iterator[dict]:
    yield from json.loads(path.read_text(encoding="utf-8"))


def _file_resource(name: str, folder: str, pattern: str, parser: Callable[[Path], Iterator[dict]],
                   snapshot: bool = False):
    disposition = "replace" if snapshot else {"disposition": "merge", "strategy": "delete-insert"}

    @dlt.resource(name=name, write_disposition=disposition,
                  merge_key=None if snapshot else "_source_file",
                  columns={"_source_file": {"data_type": "text"}})
    def _resource():
        base = C.LANDING_DIR / folder
        if not base.exists():
            return
        state = dlt.current.resource_state()
        seen: dict = state.setdefault("file_hashes", {})
        files = sorted(base.glob(pattern))
        if snapshot:
            files = files[-1:]
        for path in files:
            digest = hashlib.md5(path.read_bytes()).hexdigest()
            if not snapshot and seen.get(path.name) == digest:
                continue
            for row in parser(path):
                row = {k: (v if isinstance(v, dict) else ("" if v is None else str(v))) for k, v in row.items()}
                row["_source_file"] = f"{folder}/{path.name}"
                yield row
            seen[path.name] = digest

    return _resource


@dlt.source(name="halden_landing", max_table_nesting=1)
def landing_source():
    return [
        # ERP master data (full snapshots)
        _file_resource("erp_customers", "erp/customers", "*.json", _odata, snapshot=True),
        _file_resource("erp_materials", "erp/materials", "*.json", _odata, snapshot=True),
        _file_resource("erp_suppliers", "erp/suppliers", "*.json", _odata, snapshot=True),
        _file_resource("erp_cost_standards", "erp/cost_standards", "*.json", _odata, snapshot=True),
        # ERP transactions (monthly partitions)
        _file_resource("erp_sales_order_headers", "erp/sales_order_headers", "*.json", _odata),
        _file_resource("erp_sales_order_items", "erp/sales_order_items", "*.json", _odata),
        _file_resource("erp_deliveries", "erp/deliveries", "*.json", _odata),
        _file_resource("erp_billing", "erp/billing", "*.json", _odata),
        _file_resource("erp_purchase_order_items", "erp/purchase_order_items", "*.json", _odata),
        _file_resource("erp_po_receipts", "erp/po_receipts", "*.json", _odata),
        _file_resource("erp_stock_movements", "erp/stock_movements", "*.json", _odata),
        # MES / QMS / FX / Finance
        _file_resource("mes_production_orders", "mes/production_orders", "*.csv", _csv),
        _file_resource("qms_inspections", "qms/inspections", "*.csv", _csv),
        _file_resource("fx_daily_rates", "fx/daily_rates", "*.json", _json_list),
        _file_resource("finance_budget", "finance/budget", "*.csv", _csv),
    ]


# Windows: parallel load workers rewrite the same load-package state file, and
# Windows refuses to replace a file another handle (or antivirus) has open
# ("[WinError 5] Access is denied"). One worker each is plenty for this volume.
os.environ.setdefault("LOAD__WORKERS", "1")
os.environ.setdefault("NORMALIZE__WORKERS", "1")


def run() -> dict:
    C.DATA_DIR.mkdir(parents=True, exist_ok=True)
    pipeline = dlt.pipeline(
        pipeline_name="halden_bronze",
        destination=dlt.destinations.duckdb(str(C.WAREHOUSE)),
        dataset_name="bronze",
        pipelines_dir=str(C.DATA_DIR / ".dlt"),
    )
    # Finish any package left half-loaded by an interrupted run before extracting new data
    if pipeline.list_normalized_load_packages():
        pipeline.load()
    info = None
    for attempt in range(3):
        try:
            info = pipeline.run(landing_source(), loader_file_format="parquet")
            break
        except PipelineStepFailed as exc:
            # transient file locks on Windows: wait, then retry the pending package
            if attempt == 2 or not isinstance(exc.exception, PermissionError):
                raise
            time.sleep(2 * (attempt + 1))
            pipeline.load()
            info = pipeline.last_trace.last_load_info if pipeline.last_trace else None
            break
    counts = {}
    trace = pipeline.last_trace
    if trace and trace.last_normalize_info:
        counts = {k: v for k, v in trace.last_normalize_info.row_counts.items() if not k.startswith("_dlt")}
    return {"load_ids": list(info.loads_ids) if info else [], "rows": counts}


if __name__ == "__main__":
    print(run())