import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { asPersona, asPortal, type Query } from "./db";
import { readSession } from "./session";

export type Persona = {
  user_id: string;
  display_name: string;
  title: string;
  db_role: string;
  all_sites: boolean;
  site_ids: number[];
};

const ORDER = ["ceo", "cfo", "fin_uk", "pm_stuttgart", "cs_agent"];

export const listPersonas = cache(async (): Promise<Persona[]> => {
  const rows = await asPortal<Persona>("SELECT * FROM sec.list_personas()");
  const rank = (u: string) => (ORDER.includes(u) ? ORDER.indexOf(u) : 99);
  return rows.sort((a, b) => rank(a.user_id) - rank(b.user_id));
});

/** What the current role may read. Comes from Postgres grants, not from the app. */
export type Caps = {
  finance: boolean; // margin & cost
  revenue: boolean; // revenue vs plan
  orders: boolean;
  orderMoney: boolean;
  production: boolean;
  inventory: boolean;
  purchasing: boolean;
  exceptions: boolean;
  weekly: boolean;
};

export type Viewer = Persona & { caps: Caps; siteNames: string[]; asOf: string; refreshedAt: string | null };

export const getViewer = cache(async (): Promise<Viewer> => {
  const session = await readSession();
  if (!session) redirect("/login");
  const persona = (await listPersonas()).find((p) => p.user_id === session.uid);
  if (!persona) redirect("/login");
  return asPersona(persona.user_id, persona.db_role, async (q) => {
    const [c] = await q<Caps>(`SELECT
        has_column_privilege('gold.mart_site_month', 'margin_gbp', 'SELECT')        AS finance,
        has_column_privilege('gold.mart_site_month', 'revenue_gbp', 'SELECT')       AS revenue,
        has_any_column_privilege('gold.fct_order_line', 'SELECT')                   AS orders,
        has_column_privilege('gold.fct_order_line', 'order_value_gbp', 'SELECT')    AS "orderMoney",
        has_any_column_privilege('gold.fct_production_order', 'SELECT')             AS production,
        has_any_column_privilege('gold.fct_inventory_position', 'SELECT')           AS inventory,
        has_any_column_privilege('gold.fct_po_line', 'SELECT')                      AS purchasing,
        has_any_column_privilege('gold.mart_exceptions', 'SELECT')                  AS exceptions,
        has_any_column_privilege('gold.mart_site_week', 'SELECT')                   AS weekly`);
    const sites = await q<{ site_name: string }>("SELECT site_name FROM gold.dim_site ORDER BY site_id");
    const [run] = await q<{ as_of_date: string; finished_at: Date }>(
      "SELECT as_of_date, finished_at FROM ops.pipeline_run ORDER BY finished_at DESC LIMIT 1");
    return {
      ...persona,
      caps: c,
      siteNames: sites.map((s) => s.site_name),
      asOf: run?.as_of_date ?? new Date().toISOString().slice(0, 10),
      refreshedAt: run?.finished_at ? new Date(run.finished_at).toISOString() : null,
    };
  });
});

/** Run page queries as the signed-in persona. */
export async function withViewer<T>(fn: (q: Query, v: Viewer) => Promise<T>): Promise<{ v: Viewer; data: T }> {
  const v = await getViewer();
  const data = await asPersona(v.user_id, v.db_role, (q) => fn(q, v));
  return { v, data };
}

export function fiscalYear(asOf: string): { label: string; start: string; end: string; pyStart: string } {
  const [y, m] = asOf.split("-").map(Number);
  const fy = m >= 4 ? y : y - 1;
  return {
    label: `FY${fy}/${String(fy + 1).slice(2)}`,
    start: `${fy}-04-01`,
    end: `${fy + 1}-03-31`,
    pyStart: `${fy - 1}-04-01`,
  };
}
