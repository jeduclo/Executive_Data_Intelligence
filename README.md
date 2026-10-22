# Halden Group – Enterprise Reporting POC

A working proof of concept for lead **M102726**: a governed, automated, multi-site reporting platform built on a
medallion architecture with open tools, presented through a question-led executive portal.

```
Source systems ──► dlt ──► Bronze ──► Silver ──► Gold ──► PostgreSQL ──► Next.js portal (Vercel)
(SAP-style ERP,    ingest   (DuckDB)   (dbt)      (dbt +    (RLS + column     Power BI
 MES, QMS, FX,                                     tests)    grants)          Teams / Slack alerts
 Excel budget)          └──────── pipeline/run.py (GitHub Actions schedule) ────────┘
```

All data is **synthetic**: a fictional five-plant manufacturer (UK, Germany, US; GBP/EUR/USD) with about 19 months of
history. Four business problems are planted in the data for the executive brief to surface:

| Story | What the C-suite should see |
|---|---|
| Stuttgart delivery collapse | OTIF falls from ~96% to ~63%; root cause is a critical castings supplier (Kessler) delivering ~30% on time |
| Hydraulic-valve margin erosion | FY26/27 cost increase (+9.5%) not passed into price (+1%) – about £1.2m margin lost year to date |
| Detroit cash in stock | Safety stock raised "to protect service": days of inventory 35 → 105, £2.6m above 60 days of cover |
| Leipzig quality spike | Scrap jumps to ~10% in the last two weeks (casting porosity) and fires a live alert |

The simulation is driven by the clock, so each pipeline run "trickles in" new orders, shipments and production.

---

## Repository layout

```
pipeline/
  config.py              organisation, seed, paths
  generator/simulate.py  source-system simulator (SAP OData JSON, MES/QMS CSV, FX JSON, Excel budget CSV)
  ingest/landing_source.py  dlt source -> bronze (incremental, hash-tracked files)
  dbt/                   silver + gold models, tests, seeds (sites, budget FX, KPI definitions)
  publish/               publish gold to Postgres; roles, RLS policies, column grants
  run.py                 orchestrator: simulate -> ingest -> dbt build -> publish -> alert
  requirements.txt
web/                     Next.js 16 portal (App Router, Recharts, Tailwind v4, node-postgres)
.github/workflows/pipeline.yml   scheduled refresh
.vscode/                 tasks: run pipeline, live loop, portal dev server
```


## The portal

| Page | Purpose |
|---|---|
| **Executive brief** | Six questions a board asks, each answered in one sentence computed from the data, then the evidence: Will we hit plan? Where is margin leaking? Are we keeping promises to customers? Is cash tied up in stock? Is quality costing money? Is the supply base a risk? No vanity counts. |
| Sites | Scorecard of every governed KPI by site, worst first |
| Site → Order | Drill-down to overdue orders, failed inspections, excess materials, overdue POs, order lines |
| Alerts | Exceptions ranked by money at stake, thresholds documented |
| Architecture | Clickable medallion diagram with live run stats and requirement coverage |
| Security model | The same SQL executed live as every persona – rows and columns differ only because of Postgres |
| Data quality | Run history, dbt test results, corrections made in silver |
| KPI definitions | The single definition of each KPI |

## Personas

| Persona | DB role | Rows | Columns |
|---|---|---|---|
| Helen Carter, Group CEO | `rpt_executive` | all sites | all |
| Alex Morgan, Group CFO | `rpt_executive` | all sites | all |
| Priya Shah, Finance BP UK | `rpt_finance` | Birmingham, Coventry | all |
| Jonas Weber, Plant Manager Stuttgart | `rpt_site_manager` | Stuttgart | no cost or margin |
| Maria Lopez, Customer Service | `rpt_customer_service` | all sites | order status only, no money |

## Suggested 20-minute demo

1. **Architecture** – walk the flow; show the requirement-coverage table built from their brief.
2. **Executive brief as the CEO** – read the six answers; drill Stuttgart → overdue order → lines.
3. **Supply link** – Q6 shows Kessler's on-time collapse tracking Stuttgart OTIF: the root cause, not just the symptom.
4. **Switch to Jonas (Stuttgart)** – only Stuttgart appears; margin sections are locked by the database.
5. **Security model** – the live matrix and the real Postgres `permission denied` error.
6. **Data quality** – what silver fixed (duplicate customers, German date formats, retried postings).
7. **Live refresh** – run the pipeline; new orders arrive, and the Leipzig scrap alert posts to Teams.
8. **Power BI** – open the same gold tables; the numbers match. "Your Power BI, without the manual preparation."

## Moving beyond the POC

- SAP: replace the file readers with dlt `rest_api` (SAP Gateway OData / ODP) or SAP Datasphere replication.
- Scale: the same dbt models run on MotherDuck or a cloud warehouse; Dagster replaces `run.py` for lineage and retries.
- Identity: Entra ID SSO, with group membership feeding `sec.user_site_access`.
- Out of scope here: multi-language, CDC/streaming, write-back workflow.
