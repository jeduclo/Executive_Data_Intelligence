import Link from "next/link";
import { withViewer } from "@/lib/viewer";
import type { Exception } from "@/lib/brief";
import { gbp } from "@/lib/format";
import { Empty, Locked, PageTitle, StatusIcon } from "@/components/ui";

export const metadata = { title: "Alerts · Halden Group" };

const RULES = [
  ["Delivery", "OTIF over the last 4 weeks below 90%", "High below 85%"],
  ["Quality", "Scrap rate over the last 14 days above 4.5%", "High above 6%"],
  ["Working capital", "Days of finished-goods inventory above 60", "High above 90"],
  ["Supply", "Critical supplier on time below 85% over 8 weeks", "High below 70%"],
  ["Financial", "Revenue FY to date more than 5% behind plan", "High beyond 8%"],
  ["Financial", "Gross margin more than 1.5 pts below plan", "High beyond 2.5 pts"],
];

export default async function AlertsPage() {
  const { v, data } = await withViewer(async (q, v) => {
    if (!v.caps.exceptions) return null;
    const ex = await q<Exception>(v.caps.revenue
      ? "SELECT * FROM gold.mart_exceptions ORDER BY (severity = 'High') DESC, impact_gbp DESC NULLS LAST"
      : "SELECT exception_id, site_id, site_name, category, kpi_code, severity, headline, detail FROM gold.mart_exceptions");
    const seen = await q<{ exception_id: string; first_seen: Date }>("SELECT exception_id, first_seen FROM ops.alert_log");
    return ex.map((e) => ({ ...e, first_seen: seen.find((s) => s.exception_id === e.exception_id)?.first_seen ?? null }));
  });
  if (!data) return <><PageTitle title="Alerts" /><Locked what="Alerts" reason="Your database role has no access to exceptions." /></>;
  return (
    <>
      <PageTitle eyebrow="Exception reporting" title="Only what is off track, ranked by money at stake">
        Recomputed on every pipeline run from the gold layer. New high-severity exceptions are pushed to Microsoft Teams or Slack
        (webhook) - nobody has to open a dashboard to find out. Row-level security applies: you only see your sites.
      </PageTitle>
      <div className="card divide-y" style={{ borderColor: "var(--grid)" }}>
        {data.length === 0 && <Empty>Nothing is outside its threshold for your sites.</Empty>}
        {data.map((e) => (
          <div key={e.exception_id} className="p-4 sm:p-5 grid grid-cols-[auto_1fr_auto] gap-3" style={{ borderColor: "var(--grid)" }}>
            <StatusIcon status={e.severity === "High" ? "critical" : "warning"} size={18} />
            <div>
              <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                {e.severity} · {e.category} · <Link className="link" href={`/sites/${e.site_id}`}>{e.site_name}</Link>
                {e.first_seen && <> · first detected {new Date(e.first_seen).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</>}
              </p>
              <p className="font-semibold mt-0.5">{e.headline}</p>
              <p className="text-sm" style={{ color: "var(--ink-2)" }}>{e.detail}</p>
            </div>
            {e.impact_gbp != null && <p className="tnum font-semibold text-right">{gbp(e.impact_gbp)}<span className="block text-xs font-normal" style={{ color: "var(--ink-3)" }}>at stake</span></p>}
          </div>
        ))}
      </div>
      <section className="mt-8">
        <h2 className="font-semibold mb-2">Thresholds</h2>
        <div className="card overflow-x-auto">
          <table className="data">
            <thead><tr><th>Area</th><th>Raises an exception when</th><th>Severity</th></tr></thead>
            <tbody>{RULES.map((r) => <tr key={r[1]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--ink-3)" }}>Defined in <code>pipeline/dbt/models/gold/mart_exceptions.sql</code> - version-controlled and reviewable like any other business rule.</p>
      </section>
    </>
  );
}
