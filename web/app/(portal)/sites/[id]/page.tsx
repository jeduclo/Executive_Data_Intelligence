import Link from "next/link";
import { withViewer, fiscalYear } from "@/lib/viewer";
import { scorecard, statusOf } from "@/lib/sites";
import { dayLabel, gbp, monthLabel, num, pct, shortDay, signedPct } from "@/lib/format";
import { Empty, Locked, PageTitle, Stat, StatusIcon } from "@/components/ui";
import { ColumnsVsPlan, LineSeriesChart } from "@/components/charts";
import type { Exception } from "@/lib/brief";

export const metadata = { title: "Site · Halden Group" };

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const { v, data } = await withViewer(async (q, v) => {
    const site = (await q<{ site_id: number; site_name: string; entity_name: string; plant_code: string; currency: string; region: string }>(
      "SELECT * FROM gold.dim_site WHERE site_id = $1", [id]))[0];
    if (!site) return null;
    const c = v.caps;
    const fy = fiscalYear(v.asOf);
    const score = (await scorecard(q, v)).find((s) => s.site_id === id)!;
    const exceptions = c.exceptions ? await q<Exception>("SELECT * FROM gold.mart_exceptions WHERE site_id = $1", [id]) : [];
    const months = c.revenue
      ? await q<{ month_start: string; revenue_gbp: number; revenue_budget_gbp: number }>(
          `SELECT month_start, revenue_gbp, revenue_budget_gbp FROM gold.mart_site_month
           WHERE site_id = $1 AND fiscal_year = $2 ORDER BY 1`, [id, fy.label])
      : [];
    const weeks = c.weekly
      ? await q<{ week_start: string; otif_pct: number | null; scrap_rate: number | null; first_pass_yield: number | null; supplier_otd: number | null }>(
          `SELECT week_start, otif_pct, scrap_rate, first_pass_yield, supplier_otd FROM gold.mart_site_week
           WHERE site_id = $1 AND NOT is_current_week ORDER BY 1`, [id])
      : [];
    const overdue = c.orders
      ? await q<{ order_id: string; customer_name: string; is_key_account: boolean; promised: string; days_late: number; lines: number; value: number | null }>(`
          SELECT f.order_id, c.customer_name, c.is_key_account, min(f.promised_date) promised, max(f.days_late) days_late, count(*) lines,
                 ${c.orderMoney ? "sum(f.open_value_gbp)" : "NULL::float"} value
          FROM gold.fct_order_line f JOIN gold.dim_customer c USING (customer_id)
          WHERE f.site_id = $1 AND f.is_overdue GROUP BY 1, 2, 3
          ORDER BY ${c.orderMoney ? "value" : "days_late"} DESC NULLS LAST LIMIT 12`, [id])
      : [];
    const failures = c.production
      ? await q<{ production_order_id: string; material_id: string; family: string; finish_date: string; defect_text: string; scrap_qty: number; scrap_cost_gbp: number | null }>(`
          SELECT production_order_id, material_id, family, finish_date, defect_text, scrap_qty, scrap_cost_gbp
          FROM gold.fct_production_order WHERE site_id = $1 AND passed_first_time = false
          ORDER BY finish_date DESC, scrap_qty DESC LIMIT 8`, [id])
      : [];
    const defects = c.production
      ? await q<{ defect_text: string; n: number }>(`
          SELECT defect_text, count(*) n FROM gold.fct_production_order
          WHERE site_id = $1 AND NOT passed_first_time AND finish_date > $2::date - 28 GROUP BY 1 ORDER BY 2 DESC`, [id, v.asOf])
      : [];
    const doi = c.inventory
      ? await q<{ month_start: string; days_of_inventory: number | null }>(
          "SELECT month_start, days_of_inventory FROM gold.mart_inventory_month WHERE site_id = $1 ORDER BY 1", [id])
      : [];
    const excess = c.inventory
      ? await q<{ material_id: string; family: string; qty_on_hand: number; days_cover: number | null; value_gbp: number; excess_value_gbp: number }>(`
          SELECT material_id, family, qty_on_hand, days_cover, value_gbp, excess_value_gbp FROM gold.fct_inventory_position
          WHERE site_id = $1 AND excess_value_gbp > 0 ORDER BY excess_value_gbp DESC LIMIT 10`, [id])
      : [];
    const pos = c.purchasing
      ? await q<{ po_id: string; po_line: number; supplier_name: string; material_id: string; due_date: string; days_late: number; value_gbp: number }>(`
          SELECT po_id, po_line, supplier_name, material_id, due_date, days_late, value_gbp FROM gold.fct_po_line
          WHERE site_id = $1 AND status = 'Open' AND due_date < $2::date ORDER BY days_late DESC, value_gbp DESC LIMIT 10`, [id, v.asOf])
      : [];
    return { site, score, exceptions, months, weeks, overdue, failures, defects, doi, excess, pos };
  });

  if (!data) {
    return (
      <>
        <PageTitle eyebrow="Sites" title="This site is not visible to you" />
        <Locked
          what={`Site ${id}`}
          reason="Row-level security in PostgreSQL returned no rows for this site under your identity. The same query returns data for users entitled to it."
        />
      </>
    );
  }
  const { site, score: s, exceptions, months, weeks, overdue, failures, defects, doi, excess, pos } = data;
  const c = v.caps;
  const wk = (k: "otif_pct" | "scrap_rate" | "first_pass_yield" | "supplier_otd") => weeks.map((w) => ({ x: shortDay(w.week_start), v: w[k] }));

  return (
    <>
      <p className="text-sm mb-2"><Link href="/sites" className="link">← All sites</Link></p>
      <PageTitle eyebrow={`${site.entity_name} · plant ${site.plant_code} · reports in ${site.currency}, shown in GBP`} title={site.site_name} />

      {exceptions.length > 0 && (
        <div className="card p-4 sm:p-5 mb-5 space-y-2">
          {exceptions.map((e) => (
            <p key={e.exception_id} className="flex gap-2 items-start text-[15px]">
              <StatusIcon status={e.severity === "High" ? "critical" : "warning"} />
              <span><strong>{e.headline}.</strong> <span style={{ color: "var(--ink-2)" }}>{e.detail}.</span></span>
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {c.revenue && <Stat label="Revenue vs plan (FYTD)" value={s.revenue_ytd !== null && s.revenue_plan_ytd ? signedPct(s.revenue_ytd / s.revenue_plan_ytd - 1) : "–"} sub={`${gbp(s.revenue_ytd)} of ${gbp(s.revenue_plan_ytd)}`} status={statusOf("revenue", s)} />}
        {c.finance && <Stat label="Gross margin (FYTD)" value={pct(s.gm, 1)} sub={`plan ${pct(s.gm_plan, 1)}`} status={statusOf("gm", s)} />}
        {c.orders && <Stat label="OTIF, 4 weeks" value={pct(s.otif)} sub="target 95%" status={statusOf("otif", s)} />}
        {c.production && <Stat label="Scrap, 14 days" value={pct(s.scrap, 1)} sub="target 3%" status={statusOf("scrap", s)} />}
        {c.production && <Stat label="OEE, 4 weeks" value={pct(s.oee)} sub="target 75%" status={statusOf("oee", s)} />}
        {c.inventory && <Stat label="Days of inventory" value={s.doi === null ? "–" : Math.round(s.doi)} sub={`${gbp(s.excess)} above 60 days`} status={statusOf("doi", s)} />}
        {c.purchasing && <Stat label="Supplier on time, 8 weeks" value={pct(s.supplier_otd)} sub="target 92%" status={statusOf("supplier_otd", s)} />}
        {c.orders && <Stat label="Overdue order lines" value={num(s.overdue_lines)} sub={c.orderMoney ? gbp(s.overdue_value ?? 0) : "value hidden for your role"} />}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {c.revenue && (
          <section className="card p-5">
            <h2 className="font-semibold">Revenue by month vs plan</h2>
            <p className="text-sm mb-3" style={{ color: "var(--ink-2)" }}>Invoiced revenue at daily FX; plan at budget FX. The current month is month to date.</p>
            <ColumnsVsPlan kind="gbp" data={months.map((m) => ({ x: monthLabel(m.month_start), actual: m.revenue_gbp, plan: m.revenue_budget_gbp }))} />
          </section>
        )}
        {c.weekly && (
          <section className="card p-5">
            <h2 className="font-semibold">On-time in full by week</h2>
            <p className="text-sm mb-3" style={{ color: "var(--ink-2)" }}>Order lines measured on their promised week.</p>
            <LineSeriesChart data={wk("otif_pct").map((r) => ({ x: r.x, otif: r.v }))} series={[{ key: "otif", label: "OTIF", color: "var(--series-1)" }]} kind="pct" target={{ value: 0.95, label: "Target 95%" }} />
          </section>
        )}
      </div>

      {c.orders && (
        <section className="card p-5 mt-5 overflow-x-auto" id="orders">
          <h2 className="font-semibold">Orders past their promised date</h2>
          <p className="text-sm mb-2" style={{ color: "var(--ink-2)" }}>{c.orderMoney ? "Largest open value first." : "Most overdue first."} Click an order for its lines.</p>
          {overdue.length === 0 ? <Empty>No overdue orders.</Empty> : (
            <table className="data">
              <thead><tr><th>Order</th><th>Customer</th><th>Promised</th><th className="num">Days late</th><th className="num">Lines</th>{c.orderMoney && <th className="num">Open value</th>}</tr></thead>
              <tbody>
                {overdue.map((o) => (
                  <tr key={o.order_id}>
                    <td><Link className="link tnum" href={`/orders/${o.order_id}`}>{o.order_id.replace(/^0+/, "")}</Link></td>
                    <td>{o.customer_name}{o.is_key_account && <span className="chip ml-2" style={{ padding: "0 7px", fontSize: 11 }}>Key account</span>}</td>
                    <td className="tnum">{dayLabel(o.promised)}</td>
                    <td className="num">{o.days_late}</td>
                    <td className="num">{o.lines}</td>
                    {c.orderMoney && <td className="num">{gbp(o.value)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {c.production && (
        <section className="card p-5 mt-5" id="quality">
          <h2 className="font-semibold">Quality</h2>
          <div className="grid lg:grid-cols-2 gap-6 mt-3">
            <div>
              <p className="text-sm mb-2" style={{ color: "var(--ink-2)" }}>Scrap rate by week</p>
              {c.weekly ? (
                <LineSeriesChart data={wk("scrap_rate").map((r) => ({ x: r.x, scrap: r.v }))} series={[{ key: "scrap", label: "Scrap rate", color: "var(--series-2)" }]} kind="pct1" target={{ value: 0.03, label: "Target 3%" }} yDomain={[0, "auto"]} />
              ) : <Empty>Weekly trend not available.</Empty>}
            </div>
            <div className="overflow-x-auto">
              <p className="text-sm mb-1" style={{ color: "var(--ink-2)" }}>
                Failed inspections, last 4 weeks: {defects.length ? defects.map((d) => `${d.defect_text} (${d.n})`).join(", ") : "none"}
              </p>
              <table className="data">
                <thead><tr><th>Production order</th><th>Finished</th><th>Defect</th><th className="num">Scrap</th></tr></thead>
                <tbody>
                  {failures.map((f) => (
                    <tr key={f.production_order_id}>
                      <td className="tnum">{f.production_order_id}<span className="block text-xs" style={{ color: "var(--ink-3)" }}>{f.material_id} · {f.family}</span></td>
                      <td className="tnum">{dayLabel(f.finish_date)}</td>
                      <td>{f.defect_text}</td>
                      <td className="num">{f.scrap_qty} pcs<span className="block text-xs" style={{ color: "var(--ink-3)" }}>{gbp(f.scrap_cost_gbp)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {c.inventory && (
        <section className="card p-5 mt-5" id="stock">
          <h2 className="font-semibold">Finished-goods stock</h2>
          <div className="grid lg:grid-cols-2 gap-6 mt-3">
            <div>
              <p className="text-sm mb-2" style={{ color: "var(--ink-2)" }}>Days of inventory at month end</p>
              <LineSeriesChart data={doi.map((d) => ({ x: monthLabel(d.month_start), doi: d.days_of_inventory }))} series={[{ key: "doi", label: "Days of inventory", color: "var(--series-1)" }]} kind="days" target={{ value: 45, label: "Target 45" }} yDomain={[0, "auto"]} />
            </div>
            <div className="overflow-x-auto">
              <p className="text-sm mb-1" style={{ color: "var(--ink-2)" }}>Materials with the most stock above 60 days of cover</p>
              {excess.length === 0 ? <Empty>No material is above 60 days of cover.</Empty> : (
                <table className="data">
                  <thead><tr><th>Material</th><th className="num">On hand</th><th className="num">Days cover</th><th className="num">Excess</th></tr></thead>
                  <tbody>
                    {excess.map((e) => (
                      <tr key={e.material_id}>
                        <td className="tnum">{e.material_id}<span className="block text-xs" style={{ color: "var(--ink-3)" }}>{e.family}</span></td>
                        <td className="num">{num(e.qty_on_hand)}</td>
                        <td className="num">{e.days_cover === null ? "no demand" : Math.round(e.days_cover)}</td>
                        <td className="num font-semibold">{gbp(e.excess_value_gbp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      )}

      {c.purchasing && (
        <section className="card p-5 mt-5 overflow-x-auto" id="supply">
          <h2 className="font-semibold">Overdue purchase orders</h2>
          {pos.length === 0 ? <Empty>No overdue purchase orders.</Empty> : (
            <table className="data mt-2">
              <thead><tr><th>PO</th><th>Supplier</th><th>Material</th><th>Due</th><th className="num">Days late</th><th className="num">Value</th></tr></thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={`${p.po_id}-${p.po_line}`}>
                    <td className="tnum">{p.po_id}/{p.po_line}</td>
                    <td>{p.supplier_name}</td>
                    <td className="tnum">{p.material_id}</td>
                    <td className="tnum">{dayLabel(p.due_date)}</td>
                    <td className="num">{p.days_late}</td>
                    <td className="num">{gbp(p.value_gbp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
