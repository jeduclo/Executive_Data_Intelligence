"""Shared configuration for the POC pipeline.

Everything is driven from here so the same code runs on Windows (VS Code),
macOS, Linux and GitHub Actions.
"""
from __future__ import annotations

import datetime as dt
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
LANDING_DIR = DATA_DIR / "landing"          # emulated source-system extracts
WAREHOUSE = DATA_DIR / "warehouse.duckdb"    # bronze + silver + gold (DuckDB)
DBT_DIR = ROOT / "pipeline" / "dbt"

SEED = 20261021

# Order history starts two months before FY25/26 so that April 2025 already
# has a full pipeline of invoices (no ramp-up artefact in the charts).
SIM_START = dt.date(2025, 2, 1)
FY_START_MONTH = 4  # UK-style financial year: April to March


def now() -> dt.datetime:
    """Simulation clock. Override with POC_NOW=2026-10-21T16:00 for a frozen demo."""
    override = os.getenv("POC_NOW")
    if override:
        return dt.datetime.fromisoformat(override).replace(second=0, microsecond=0)
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, second=0, microsecond=0)


# --- Organisation -----------------------------------------------------------
GROUP_NAME = "Halden Group"

COMPANIES = [
    # code, legal entity, currency, country
    ("1000", "Halden UK Ltd", "GBP", "GB"),
    ("2000", "Halden GmbH", "EUR", "DE"),
    ("3000", "Halden Inc", "USD", "US"),
]

# site_id, SAP plant code, name, company code, region, base orders/day,
# actual volume growth p.a., planned growth for FY26/27, product families made
SITES = [
    (1, "UK01", "Birmingham", "1000", "UK & Ireland", 22, 0.045, 0.04, ["GEA", "SHA"]),
    (2, "UK02", "Coventry",   "1000", "UK & Ireland", 14, 0.030, 0.03, ["CTL", "MOT"]),
    (3, "DE01", "Stuttgart",  "2000", "DACH & EU",    20, 0.050, 0.05, ["HYD", "GEA"]),
    (4, "DE02", "Leipzig",    "2000", "DACH & EU",    12, 0.030, 0.03, ["MOT", "SHA"]),
    (5, "US01", "Detroit",    "3000", "North America", 16, 0.015, 0.09, ["HYD", "CTL"]),
]

FAMILIES = {
    "GEA": "Gear assemblies",
    "HYD": "Hydraulic valves",
    "MOT": "Motor housings",
    "CTL": "Control panels",
    "SHA": "Precision shafts",
}

# Standard-cost revision at the start of FY26/27 (raw material inflation)
COST_INFLATION_FY27 = {"HYD": 0.095, "MOT": 0.04, "GEA": 0.025, "CTL": 0.02, "SHA": 0.025}
# Price increases actually achieved vs. what the budget assumed
PRICE_RISE_ACTUAL_FY27 = {"HYD": 0.01, "MOT": 0.03, "GEA": 0.02, "CTL": 0.02, "SHA": 0.02}
PRICE_RISE_PLAN_FY27 = {"HYD": 0.09, "MOT": 0.04, "GEA": 0.025, "CTL": 0.02, "SHA": 0.025}

# Budget FX rates (local currency per GBP) used by Finance for the plan
BUDGET_FX = {"FY2025/26": {"GBP": 1.0, "EUR": 1.17, "USD": 1.27},
             "FY2026/27": {"GBP": 1.0, "EUR": 1.16, "USD": 1.30}}
