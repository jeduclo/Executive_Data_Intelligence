import "server-only";
import type { Query } from "./db";
import { fiscalYear, type Viewer } from "./viewer";
import type { Status } from "@/components/ui";

export type Score = {
  site_id: number;
  site_name: string;
  entity_name: string;
  currency: string;
  revenue_ytd: number | null;
  revenue_plan_ytd: number | null;
  gm: number | null;
  gm_plan: number | null;
  otif: number | null;
  overdue_value: number | null;
  overdue_lines: number | null;
  scrap: number | null;
  fpy: number | null;
  oee: number | null;
  doi: number | null;
  excess: number | null;
  supplier_otd: number | null;
  exceptions: number | null;
};

/** One row per visible site with every governed KPI the viewer is entitled to. */
export async function scorecard(q: Query, v: Viewer): Promise<Score[]> {
  const fy = fiscalYear(v.asOf);
  const c = v.caps;
  const asOf = v.asOf;
  const sites = await q<{ site_id: number; site_name: string; entity_name: string; currency: string }>(
    "SELECT site_id, site_name, entity_name, currency FROM gold.dim_site ORDER BY site_id");
  const rows: Score[] = sites.map((s) => ({
    ...s, revenue_ytd: null, revenue_plan_ytd: null, gm: null, gm_plan: null, otif: null, overdue_value: null,
    overdue_lines: null, scrap: null, fpy: null, oee: null, doi: null, excess: null, supplier_otd: null, exceptions: null,
  }));
  const put = (list: Record<string, unknown>[]) => {
    for (const r of list) {
      const row = rows.find((x) => x.site_id === r.site_id);
      if (row) Object.assign(row, Object.fromEntries(Object.entries(r).filter(([k]) => k !== "site_id")));
    }
  };
  if (c.revenue) {
    put(await q(`SELECT site_id, sum(revenue_gbp) revenue_ytd, sum(revenue_budget_gbp) revenue_plan_ytd
                 FROM gold.mart_site_month WHERE fiscal_year = $1 AND is_complete_month GROUP BY 1`, [fy.label]));
  }
  if (c.finance) {
    put(await q(`SELECT site_id, sum(margin_gbp) / nullif(sum(revenue_gbp), 0) gm,
                        sum(margin_budget_gbp) / nullif(sum(revenue_budget_gbp), 0) gm_plan
                 FROM gold.mart_site_month WHERE fiscal_year = $1 AND is_complete_month GROUP BY 1`, [fy.label]));
  }
  if (c.orders) {
    put(await q(`SELECT site_id,
                   avg(otif::int) FILTER (WHERE is_due AND promised_date > $1::date - 28) otif,
                   count(*) FILTER (WHERE is_overdue) overdue_lines
                   ${c.orderMoney ? ", sum(open_value_gbp) FILTER (WHERE is_overdue) overdue_value" : ""}
                 FROM gold.fct_order_line GROUP BY 1`, [asOf]));
  }
  if (c.production) {
    put(await q(`SELECT site_id,
                   sum(scrap_qty) FILTER (WHERE finish_date > $1::date - 14)::float
                     / nullif(sum(good_qty + scrap_qty) FILTER (WHERE finish_date > $1::date - 14), 0) scrap,
                   avg(passed_first_time::int) FILTER (WHERE finish_date > $1::date - 28) fpy,
                   (sum(run_minutes - downtime_minutes)::float / nullif(sum(run_minutes), 0))
                     * least(sum(ideal_minutes)::float / nullif(sum(run_minutes - downtime_minutes), 0), 1)
                     * (sum(good_qty)::float / nullif(sum(good_qty + scrap_qty), 0)) oee
                 FROM gold.fct_production_order
                 WHERE status = 'Confirmed' AND finish_date > $1::date - 28 AND finish_date <= $1::date GROUP BY 1`, [asOf]));
  }
  if (c.inventory) {
    put(await q(`SELECT i.site_id, sum(i.excess_value_gbp) excess, max(m.days_of_inventory) doi
                 FROM gold.fct_inventory_position i
                 LEFT JOIN gold.mart_inventory_month m ON m.site_id = i.site_id AND m.month_end = $1::date
                 GROUP BY 1`, [asOf]));
  }
  if (c.purchasing) {
    put(await q(`SELECT site_id, avg(on_time::int) supplier_otd FROM gold.fct_po_line
                 WHERE is_due AND due_date > $1::date - 56 GROUP BY 1`, [asOf]));
  }
  if (c.exceptions) {
    put(await q(`SELECT site_id, count(*) exceptions FROM gold.mart_exceptions GROUP BY 1`));
    for (const r of rows) r.exceptions ??= 0;
  }
  return rows;
}

export const TARGETS = { otif: 0.95, scrap: 0.03, fpy: 0.95, oee: 0.75, doi: 45, supplier_otd: 0.92 };

export function statusOf(kpi: keyof typeof TARGETS | "revenue" | "gm", r: Score): Status {
  const v = (x: number | null, good: (n: number) => boolean, warn: (n: number) => boolean): Status =>
    x === null || x === undefined ? "neutral" : good(x) ? "good" : warn(x) ? "warning" : "critical";
  switch (kpi) {
    case "revenue": {
      if (r.revenue_ytd === null || !r.revenue_plan_ytd) return "neutral";
      const d = r.revenue_ytd / r.revenue_plan_ytd - 1;
      return v(d, (n) => n >= -0.01, (n) => n >= -0.05);
    }
    case "gm":
      if (r.gm === null || r.gm_plan === null) return "neutral";
      return v(r.gm - r.gm_plan, (n) => n >= -0.005, (n) => n >= -0.015);
    case "otif": return v(r.otif, (n) => n >= 0.95, (n) => n >= 0.9);
    case "scrap": return v(r.scrap, (n) => n <= 0.03, (n) => n <= 0.045);
    case "fpy": return v(r.fpy, (n) => n >= 0.95, (n) => n >= 0.9);
    case "oee": return v(r.oee, (n) => n >= 0.75, (n) => n >= 0.7);
    case "doi": return v(r.doi, (n) => n <= 45, (n) => n <= 60);
    case "supplier_otd": return v(r.supplier_otd, (n) => n >= 0.92, (n) => n >= 0.85);
  }
}
