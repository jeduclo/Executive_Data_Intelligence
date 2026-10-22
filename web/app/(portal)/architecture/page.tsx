import { withViewer } from "@/lib/viewer";
import { num } from "@/lib/format";
import ArchitectureDiagram, { type Column, type Node } from "@/components/ArchitectureDiagram";
import { PageTitle, StatusIcon, type Status } from "@/components/ui";

export const metadata = { title: "Architecture · Halden Group" };

type Run = { files_changed: number; rows_ingested: number; tests_passed: number; tests_warned: number; tests_failed: number; step_seconds: Record<string, number>; finished_at: Date };

const REQUIREMENTS: [string, Status, string][] = [
  ["Bring together SAP, finance, manufacturing, sales, procurement, inventory, supply chain and quality data", "good", "Six source feeds (ERP orders, deliveries, billing, purchasing, stock; MES; QMS; FX; budget) land in one governed model."],
  ["SAP data integration", "warning", "Simulated SAP OData extracts with real SAP field names. Phase 2: dlt rest_api source against SAP Gateway/ODP or Datasphere - access route to confirm."],
  ["Live, automated visibility of production, stock and order status", "good", "Scheduled micro-batches (15 min demo cadence). True real-time via CDC is a phase-2 option."],
  ["Standardise KPIs across ~150 locations", "good", "12 KPIs defined once in dbt and published with their definitions (see KPI definitions)."],
  ["Group consolidation with drill-down to site, operation and transaction", "good", "Brief → site → order → order line; production and purchase orders per site."],
  ["Multi-company, multi-currency", "good", "Three legal entities, GBP/EUR/USD; daily FX for actuals, budget FX for plan."],
  ["Automated and scheduled reporting, workflow and alerts", "good", "Exception mart recomputed every run; new high-severity items pushed to Teams/Slack."],
  ["Profitability analysis, variance and trend analysis", "good", "Margin by family vs prior year, revenue and margin vs budget, landing forecast."],
  ["Role-based access, audit trails, data governance", "good", "PostgreSQL RLS + column grants; run history, dlt load ids and dbt test results retained."],
  ["Integration with Microsoft 365, Excel and Power BI; open APIs", "good", "Gold layer is plain PostgreSQL: Power BI, Excel and any SQL/REST client connect directly."],
  ["Mobile dashboards", "good", "Responsive portal."],
  ["Self-service and ad-hoc reporting", "warning", "Via Power BI or Excel on the gold layer; not built into this portal."],
  ["Multi-language reporting", "critical", "Out of scope for the POC (English only)."],
];

