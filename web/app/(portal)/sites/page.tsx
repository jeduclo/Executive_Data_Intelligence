import Link from "next/link";
import { withViewer } from "@/lib/viewer";
import { scorecard, statusOf, type Score } from "@/lib/sites";
import { gbp, pct, signedPct } from "@/lib/format";
import { PageTitle, StatusIcon, type Status } from "@/components/ui";

export const metadata = { title: "Sites · Halden Group" };

type Col = {
  key: string;
  label: string;
  sub: string;
  show: boolean;
  status: (r: Score) => Status;
  value: (r: Score) => string;
};

export default async function SitesPage() {
  const { v, data: rows } = await withViewer(scorecard);
  const c = v.caps;
  const all: Col[] = [
    { key: "revenue", label: "Revenue vs plan", sub: "FY to date", show: c.revenue, status: (r) => statusOf("revenue", r),
      value: (r) => (r.revenue_ytd !== null && r.revenue_plan_ytd ? signedPct(r.revenue_ytd / r.revenue_plan_ytd - 1) : "–") },
    { key: "gm", label: "Gross margin", sub: "FY to date vs plan", show: c.finance, status: (r) => statusOf("gm", r),
      value: (r) => (r.gm !== null ? `${pct(r.gm, 1)} / ${pct(r.gm_plan, 1)}` : "–") },
    { key: "otif", label: "OTIF", sub: "last 4 weeks · 95%", show: c.orders, status: (r) => statusOf("otif", r), value: (r) => pct(r.otif) },
    { key: "overdue", label: "Overdue orders", sub: c.orderMoney ? "value past promise" : "lines past promise", show: c.orders,
      status: (r) => ((r.overdue_lines ?? 0) > 60 ? "critical" : (r.overdue_lines ?? 0) > 25 ? "warning" : "good"),
      value: (r) => (c.orderMoney ? gbp(r.overdue_value ?? 0) : String(r.overdue_lines ?? 0)) },
    { key: "scrap", label: "Scrap", sub: "last 14 days · 3%", show: c.production, status: (r) => statusOf("scrap", r), value: (r) => pct(r.scrap, 1) },
    { key: "fpy", label: "First-pass yield", sub: "last 4 weeks · 95%", show: c.production, status: (r) => statusOf("fpy", r), value: (r) => pct(r.fpy) },
    { key: "oee", label: "OEE", sub: "last 4 weeks · 75%", show: c.production, status: (r) => statusOf("oee", r), value: (r) => pct(r.oee) },
    { key: "doi", label: "Days of inventory", sub: "today · 45", show: c.inventory, status: (r) => statusOf("doi", r), value: (r) => (r.doi === null ? "–" : String(Math.round(r.doi))) },
    { key: "excess", label: "Excess stock", sub: ">60 days cover", show: c.inventory,
      status: (r) => ((r.excess ?? 0) > 500_000 ? "critical" : (r.excess ?? 0) > 100_000 ? "warning" : "good"), value: (r) => gbp(r.excess ?? 0) },
    { key: "sotd", label: "Supplier on time", sub: "last 8 weeks · 92%", show: c.purchasing, status: (r) => statusOf("supplier_otd", r), value: (r) => pct(r.supplier_otd) },
  ];
  const cols = all.filter((x) => x.show);
  const breaches = (r: Score) => cols.filter((x) => x.status(r) === "critical").length * 10 + cols.filter((x) => x.status(r) === "warning").length;
  const sorted = [...rows].sort((a, b) => breaches(b) - breaches(a));

  return (
    <>
      <PageTitle eyebrow="Sites" title="Which sites need help, and with what?">
        Every site on the same governed KPI definitions. Sites with the most breaches are listed first; click a site to drill down to
        orders, production orders and purchase orders.
      </PageTitle>
      <div className="card overflow-x-auto">
        <table className="data min-w-[860px]">
          <thead>
            <tr>
              <th>Site</th>
              {cols.map((x) => (
                <th key={x.key} className="num">
                  <span className="block">{x.label}</span>
                  <span className="block normal-case tracking-normal font-normal">{x.sub}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.site_id}>
                <td>
                  <Link href={`/sites/${r.site_id}`} className="link font-semibold">{r.site_name}</Link>
                  <span className="block text-xs" style={{ color: "var(--ink-3)" }}>{r.entity_name} · {r.currency}</span>
                </td>
                {cols.map((x) => (
                  <td key={x.key} className="num">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <StatusIcon status={x.status(r)} size={13} />
                      {x.value(r)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>
        Icons: <StatusIcon status="good" size={11} /> on target · <StatusIcon status="warning" size={11} /> watch ·{" "}
        <StatusIcon status="critical" size={11} /> action needed. Columns your role cannot read are not shown (column-level security).
      </p>
    </>
  );
}
