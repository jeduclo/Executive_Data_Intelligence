import "server-only";
import type { Query } from "./db";
import { fiscalYear, type Viewer } from "./viewer";

type SiteRow = { site_id: number; site_name: string; entity_name: string };

export type Exception = {
  exception_id: string;
  site_id: number;
  site_name: string;
  category: string;
  kpi_code: string;
  severity: "High" | "Medium";
  impact_gbp: number | null;
  headline: string;
  detail: string;
};

function addDays(iso: string, d: number): string {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

function fyMonths(start: string): string[] {
  const [y] = start.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const yy = y + Math.floor((3 + i) / 12);
    return `${yy}-${String(m).padStart(2, "0")}-01`;
  });
}

export async function loadBrief(q: Query, v: Viewer) {
  const fy = fiscalYear(v.asOf);
  const asOf = v.asOf;
  const curMonth = asOf.slice(0, 7) + "-01";
  const sites = await q<SiteRow>("SELECT site_id, site_name, entity_name FROM gold.dim_site ORDER BY site_id");
  const siteName = new Map(sites.map((s) => [s.site_id, s.site_name]));
  const c = v.caps;

  // ---------------------------------------------------------------- exceptions
  const exceptions = c.exceptions
    ? await q<Exception>(c.orderMoney || c.finance || c.revenue
        ? "SELECT * FROM gold.mart_exceptions ORDER BY (severity = 'High') DESC, impact_gbp DESC NULLS LAST"
        : "SELECT exception_id, site_id, site_name, category, kpi_code, severity, headline, detail FROM gold.mart_exceptions")
    : null;

  // ---------------------------------------------------------------- Q1 plan
  let plan = null;
  if (c.revenue) {
    const actual = await q<{ site_id: number; month_start: string; is_complete_month: boolean; revenue_gbp: number }>(
      "SELECT site_id, month_start, is_complete_month, revenue_gbp FROM gold.mart_site_month WHERE fiscal_year = $1", [fy.label]);
    const budget = await q<{ site_id: number; month_start: string; revenue_budget_gbp: number }>(
      "SELECT site_id, month_start, revenue_budget_gbp FROM gold.fct_budget_month WHERE fiscal_year = $1", [fy.label]);
    const months = fyMonths(fy.start);
    const complete = new Set(actual.filter((a) => a.is_complete_month).map((a) => a.month_start));
    const completeMonths = months.filter((m) => complete.has(m));
    const last3 = completeMonths.slice(-3);
    const bySite = sites.map((s) => {
      const a = (m: string) => actual.find((r) => r.site_id === s.site_id && r.month_start === m)?.revenue_gbp ?? 0;
      const b = (m: string) => budget.find((r) => r.site_id === s.site_id && r.month_start === m)?.revenue_budget_gbp ?? 0;
      const ytd = completeMonths.reduce((t, m) => t + a(m), 0);
      const ytdPlan = completeMonths.reduce((t, m) => t + b(m), 0);
      const ratio = last3.reduce((t, m) => t + a(m), 0) / Math.max(1, last3.reduce((t, m) => t + b(m), 0));
      const remaining = months.filter((m) => !complete.has(m));
      const fyPlan = months.reduce((t, m) => t + b(m), 0);
      const landing = ytd + remaining.reduce((t, m) => t + b(m) * ratio, 0);
      return { ...s, ytd, ytdPlan, ratio, fyPlan, landing, a, b };
    });
    let cumA = 0, cumP = 0, cumF = 0;
    const lastComplete = completeMonths[completeMonths.length - 1];
    const chart = months.map((m) => {
      cumP += bySite.reduce((t, s) => t + s.b(m), 0);
      const isC = complete.has(m);
      if (isC) cumA += bySite.reduce((t, s) => t + s.a(m), 0);
      if (isC) cumF = cumA;
      else cumF += bySite.reduce((t, s) => t + s.b(m) * s.ratio, 0);
      return {
        month: m,
        actual: isC ? cumA : null,
        plan: cumP,
        forecast: m === lastComplete || !isC ? cumF : null,
      };
    });
    const tot = (k: "ytd" | "ytdPlan" | "fyPlan" | "landing") => bySite.reduce((t, s) => t + s[k], 0);
    plan = {
      months: completeMonths.length,
      lastComplete,
      ytd: tot("ytd"), ytdPlan: tot("ytdPlan"), fyPlan: tot("fyPlan"), landing: tot("landing"),
      sites: bySite.map(({ a: _a, b: _b, ...rest }) => rest).filter((s) => s.fyPlan > 0),
      chart,
    };
  }

  // ---------------------------------------------------------------- Q2 margin
  let margin = null;
  if (c.finance) {
    const fam = await q<{ family: string; rev: number; gm: number; gm_py: number | null }>(`
      WITH cy AS (SELECT family, sum(revenue_gbp) rev, sum(margin_gbp) m FROM gold.mart_margin_family_month
                  WHERE month_start >= $1::date AND month_start < $2::date GROUP BY 1),
           py AS (SELECT family, sum(revenue_gbp) rev, sum(margin_gbp) m FROM gold.mart_margin_family_month
                  WHERE month_start >= $1::date - interval '1 year' AND month_start < $2::date - interval '1 year' GROUP BY 1)
      SELECT cy.family, cy.rev, cy.m / nullif(cy.rev, 0) gm, py.m / nullif(py.rev, 0) gm_py
      FROM cy LEFT JOIN py USING (family) ORDER BY 1`, [fy.start, curMonth]);
    const families = fam.map((f) => ({ ...f, impact: f.gm_py === null ? 0 : (f.gm - f.gm_py) * f.rev }))
      .sort((a, b) => a.impact - b.impact);
    const worst = families[0];
    let unit = null;
    if (worst) {
      const u = await q<{ cy: boolean; price: number; cost: number }>(`
        SELECT invoice_date >= $1::date AS cy, sum(revenue_gbp) / sum(qty_shipped) price, sum(cost_gbp) / sum(qty_shipped) cost
        FROM gold.fct_order_line
        WHERE family = $3 AND qty_shipped > 0 AND (
              (invoice_date >= $1::date AND invoice_date < $2::date) OR
              (invoice_date >= $1::date - interval '1 year' AND invoice_date < $2::date - interval '1 year'))
        GROUP BY 1`, [fy.start, curMonth, worst.family]);
      const cy = u.find((r) => r.cy), py = u.find((r) => !r.cy);
      if (cy && py) unit = { price: cy.price / py.price - 1, cost: cy.cost / py.cost - 1 };
    }
    const bySite = await q<{ site_id: number; rev: number; gm: number; gm_plan: number }>(`
      SELECT site_id, sum(revenue_gbp) rev, sum(margin_gbp) / nullif(sum(revenue_gbp), 0) gm,
             sum(margin_budget_gbp) / nullif(sum(revenue_budget_gbp), 0) gm_plan
      FROM gold.mart_site_month WHERE fiscal_year = $1 AND is_complete_month GROUP BY 1 ORDER BY 1`, [fy.label]);
    const rev = bySite.reduce((t, s) => t + s.rev, 0);
    const gm = bySite.reduce((t, s) => t + s.gm * s.rev, 0) / Math.max(1, rev);
    const gmPlan = bySite.reduce((t, s) => t + s.gm_plan * s.rev, 0) / Math.max(1, rev);
    margin = {
      families, worst, unit, gm, gmPlan, rev,
      sites: bySite.map((s) => ({ ...s, site_name: siteName.get(s.site_id)!, gap: (s.gm - s.gm_plan) * s.rev })),
    };
  }

  // ---------------------------------------------------------------- Q3 delivery
  let delivery = null;
  if (c.orders) {
    const since = addDays(asOf, -28);
    const bySite = await q<{ site_id: number; due: number; otif: number; late: number }>(`
      SELECT site_id, count(*) due, count(*) FILTER (WHERE otif) otif, count(*) FILTER (WHERE NOT otif) late
      FROM gold.fct_order_line WHERE is_due AND promised_date > $1::date GROUP BY 1 ORDER BY 1`, [since]);
    const weekly = await q<{ site_id: number; wk: string; otif: number }>(`
      SELECT site_id, date_trunc('week', promised_date)::date wk, avg(otif::int) otif
      FROM gold.fct_order_line WHERE is_due AND promised_date > $1::date - 7 * 15
        AND date_trunc('week', promised_date) < date_trunc('week', $1::date)
      GROUP BY 1, 2 ORDER BY 2`, [asOf]);
    const overdue = c.orderMoney
      ? await q<{ site_id: number; value: number; lines: number }>(`
          SELECT site_id, sum(open_value_gbp) value, count(*) lines FROM gold.fct_order_line WHERE is_overdue GROUP BY 1`)
      : await q<{ site_id: number; value: number | null; lines: number }>(`
          SELECT site_id, NULL::float value, count(*) lines FROM gold.fct_order_line WHERE is_overdue GROUP BY 1`);
    const customers = await q<{ customer_name: string; is_key_account: boolean; late: number; due: number; value: number | null; sites: string }>(`
      SELECT c.customer_name, c.is_key_account, count(*) FILTER (WHERE NOT f.otif) late, count(*) due,
             ${c.orderMoney ? "sum(f.order_value_gbp) FILTER (WHERE NOT f.otif)" : "NULL::float"} value,
             string_agg(DISTINCT s.site_name, ', ') FILTER (WHERE NOT f.otif) sites
      FROM gold.fct_order_line f
      JOIN gold.dim_customer c USING (customer_id)
      JOIN gold.dim_site s USING (site_id)
      WHERE f.is_due AND f.promised_date > $1::date
      GROUP BY 1, 2 HAVING count(*) FILTER (WHERE NOT f.otif) > 0
      ORDER BY ${c.orderMoney ? "value" : "late"} DESC NULLS LAST LIMIT 5`, [since]);
    const due = bySite.reduce((t, s) => t + s.due, 0);
    const ok = bySite.reduce((t, s) => t + s.otif, 0);
    delivery = {
      group: due ? ok / due : null,
      sites: bySite.map((s) => ({ ...s, site_name: siteName.get(s.site_id)!, pct: s.otif / s.due })),
      weekly,
      overdue: overdue.map((o) => ({ ...o, site_name: siteName.get(o.site_id)! })),
      customers,
    };
  }

  // ---------------------------------------------------------------- Q4 stock
  let stock = null;
  if (c.inventory) {
    const monthly = await q<{ site_id: number; month_start: string; doi: number | null; value: number }>(`
      SELECT site_id, month_start, days_of_inventory doi, inventory_value_gbp value
      FROM gold.mart_inventory_month WHERE month_start >= $1::date - interval '6 months' ORDER BY 2`, [fy.start]);
    const now = await q<{ site_id: number; value: number; excess: number }>(`
      SELECT site_id, sum(value_gbp) value, sum(excess_value_gbp) excess FROM gold.fct_inventory_position GROUP BY 1 ORDER BY 1`);
    stock = { monthly, sites: now.map((s) => ({ ...s, site_name: siteName.get(s.site_id)! })) };
  }

  // ---------------------------------------------------------------- Q5 quality
  let quality = null;
  if (c.production) {
    const periods = await q<{ site_id: number; recent: boolean; scrap: number; produced: number; cost: number }>(`
      SELECT site_id, finish_date > $1::date - 28 recent, sum(scrap_qty) scrap, sum(good_qty + scrap_qty) produced,
             sum(scrap_cost_gbp) cost
      FROM gold.fct_production_order WHERE status = 'Confirmed' AND finish_date > $1::date - 56 AND finish_date <= $1::date
      GROUP BY 1, 2`, [asOf]);
    const last14 = await q<{ site_id: number; rate: number; cost: number; defect: string | null; prior_rate: number | null }>(`
      SELECT site_id,
             sum(scrap_qty) FILTER (WHERE finish_date > $1::date - 14)::float
               / nullif(sum(good_qty + scrap_qty) FILTER (WHERE finish_date > $1::date - 14), 0) rate,
             sum(scrap_cost_gbp) FILTER (WHERE finish_date > $1::date - 14) cost,
             mode() WITHIN GROUP (ORDER BY defect_text) FILTER (WHERE finish_date > $1::date - 14 AND defect_text IS NOT NULL) defect,
             sum(scrap_qty) FILTER (WHERE finish_date <= $1::date - 14)::float
               / nullif(sum(good_qty + scrap_qty) FILTER (WHERE finish_date <= $1::date - 14), 0) prior_rate
      FROM gold.fct_production_order WHERE status = 'Confirmed' AND finish_date > $1::date - 104 AND finish_date <= $1::date
      GROUP BY 1 ORDER BY 1`, [asOf]);
    const weekly = c.weekly
      ? await q<{ site_id: number; week_start: string; scrap_rate: number | null }>(`
          SELECT site_id, week_start, scrap_rate FROM gold.mart_site_week
          WHERE week_start > $1::date - 7 * 14 AND NOT is_current_week ORDER BY 2`, [asOf])
      : [];
    const sum = (recent: boolean, k: "cost" | "scrap" | "produced") =>
      periods.filter((p) => p.recent === recent).reduce((t, p) => t + (p[k] ?? 0), 0);
    quality = {
      copq: sum(true, "cost"), copqPrior: sum(false, "cost"),
      rate: sum(true, "scrap") / Math.max(1, sum(true, "produced")),
      sites: last14.map((s) => ({ ...s, site_name: siteName.get(s.site_id)! })),
      weekly,
    };
  }

  // ---------------------------------------------------------------- Q6 supply
  let supply = null;
  if (c.purchasing) {
    const suppliers = await q<{ supplier_name: string; category: string; sites: string; due: number; on_time: number; overdue_value: number; overdue_lines: number }>(`
      SELECT supplier_name, supplier_category category, string_agg(DISTINCT s.site_name, ', ') sites,
             count(*) FILTER (WHERE is_due AND due_date > $1::date - 56) due,
             count(*) FILTER (WHERE is_due AND due_date > $1::date - 56 AND on_time) on_time,
             coalesce(sum(value_gbp) FILTER (WHERE status = 'Open' AND due_date < $1::date), 0) overdue_value,
             count(*) FILTER (WHERE status = 'Open' AND due_date < $1::date) overdue_lines
      FROM gold.fct_po_line p JOIN gold.dim_site s USING (site_id)
      WHERE supplier_is_critical GROUP BY 1, 2 ORDER BY 1`, [asOf]);
    const all = await q<{ due: number; on_time: number }>(`
      SELECT count(*) due, count(*) FILTER (WHERE on_time) on_time FROM gold.fct_po_line
      WHERE is_due AND due_date > $1::date - 56`, [asOf]);
    const list = suppliers.filter((s) => s.due > 0).map((s) => ({ ...s, otd: s.on_time / s.due })).sort((a, b) => a.otd - b.otd);
    let link = null;
    const worst = list[0];
    if (worst && c.orders) {
      link = await q<{ wk: string; supplier: number | null; otif: number | null }>(`
        WITH sup AS (
          SELECT date_trunc('week', due_date)::date wk, avg(on_time::int) v FROM gold.fct_po_line
          WHERE supplier_name = $2 AND is_due AND due_date > $1::date - 7 * 26 GROUP BY 1),
        dl AS (
          SELECT date_trunc('week', promised_date)::date wk, avg(otif::int) v FROM gold.fct_order_line
          WHERE is_due AND promised_date > $1::date - 7 * 26
            AND site_id IN (SELECT site_id FROM gold.fct_po_line WHERE supplier_name = $2 GROUP BY 1)
          GROUP BY 1)
        SELECT wk, sup.v supplier, dl.v otif FROM sup FULL JOIN dl USING (wk)
        WHERE wk < date_trunc('week', $1::date) ORDER BY wk`, [asOf, worst.supplier_name]);
    }
    supply = { suppliers: list, overall: all[0]?.due ? all[0].on_time / all[0].due : null, link };
  }

  return { fy, asOf, sites, exceptions, plan, margin, delivery, stock, quality, supply };
}

export type Brief = Awaited<ReturnType<typeof loadBrief>>;