export default async function ArchitecturePage() {
  const { data } = await withViewer(async (q) => {
    const [run] = await q<Run>("SELECT * FROM ops.pipeline_run ORDER BY finished_at DESC LIMIT 1");
    const [fixes] = await q<{ n: number }>("SELECT sum(records_affected) n FROM ops.data_corrections WHERE correction NOT LIKE 'Budget%'");
    return { run, fixes: fixes?.n ?? 0 };
  });
  const r = data.run;
  const s = (k: string) => (r?.step_seconds?.[k] !== undefined ? `${r.step_seconds[k]}s` : "");
  const tests = r ? r.tests_passed + r.tests_warned + r.tests_failed : 0;

  const columns: Column[] = [
    {
      id: "sources", label: "Source systems", tone: "var(--series-2)",
      nodes: [
        { id: "erp", title: "SAP ERP", tech: "OData v2 JSON", poc: "Simulated extracts using SAP structures and field names (VBAK/VBAP, LIPS, VBRP, EKPO/EKBE, MSEG, MBEW, KNA1, LFA1), including real-world defects: duplicate customers, missing currencies, retried interface postings.", production: "SAP Gateway OData services or ODP extractors (or SAP Datasphere replication) per company code. Access route and licensing to be confirmed with Basis." },
        { id: "mes", title: "MES", tech: "CSV drops", poc: "Production orders with planned/actual quantities, scrap and downtime. German plants export dd.mm.yyyy dates.", production: "File drops from SharePoint/SFTP or direct database reads, per plant." },
        { id: "qms", title: "Quality system", tech: "Inspection lots", poc: "Inspection results and defect codes per production order.", production: "QMS database or SAP QM via the same ERP route." },
        { id: "fin", title: "Finance budget + FX", tech: "Excel export · JSON", poc: "Budget arrives as an Excel export with month labels and thousands separators; daily FX rates in GBP base.", production: "Budget workbook from the planning team (or the planning tool's API); ECB/treasury FX feed." },
      ],
    },
    {
      id: "ingest", label: "Ingest", tone: "var(--series-1)",
      nodes: [{ id: "dlt", title: "dlt pipelines", tech: "Python · incremental", stat: r ? `${num(r.rows_ingested)} rows from ${r.files_changed} changed files · ${s("ingest")}` : undefined, poc: "One resource per feed. Only changed files are re-read (content hash kept in dlt state); each monthly partition is replaced atomically. Schema changes are detected and evolved automatically.", production: "Swap file readers for dlt's rest_api (SAP OData), sql_database and filesystem sources - downstream layers are untouched. Runs per company code in parallel." }],
    },
    {
      id: "bronze", label: "Bronze", tone: "var(--series-4)",
      nodes: [{ id: "bronze", title: "Raw, as received", tech: "DuckDB", poc: "An exact copy of what each source sent - duplicates and errors included - with dlt load ids for lineage and audit.", production: "Object storage (Parquet/Delta/Iceberg) or the warehouse's raw schema; retained for replay and audit." }],
    },
    {
      id: "silver", label: "Silver", tone: "var(--series-3)",
      nodes: [{ id: "silver", title: "Cleaned and conformed", tech: "dbt · DuckDB", stat: `${num(data.fixes)} records corrected`, poc: "Types and parses SAP dates, normalises German date formats, merges duplicate customers into golden records, de-duplicates postings, imputes missing currencies, applies standard-cost validity and daily FX.", production: "Same dbt models, run on DuckDB/MotherDuck or a cloud warehouse (Fabric, Snowflake, Databricks) as volumes grow." }],
    },
    {
      id: "gold", label: "Gold", tone: "var(--series-5)",
      nodes: [{ id: "gold", title: "KPIs and star schema", tech: "dbt · tests", stat: r ? `${r.tests_passed}/${tests} tests passed · dbt ${s("dbt_build")}` : undefined, poc: "Facts at transaction grain (order line, production order, PO line, stock position) plus governed KPI marts, budget and the exception mart. Every model is tested; failing tests block publishing.", production: "Unchanged. New sites only add rows - KPI definitions stay identical across all 150 locations." }],
    },
    {
      id: "serve", label: "Serve", tone: "var(--series-1)",
      nodes: [{ id: "pg", title: "PostgreSQL", tech: "RLS + column grants", stat: r ? `published in ${s("publish")}` : undefined, poc: "Gold tables published in one transaction, then security re-applied: row-level policies by site, column grants by role. Runs on Neon (serverless Postgres).", production: "Azure Database for PostgreSQL (fits the Microsoft estate) or the warehouse's own serving layer, with Entra ID groups feeding entitlements." }],
    },
    {
      id: "consume", label: "Consume", tone: "var(--series-2)",
      nodes: [
        { id: "portal", title: "Executive portal", tech: "Next.js · Recharts · Vercel", poc: "This site. Question-led executive brief with drill-down to transactions; every query runs under the user's database role.", production: "Optional - kept for customer-facing order status and workflow, where Power BI is weaker." },
        { id: "pbi", title: "Power BI", tech: "DirectQuery / import", poc: "Connects to the same gold schema; KPI definitions and entitlement tables are shared, so numbers match the portal.", production: "Primary reporting front end for the group; RLS/OLS roles driven from sec.* tables." },
        { id: "alerts", title: "Alerts", tech: "Teams · Slack webhooks", poc: "New high-severity exceptions are posted after each run and logged with their first-detected time.", production: "Teams channels per function or site; Power Automate for follow-up workflow." },
      ],
    },
  ];
  const orchestration: Node = {
    id: "orch", title: "Orchestration - simulate → ingest → transform + test → publish → alert", tech: "pipeline/run.py · GitHub Actions schedule",
    stat: r ? `end to end ${Math.round(Object.values(r.step_seconds ?? {}).reduce((t, x) => t + x, 0))}s` : undefined,
    poc: "A single Python entry point runs every stage in order and stops before publishing if any data test fails. Scheduled by GitHub Actions; can also loop every 15 minutes on a laptop for a live demo.",
    production: "Dagster (native dlt and dbt integration, lineage, retries, per-site partitions) or Azure Data Factory if the client standardises on Azure.",
  };

  return (
    <>
      <PageTitle eyebrow="Architecture" title="From source systems to the board pack, automatically">
        A medallion architecture built from open tools. Click any component for what it does here and how it scales to 150 sites.
      </PageTitle>
      <ArchitectureDiagram columns={columns} orchestration={orchestration} />

      <section className="mt-8">
        <h2 className="text-xl font-semibold tracking-tight">Your requirements, and how the POC answers them</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="data min-w-[720px]">
            <thead><tr><th>Requirement (from the brief)</th><th>Coverage</th><th>How</th></tr></thead>
            <tbody>
              {REQUIREMENTS.map(([req, st, how]) => (
                <tr key={req}>
                  <td className="max-w-xs">{req}</td>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold"><StatusIcon status={st} size={13} />{st === "good" ? "Demonstrated" : st === "warning" ? "Partly / phase 2" : "Not in POC"}</span>
                  </td>
                  <td style={{ color: "var(--ink-2)" }}>{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
