"""Synthetic source-system simulator.

Produces realistic extracts for a five-plant discrete manufacturer, written the
way the real systems would hand them over:

* ERP (SAP-style OData v2 JSON, SAP field names, /Date(ms)/ timestamps)
* MES production orders (CSV, German plants export dd.mm.yyyy dates)
* QMS inspection lots (CSV)
* FX rates (JSON, GBP base)
* Finance budget (CSV exported from Excel, thousands separators)

The whole history is re-simulated deterministically on every run (same seed ->
same history). Time only moves forward: events after `now` are withheld, so
re-running during a demo "trickles" new orders, deliveries and production in.
Files are monthly partitions and are only rewritten when their content changes,
so dlt ingests incrementally.

Business stories planted in the data (what the C-suite should discover):
  1. Stuttgart on-time delivery collapsing - root cause: late castings from a
     critical supplier (Kessler Gusstechnik).
  2. Hydraulic-valve margin erosion - FY26/27 cost increase not passed on in price.
  3. Detroit over-building finished goods - cash tied up in excess stock,
     while sales grow far slower than the plan assumed.
  4. Leipzig scrap spike in the last two weeks - porosity defects.
"""
from __future__ import annotations

import calendar
import csv
import datetime as dt
import hashlib
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402

DAY = dt.timedelta(days=1)


# --------------------------------------------------------------------------- helpers
def odata_date(d: dt.date | dt.datetime) -> str:
    if isinstance(d, dt.datetime):
        ms = calendar.timegm(d.timetuple()) * 1000
    else:
        ms = calendar.timegm(dt.datetime(d.year, d.month, d.day).timetuple()) * 1000
    return f"/Date({ms})/"


def monday(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


def ramp(d: dt.date, start: dt.date, end: dt.date) -> float:
    """0 before start, 1 after end, linear in between."""
    if d <= start:
        return 0.0
    if d >= end:
        return 1.0
    return (d - start).days / (end - start).days


def fy_of(d: dt.date) -> str:
    y = d.year if d.month >= C.FY_START_MONTH else d.year - 1
    return f"FY{y}/{str(y + 1)[2:]}"


def write_if_changed(path: Path, content: str, changed: list[str]) -> None:
    data = content.encode("utf-8")
    if path.exists() and hashlib.md5(path.read_bytes()).digest() == hashlib.md5(data).digest():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    changed.append(str(path.relative_to(C.LANDING_DIR)))


def odata_payload(rows: list[dict]) -> str:
    return json.dumps({"d": {"__count": str(len(rows)), "results": rows}}, separators=(",", ":"))


def to_csv(rows: list[dict], fields: list[str]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


# --------------------------------------------------------------------------- master data
SITE = {s[0]: dict(zip(["site_id", "plant", "name", "company", "region", "base_rate",
                        "growth", "plan_growth", "families"], s)) for s in C.SITES}
COMPANY = {c[0]: dict(zip(["code", "name", "currency", "country"], c)) for c in C.COMPANIES}
SITE_CCY = {sid: COMPANY[s["company"]]["currency"] for sid, s in SITE.items()}

FAMILY_PRICE = {"GEA": 420, "HYD": 680, "MOT": 310, "CTL": 1250, "SHA": 140}
FAMILY_QTY = {"GEA": 6, "HYD": 5, "MOT": 8, "CTL": 2, "SHA": 20}
FAMILY_SITES = defaultdict(list)
for sid, s in SITE.items():
    for f in s["families"]:
        FAMILY_SITES[f].append(sid)

CUSTOMER_STEMS = ["Atlas", "Bramwell", "Corvid", "Dunmore", "Elstree", "Fairholm", "Granta", "Hexley",
                  "Ironbridge", "Jarrow", "Kestrel", "Lindqvist", "Marlow", "Northgate", "Orwell",
                  "Pennine", "Quayside", "Redfern", "Saxby", "Thornbury", "Ulster", "Vantage", "Wexford",
                  "Yardley", "Zenith", "Albrecht", "Brenner", "Dressler", "Engel", "Falkner", "Gerlach",
                  "Hartmann", "Imhof", "Jansen", "Kruger", "Lorenz", "Maier", "Neumann", "Oswald",
                  "Pfeiffer", "Reinholt", "Schuster", "Theissen", "Vogel", "Winkler", "Ackerly",
                  "Brookfield", "Cascade", "Delmar", "Everett", "Franklin", "Glenview", "Harbor",
                  "Ironwood", "Juniper", "Keystone", "Lakeshore", "Meridian", "Northfield", "Oakridge",
                  "Pinecrest", "Riverside", "Summit", "Tidewater", "Union", "Westbrook"]
CUSTOMER_TAILS = ["Engineering", "Automation", "Fluid Power", "Machinery", "Industrial", "Motion",
                  "Systems", "Agritech", "Rail", "Marine", "Energy", "Robotics", "Vehicles", "Pumps"]
REGION_COUNTRIES = {"1000": ["GB"] * 8 + ["IE", "NL"],
                    "2000": ["DE"] * 6 + ["AT", "CH", "NL", "FR", "PL", "CZ"],
                    "3000": ["US"] * 8 + ["CA", "MX"]}
LEGAL = {"GB": "Ltd", "IE": "Ltd", "NL": "B.V.", "DE": "GmbH", "AT": "GmbH", "CH": "AG", "FR": "SAS",
         "PL": "Sp. z o.o.", "CZ": "s.r.o.", "US": "Inc", "CA": "Inc", "MX": "S.A. de C.V."}

SUPPLIER_CATS = {"CAS": "Castings", "BRG": "Bearings", "ELE": "Electronics", "STL": "Steel bar & plate",
                 "SEA": "Seals & gaskets", "FAS": "Fasteners"}
SUPPLIER_NAMES = ["Arden Metals", "Baxter Bearings", "Calder Electronics", "Delta Seals", "Eston Fasteners",
                  "Fenwick Steel", "Gorton Castings", "Holt Precision", "Ingram Alloys", "Jessop Components",
                  "Kessler Gusstechnik", "Lange Stahl", "Mohr Elektronik", "Nagel Dichtungen", "Ostwald Lager",
                  "Paulsen Schrauben", "Quandt Guss", "Richter Metall", "Seidel Kabel", "Tessin Antriebe",
                  "Allied Castparts", "Benton Steel", "Crestline Electronics", "Dayton Seals", "Eagle Fasteners",
                  "Foster Bearing Co", "Granite Foundry", "Hudson Alloys", "Interstate Wire", "Jackson Forge"]
SUPPLIER_CAT_OF = ["STL", "BRG", "ELE", "SEA", "FAS", "STL", "CAS", "CAS", "STL", "ELE",
                   "CAS", "STL", "ELE", "SEA", "BRG", "FAS", "CAS", "STL", "ELE", "BRG",
                   "CAS", "STL", "ELE", "SEA", "FAS", "BRG", "CAS", "STL", "ELE", "CAS"]
SUPPLIER_REGION = ["1000"] * 10 + ["2000"] * 10 + ["3000"] * 10
CRITICAL_SUPPLIER = "Kessler Gusstechnik"
DEFECTS = {"DIM": "Dimension out of tolerance", "SUR": "Surface finish", "POR": "Casting porosity",
           "ASM": "Assembly error", "ELT": "Electrical test failure"}


def build_master(rng: np.random.Generator):
    # Finished goods: 60 per family, each assigned to one of the family's plants
    materials = []
    for fam, fam_name in C.FAMILIES.items():
        for i in range(60):
            base = FAMILY_PRICE[fam] * float(rng.lognormal(0, 0.35))
            materials.append({
                "matnr": f"FG-{fam}-{1000 + i}",
                "desc": f"{fam_name[:-1]} {fam[0]}{fam[1]}-{2000 + i * 7}",
                "family": fam,
                "site_id": FAMILY_SITES[fam][i % len(FAMILY_SITES[fam])],
                "list_gbp": round(base, 2),
                "cost_ratio": float(rng.uniform(0.55, 0.65)),
                "weight": float(rng.pareto(1.6) + 0.2),
                "qty_med": FAMILY_QTY[fam],
            })
    # Raw materials / components bought from suppliers
    raws = []
    for cat, cat_name in SUPPLIER_CATS.items():
        for i in range(25):
            raws.append({"matnr": f"RM-{cat}-{500 + i}", "desc": f"{cat_name} component {cat}{500 + i}",
                         "cat": cat, "price_gbp": round(float(rng.lognormal(np.log(18), 0.8)), 2)})
    # Customers per company region
    customers = []
    n = 0
    for comp, count in (("1000", 75), ("2000", 80), ("3000", 60)):
        for _ in range(count):
            country = str(rng.choice(REGION_COUNTRIES[comp]))
            name = f"{rng.choice(CUSTOMER_STEMS)} {rng.choice(CUSTOMER_TAILS)} {LEGAL[country]}"
            seg = str(rng.choice(["OEM", "DIST", "AFTM"], p=[0.5, 0.3, 0.2]))
            customers.append({"kunnr": f"{100000 + n:010d}", "name": name, "country": country,
                              "company": comp, "segment": seg, "weight": float(rng.pareto(1.2) + 0.1)})
            n += 1
    # top 25 by weight are key accounts
    for c in sorted(customers, key=lambda c: -c["weight"])[:25]:
        c["key"] = True
    # Duplicate master records (classic MDM problem) - same company, new number
    dups = []
    for c in rng.choice([c for c in customers if c.get("key")], 10, replace=False):
        variant = c["name"].upper() if rng.random() < 0.5 else c["name"].replace(" ", "  ", 1) + "."
        dups.append({**c, "kunnr": f"{100000 + n:010d}", "name": variant, "dup_of": c["kunnr"]})
        n += 1
    suppliers = []
    for i, nm in enumerate(SUPPLIER_NAMES):
        comp = SUPPLIER_REGION[i]
        country = {"1000": "GB", "2000": "DE", "3000": "US"}[comp]
        suppliers.append({"lifnr": f"{700000 + i:010d}", "name": f"{nm} {LEGAL[country]}", "country": country,
                          "company": comp, "cat": SUPPLIER_CAT_OF[i],
                          "p_late": float(rng.uniform(0.03, 0.08)),
                          "critical": nm == CRITICAL_SUPPLIER or nm in ("Calder Electronics", "Allied Castparts")})
    return materials, raws, customers, dups, suppliers


# --------------------------------------------------------------------------- simulation
def simulate(now: dt.datetime) -> dict[str, pd.DataFrame | list]:
    anchor = now.date()
    today = now.date()
    rng0 = np.random.default_rng(C.SEED)
    materials, raws, customers, dups, suppliers = build_master(rng0)
    mat_by_site = defaultdict(list)
    for m in materials:
        mat_by_site[m["site_id"]].append(m)
    cust_by_comp = defaultdict(list)
    for c in customers:
        cust_by_comp[c["company"]].append(c)
    dup_of = defaultdict(list)
    for d in dups:
        dup_of[d["dup_of"]].append(d["kunnr"])

    # ---- FX: mean-reverting daily rates, local currency per 1 GBP
    fx = {}
    x_eur, x_usd = np.log(1.175), np.log(1.27)
    frng = np.random.default_rng([C.SEED, 9])
    d = C.SIM_START - dt.timedelta(days=40)
    while d <= today:
        x_eur += 0.03 * (np.log(1.165) - x_eur) + frng.normal(0, 0.0022)
        x_usd += 0.03 * (np.log(1.285) - x_usd) + frng.normal(0, 0.0028)
        fx[d] = {"GBP": 1.0, "EUR": round(float(np.exp(x_eur)), 5), "USD": round(float(np.exp(x_usd)), 5)}
        d += DAY

    def budget_rate(ccy: str, day: dt.date) -> float:
        return C.BUDGET_FX[fy_of(day) if fy_of(day) in C.BUDGET_FX else "FY2025/26"][ccy]

    def list_price_local(m, site_id, day):
        ccy = SITE_CCY[site_id]
        p = m["list_gbp"] * budget_rate(ccy, day)
        if fy_of(day) == "FY2026/27":
            p *= 1 + C.PRICE_RISE_ACTUAL_FY27[m["family"]]
        return p

    # ---- Sales orders -------------------------------------------------------
    orders, lines = [], []
    order_no = 0
    d = C.SIM_START
    while d <= today:
        wd = d.weekday()
        wd_factor = 1.0 if wd < 5 else (0.15 if wd == 5 else 0.0)
        season = 1 + 0.08 * np.sin(2 * np.pi * (d.timetuple().tm_yday - 60) / 365)
        years = (d - C.SIM_START).days / 365.25
        for sid, s in SITE.items():
            rng = np.random.default_rng([C.SEED, 1, sid, d.toordinal()])
            lam = s["base_rate"] * wd_factor * season * (1 + s["growth"]) ** years
            n_orders = int(rng.poisson(lam)) if lam > 0 else 0
            custs = cust_by_comp[s["company"]]
            cw = np.array([c["weight"] for c in custs]); cw /= cw.sum()
            mats = mat_by_site[sid]
            mw = np.array([m["weight"] for m in mats]); mw /= mw.sum()
            for _ in range(n_orders):
                order_no += 1
                vbeln = f"{order_no + 10000000:010d}"
                c = custs[int(rng.choice(len(custs), p=cw))]
                kunnr = c["kunnr"]
                if dup_of.get(kunnr) and rng.random() < 0.12:
                    kunnr = dup_of[kunnr][0]
                created = dt.datetime.combine(d, dt.time(int(rng.integers(7, 18)), int(rng.integers(0, 60))))
                lead = int(rng.integers(10, 36))
                promised = d + dt.timedelta(days=lead)
                currency = SITE_CCY[sid] if rng.random() > 0.012 else ""  # missing currency defect
                orders.append({"vbeln": vbeln, "created": created, "kunnr": kunnr, "site_id": sid,
                               "company": s["company"], "currency": currency, "requested": promised - dt.timedelta(days=int(rng.integers(0, 6)))})
                disc = rng.uniform(0.07, 0.15) if c.get("key") else rng.uniform(0.0, 0.08)
                n_lines = 1 + int(rng.poisson(1.4))
                for ln in range(n_lines):
                    m = mats[int(rng.choice(len(mats), p=mw))]
                    qty = max(1, int(round(rng.lognormal(np.log(m["qty_med"]), 0.6))))
                    unit = list_price_local(m, sid, d) * (1 - disc)
                    # --- delivery performance model
                    p_late = {1: 0.022, 2: 0.028, 3: 0.025, 4: 0.025, 5: 0.03}[sid]
                    late_max = 6
                    if sid == 3:  # Stuttgart: supplier-driven collapse in last ~4 months
                        r = ramp(promised, anchor - dt.timedelta(days=125), anchor - dt.timedelta(days=30))
                        p_late += 0.33 * r
                        late_max += int(10 * r)
                    if sid == 4 and promised >= anchor - dt.timedelta(days=14):
                        p_late += 0.08
                    u = rng.random()
                    if u < p_late:
                        ship = promised + dt.timedelta(days=int(rng.integers(1, late_max + 1)))
                    elif u < p_late + 0.15:
                        ship = promised - dt.timedelta(days=int(rng.integers(1, 4)))
                    else:
                        ship = promised
                    ship = max(ship, d + DAY)
                    qty_ship = qty if rng.random() > 0.012 else max(1, int(qty * rng.uniform(0.8, 0.95)))
                    lines.append({"vbeln": vbeln, "posnr": f"{(ln + 1) * 10:06d}", "matnr": m["matnr"],
                                  "family": m["family"], "site_id": sid, "qty": qty, "qty_ship": qty_ship,
                                  "unit": round(unit, 2), "currency": SITE_CCY[sid], "created": d,
                                  "promised": promised, "ship": ship,
                                  "invoice": ship + dt.timedelta(days=int(rng.integers(0, 3)))})
        d += DAY
    orders_df = pd.DataFrame(orders)
    lines_df = pd.DataFrame(lines)
    lines_df["netwr"] = (lines_df["qty"] * lines_df["unit"]).round(2)

    # ---- Standard costs (two versions: FY25/26 and FY26/27) ----------------
    cost_rows = []
    std_cost = {}  # (matnr, fy) -> local cost
    for m in materials:
        ccy = SITE_CCY[m["site_id"]]
        c25 = m["list_gbp"] * m["cost_ratio"] * C.BUDGET_FX["FY2025/26"][ccy]
        c26 = m["list_gbp"] * m["cost_ratio"] * C.BUDGET_FX["FY2026/27"][ccy] * (1 + C.COST_INFLATION_FY27[m["family"]])
        std_cost[(m["matnr"], "FY2025/26")] = c25
        std_cost[(m["matnr"], "FY2026/27")] = c26
        for valid, val in ((dt.date(2025, 1, 1), c25), (dt.date(2026, 4, 1), c26)):
            cost_rows.append({"MATNR": m["matnr"], "BWKEY": SITE[m["site_id"]]["plant"], "STPRS": f"{val:.2f}",
                              "PEINH": "1", "WAERS": ccy, "VALID_FROM": odata_date(valid)})

    # ---- Production: weekly orders sized to hold a target stock cover --------
    lw = lines_df[["matnr", "ship", "qty_ship"]].copy()
    lw["week"] = lw["ship"].map(monday)
    ship_w = lw.groupby(["matnr", "week"])["qty_ship"].sum().to_dict()
    first_weeks = lines_df[lines_df["ship"] < C.SIM_START + dt.timedelta(days=56)]
    avg_week0 = (first_weeks.groupby("matnr")["qty_ship"].sum() / 8).to_dict()
    weeks = []
    w = monday(C.SIM_START)
    while w - dt.timedelta(days=2) <= today:
        weeks.append(w)
        w += dt.timedelta(days=7)
    prod_rows, insp_rows = [], []
    opening = {}
    base_scrap = {1: 0.018, 2: 0.022, 3: 0.020, 4: 0.024, 5: 0.021}
    work_centres = {"GEA": ["GEA-CELL1", "GEA-CELL2"], "HYD": ["HYD-MACH1", "HYD-ASSY"], "MOT": ["MOT-CAST", "MOT-CNC"],
                    "CTL": ["CTL-WIRE", "CTL-TEST"], "SHA": ["SHA-TURN", "SHA-GRIND"]}
    cycle_of = {"GEA": 22, "HYD": 30, "MOT": 14, "CTL": 75, "SHA": 6}
    for m in materials:
        matnr, sid, fam = m["matnr"], m["site_id"], m["family"]
        avg0 = avg_week0.get(matnr, 1.0)
        stock = int(np.ceil(avg0 * 5)) + 2
        opening[matnr] = stock
        history = []
        for wk in weeks:
            release = wk - dt.timedelta(days=2)
            rng = np.random.default_rng([C.SEED, 3, sid, int(matnr.split("-")[2]), wk.toordinal(), ord(matnr[3])])
            demand_w = ship_w.get((matnr, wk), 0)
            avg = float(np.mean(history[-8:])) if len(history) >= 4 else avg0
            cover = 5.0
            if sid == 5:  # Detroit: planners raise safety stock "to protect service" - cash tied up
                cover += 9.0 * ramp(wk, anchor - dt.timedelta(days=240), anchor - dt.timedelta(days=60))
            need = max(0.0, cover * avg + demand_w - stock) * rng.uniform(0.95, 1.08)
            history.append(demand_w)
            start = wk + dt.timedelta(days=int(rng.integers(0, 3)))
            finish = start + dt.timedelta(days=int(rng.integers(1, 4)))
            if need < 1:
                stock -= demand_w
                continue
            spike = sid == 4 and start >= anchor - dt.timedelta(days=14)
            scrap_rate = rng.uniform(0.08, 0.115) if spike else base_scrap[sid] * rng.uniform(0.6, 1.4)
            fpy = 0.80 if spike else 0.968
            planned = int(np.ceil(need / (1 - base_scrap[sid])))
            ideal_min = planned * cycle_of[fam]
            status = "CNF" if finish <= today else ("REL" if start <= today else "CRTD")
            aufnr = f"{4000000 + len(prod_rows) + 1}"
            if status == "CNF":
                scrap = int(rng.binomial(planned, scrap_rate))
                good = planned - scrap
                run_min = int(ideal_min * rng.uniform(1.15, 1.45) * (1.1 if spike else 1))
                down = int(ideal_min * rng.uniform(0.10, 0.25) * (2.0 if spike else 1))
                stock += good
            else:
                scrap = good = run_min = down = 0
            stock -= demand_w
            prod_rows.append({"aufnr": aufnr, "site_id": sid, "matnr": matnr, "family": fam,
                              "work_centre": str(rng.choice(work_centres[fam])), "release": release, "start": start,
                              "finish": finish, "status": status, "planned": planned, "good": good, "scrap": scrap,
                              "planned_min": ideal_min, "run_min": run_min, "down_min": down})
            if status == "CNF":
                passed = rng.random() < fpy
                if passed:
                    code = ""
                elif spike:
                    code = str(rng.choice(list(DEFECTS), p=[0.15, 0.05, 0.7, 0.05, 0.05]))
                else:
                    code = str(rng.choice(list(DEFECTS), p=[0.35, 0.25, 0.15, 0.15, 0.10]))
                insp_rows.append({"insp_lot": f"89{aufnr}", "aufnr": aufnr, "site_id": sid,
                                  "insp_date": finish, "result": "PASS" if passed else "FAIL", "defect": code,
                                  "first_pass": "Y" if passed else "N",
                                  "inspected_qty": min(good + scrap, max(5, (good + scrap) // 10))})
    prod_df = pd.DataFrame(prod_rows)

    # ---- Stock movements (finished goods) ----------------------------------
    moves = []
    for m in materials:
        moves.append((C.SIM_START, "561", "S", m["matnr"], m["site_id"], opening[m["matnr"]]))
    for r in prod_df[prod_df["status"] == "CNF"].itertuples(index=False):
        if r.finish <= today:
            moves.append((r.finish, "101", "S", r.matnr, r.site_id, int(r.good)))
    shipped = lines_df[lines_df["ship"] <= today]
    for r in shipped.itertuples(index=False):
        moves.append((r.ship, "601", "H", r.matnr, r.site_id, int(r.qty_ship)))
    moves.sort(key=lambda x: (x[0], x[1], x[3]))
    mrng = np.random.default_rng([C.SEED, 5])
    dup_mask = mrng.random(len(moves)) < 0.003
    move_rows = []
    for i, (budat, bwart, shkzg, matnr, sid, q) in enumerate(moves):
        row = {"MBLNR": f"{4900000000 + i}", "ZEILE": "0001", "BUDAT": budat, "BWART": bwart, "SHKZG": shkzg,
               "MATNR": matnr, "WERKS": SITE[sid]["plant"], "MENGE": f"{q:.3f}", "MEINS": "EA"}
        move_rows.append(row)
        if dup_mask[i]:
            move_rows.append(dict(row))  # duplicated document from a retried interface

    # ---- Purchasing --------------------------------------------------------
    po_rows, gr_rows = [], []
    po_no = 0
    raws_by_cat = defaultdict(list)
    for r in raws:
        raws_by_cat[r["cat"]].append(r)
    d = C.SIM_START
    while d <= today:
        if d.weekday() < 5:
            for sid, s in SITE.items():
                rng = np.random.default_rng([C.SEED, 7, sid, d.toordinal()])
                sups = [x for x in suppliers if x["company"] == s["company"]
                        and (sid == 3 or not x["name"].startswith(CRITICAL_SUPPLIER))]
                sw = np.array([3.0 if x["name"].startswith(CRITICAL_SUPPLIER) else 1.0 for x in sups])
                sw /= sw.sum()
                for _ in range(int(rng.poisson(3.2))):
                    po_no += 1
                    sup = sups[int(rng.choice(len(sups), p=sw))]
                    lead = int(rng.integers(14, 41))
                    due = d + dt.timedelta(days=lead)
                    p_late = sup["p_late"]
                    late_max = 8
                    if sup["name"].startswith(CRITICAL_SUPPLIER):
                        r_ = ramp(due, anchor - dt.timedelta(days=150), anchor - dt.timedelta(days=45))
                        p_late = 0.10 + 0.55 * r_
                        late_max = 8 + int(14 * r_)
                    for li in range(1 + int(rng.poisson(0.8))):
                        rm = raws_by_cat[sup["cat"]][int(rng.integers(0, 25))]
                        qty = int(rng.integers(5, 80)) * 25
                        price = rm["price_gbp"] * budget_rate(SITE_CCY[sid], d)
                        receipt = due + dt.timedelta(days=int(rng.integers(1, late_max + 1))) if rng.random() < p_late \
                            else due - dt.timedelta(days=int(rng.integers(0, 4)))
                        ebeln = f"{4500000000 + po_no}"
                        po_rows.append({"EBELN": ebeln, "EBELP": f"{(li + 1) * 10:05d}", "LIFNR": sup["lifnr"],
                                        "WERKS": s["plant"], "MATNR": rm["matnr"], "MENGE": f"{qty:.3f}",
                                        "NETWR": f"{qty * price:.2f}", "WAERS": SITE_CCY[sid],
                                        "BEDAT": d, "EINDT": due})
                        if receipt <= today:
                            gr_rows.append({"EBELN": ebeln, "EBELP": f"{(li + 1) * 10:05d}",
                                            "BELNR": f"{5000000000 + len(gr_rows)}", "BUDAT": receipt,
                                            "MENGE": f"{qty:.3f}"})
        d += DAY

    # ---- Budget (Finance builds it in Excel: prior year + growth + price) --
    inv = lines_df[lines_df["invoice"] <= today].copy()
    inv["month"] = inv["invoice"].map(lambda x: x.replace(day=1))
    cost_lookup = inv.apply(lambda r: std_cost[(r.matnr, fy_of(r.invoice))] if fy_of(r.invoice) in ("FY2025/26", "FY2026/27")
                            else std_cost[(r.matnr, "FY2025/26")], axis=1)
    inv["cost"] = cost_lookup * inv["qty_ship"]
    inv["rev"] = inv["unit"] * inv["qty_ship"]
    monthly = inv.groupby(["site_id", "month"], as_index=False)[["rev", "cost"]].sum()
    brng = np.random.default_rng([C.SEED, 11])
    budget_rows = []
    fy26 = monthly[(monthly["month"] >= dt.date(2025, 4, 1)) & (monthly["month"] < dt.date(2026, 4, 1))]
    for sid, s in SITE.items():
        site_m = fy26[fy26["site_id"] == sid].set_index("month")
        gm_pct = 1 - site_m["cost"].sum() / site_m["rev"].sum()
        fam_mix = lines_df[lines_df["site_id"] == sid].groupby("family")["netwr"].sum()
        price_plan = sum(fam_mix[f] * C.PRICE_RISE_PLAN_FY27[f] for f in fam_mix.index) / fam_mix.sum()
        for i in range(24):
            month = dt.date(2025 + (3 + i) // 12, (3 + i) % 12 + 1, 1)
            py_month = dt.date(month.year - 1, month.month, 1)
            if month < dt.date(2026, 4, 1):
                base = site_m.loc[month, "rev"] if month in site_m.index else site_m["rev"].mean()
                rev_b = base * brng.uniform(0.975, 1.035)
                gm_b = gm_pct + brng.normal(0, 0.004)
            else:
                base = site_m.loc[py_month, "rev"] if py_month in site_m.index else site_m["rev"].mean()
                # plan converts prior-year local revenue at the new budget FX
                fx_adj = C.BUDGET_FX["FY2026/27"][SITE_CCY[sid]] / C.BUDGET_FX["FY2025/26"][SITE_CCY[sid]]
                rev_b = base * (1 + s["plan_growth"]) * (1 + price_plan) * fx_adj
                gm_b = gm_pct + brng.normal(0, 0.003)  # plan assumes cost increases passed on
            budget_rows.append({"Entity": COMPANY[s["company"]]["name"], "Plant": s["plant"],
                                "Month": month.strftime("%b-%y"), "Currency": SITE_CCY[sid],
                                "Revenue Budget": f"{round(rev_b, -3):,.0f}",
                                "Gross Margin Budget": f"{round(rev_b * gm_b, -3):,.0f}",
                                "FY": fy_of(month)})

    return dict(materials=materials, raws=raws, customers=customers, dups=dups, suppliers=suppliers,
                orders=orders_df, lines=lines_df, cost_rows=cost_rows, prod=prod_df, insp=insp_rows,
                moves=move_rows, po=po_rows, gr=gr_rows, fx=fx, budget=budget_rows)


# --------------------------------------------------------------------------- emission
def month_key(d: dt.date) -> str:
    return d.strftime("%Y-%m")


def emit(sim: dict, now: dt.datetime) -> list[str]:
    L = C.LANDING_DIR
    changed: list[str] = []
    today = now.date()

    # ERP master data snapshots
    cust = [{"KUNNR": c["kunnr"], "NAME1": c["name"], "LAND1": c["country"], "VKORG": c["company"],
             "KTOKD": c["segment"], "ZZKEYACC": "X" if c.get("key") else "", "ERDAT": odata_date(dt.date(2019, 1, 1))}
            for c in sim["customers"] + sim["dups"]]
    write_if_changed(L / "erp/customers/snapshot.json", odata_payload(cust), changed)
    mats = [{"MATNR": m["matnr"], "MAKTX": m["desc"], "MATKL": m["family"], "MTART": "FERT", "MEINS": "EA",
             "WERKS": SITE[m["site_id"]]["plant"]} for m in sim["materials"]] + \
           [{"MATNR": r["matnr"], "MAKTX": r["desc"], "MATKL": r["cat"], "MTART": "ROH", "MEINS": "EA", "WERKS": ""}
            for r in sim["raws"]]
    write_if_changed(L / "erp/materials/snapshot.json", odata_payload(mats), changed)
    sups = [{"LIFNR": s["lifnr"], "NAME1": s["name"], "LAND1": s["country"], "ZZCATEG": s["cat"],
             "ZZCRITICAL": "X" if s["critical"] else ""} for s in sim["suppliers"]]
    write_if_changed(L / "erp/suppliers/snapshot.json", odata_payload(sups), changed)
    write_if_changed(L / "erp/cost_standards/snapshot.json", odata_payload(sim["cost_rows"]), changed)

    def partitioned(entity: str, rows: list[dict], date_field: str, to_row):
        parts = defaultdict(list)
        for r in rows:
            parts[month_key(r[date_field])].append(to_row(r))
        for k, v in parts.items():
            write_if_changed(L / f"erp/{entity}/{k}.json", odata_payload(v), changed)

    orders = sim["orders"][sim["orders"]["created"] <= now].to_dict("records")
    ok = {o["vbeln"] for o in orders}
    partitioned("sales_order_headers", orders, "created", lambda o: {
        "VBELN": o["vbeln"], "ERDAT": odata_date(o["created"].date()), "ERZET": o["created"].strftime("PT%HH%MM%SS"),
        "KUNNR": o["kunnr"], "VKORG": o["company"], "WERKS": SITE[o["site_id"]]["plant"], "WAERK": o["currency"],
        "VDATU": odata_date(o["requested"])})
    lines = [l for l in sim["lines"].to_dict("records") if l["vbeln"] in ok]
    partitioned("sales_order_items", lines, "created", lambda l: {
        "VBELN": l["vbeln"], "POSNR": l["posnr"], "MATNR": l["matnr"], "KWMENG": f"{l['qty']:.3f}",
        "NETPR": f"{l['unit']:.2f}", "NETWR": f"{l['netwr']:.2f}", "WAERK": l["currency"],
        "EDATU": odata_date(l["promised"]), "WERKS": SITE[l["site_id"]]["plant"]})
    deliv = [l for l in lines if l["ship"] <= today]
    partitioned("deliveries", deliv, "ship", lambda l: {
        "VBELN_VL": f"8{l['vbeln'][2:]}", "POSNR_VL": l["posnr"], "VGBEL": l["vbeln"], "VGPOS": l["posnr"],
        "LFIMG": f"{l['qty_ship']:.3f}", "WADAT_IST": odata_date(l["ship"]), "WERKS": SITE[l["site_id"]]["plant"]})
    bill = [l for l in lines if l["invoice"] <= today]
    partitioned("billing", bill, "invoice", lambda l: {
        "VBELN_VF": f"9{l['vbeln'][2:]}", "POSNR": l["posnr"], "AUBEL": l["vbeln"], "AUPOS": l["posnr"],
        "FKIMG": f"{l['qty_ship']:.3f}", "NETWR": f"{l['unit'] * l['qty_ship']:.2f}", "WAERK": l["currency"],
        "FKDAT": odata_date(l["invoice"])})
    partitioned("purchase_order_items", sim["po"], "BEDAT",
                lambda r: {**r, "BEDAT": odata_date(r["BEDAT"]), "EINDT": odata_date(r["EINDT"])})
    partitioned("po_receipts", sim["gr"], "BUDAT", lambda r: {**r, "BUDAT": odata_date(r["BUDAT"])})
    partitioned("stock_movements", sim["moves"], "BUDAT", lambda r: {**r, "BUDAT": odata_date(r["BUDAT"])})

    # MES (CSV, German plants use dd.mm.yyyy)
    def mes_date(d: dt.date, sid: int) -> str:
        return d.strftime("%d.%m.%Y") if SITE[sid]["company"] == "2000" else d.isoformat()

    parts = defaultdict(list)
    for r in sim["prod"].to_dict("records"):
        parts[month_key(r["release"])].append({
            "order_no": r["aufnr"], "plant": SITE[r["site_id"]]["plant"], "material": r["matnr"],
            "work_centre": r["work_centre"], "release_date": mes_date(r["release"], r["site_id"]),
            "start_date": mes_date(r["start"], r["site_id"]), "finish_date": mes_date(r["finish"], r["site_id"]),
            "status": r["status"], "planned_qty": r["planned"], "good_qty": r["good"], "scrap_qty": r["scrap"],
            "planned_minutes": r["planned_min"], "run_minutes": r["run_min"], "downtime_minutes": r["down_min"]})
    mes_fields = ["order_no", "plant", "material", "work_centre", "release_date", "start_date", "finish_date",
                  "status", "planned_qty", "good_qty", "scrap_qty", "planned_minutes", "run_minutes", "downtime_minutes"]
    for k, v in parts.items():
        write_if_changed(L / f"mes/production_orders/{k}.csv", to_csv(v, mes_fields), changed)

    parts = defaultdict(list)
    for r in sim["insp"]:
        parts[month_key(r["insp_date"])].append({
            "inspection_lot": r["insp_lot"], "production_order": r["aufnr"], "plant": SITE[r["site_id"]]["plant"],
            "inspection_date": r["insp_date"].isoformat(), "result": r["result"], "defect_code": r["defect"],
            "defect_text": DEFECTS.get(r["defect"], ""), "first_pass": r["first_pass"],
            "inspected_qty": r["inspected_qty"]})
    qfields = ["inspection_lot", "production_order", "plant", "inspection_date", "result", "defect_code",
               "defect_text", "first_pass", "inspected_qty"]
    for k, v in parts.items():
        write_if_changed(L / f"qms/inspections/{k}.csv", to_csv(v, qfields), changed)

    parts = defaultdict(list)
    for d, rates in sim["fx"].items():
        parts[month_key(d)].append({"date": d.isoformat(), "base": "GBP", "rates": {"EUR": rates["EUR"], "USD": rates["USD"]}})
    for k, v in parts.items():
        write_if_changed(L / f"fx/daily_rates/{k}.json", json.dumps(v, separators=(",", ":")), changed)

    bfields = ["FY", "Entity", "Plant", "Month", "Currency", "Revenue Budget", "Gross Margin Budget"]
    for fy in ("FY2025/26", "FY2026/27"):
        rows = [r for r in sim["budget"] if r["FY"] == fy]
        write_if_changed(L / f"finance/budget/{fy.replace('/', '-')}.csv", to_csv(rows, bfields), changed)
    return changed


def run(now: dt.datetime | None = None) -> list[str]:
    now = now or C.now()
    sim = simulate(now)
    return emit(sim, now)


if __name__ == "__main__":
    import time
    t = time.time()
    ch = run()
    print(f"simulated up to {C.now():%Y-%m-%d %H:%M} UTC; {len(ch)} files changed in {time.time() - t:.1f}s")
