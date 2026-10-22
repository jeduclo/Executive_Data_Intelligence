import Link from "next/link";
import { withViewer } from "@/lib/viewer";
import { dayLabel, gbp } from "@/lib/format";
import { Empty, PageTitle } from "@/components/ui";

export const metadata = { title: "Orders · Halden Group" };

type Row = {
  order_id: string; site_name: string; site_id: number; customer_name: string; is_key_account: boolean;
  promised: string; days_late: number; lines: number; value: number | null;
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; site?: string; key?: string }> }) {
  const sp = await searchParams;
  const search = (sp.q ?? "").trim();
  const site = sp.site ? Number(sp.site) : null;
  const keyOnly = sp.key === "1";
  const { v, data } = await withViewer(async (q, v) => {
    const sites = await q<{ site_id: number; site_name: string }>("SELECT site_id, site_name FROM gold.dim_site ORDER BY 1");
    const money = v.caps.orderMoney;
    const where = ["f.is_overdue"];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`, search.replace(/^0+/, ""));
      where.splice(0, 1, `(lower(c.customer_name) LIKE $${params.length - 1} OR ltrim(f.order_id, '0') = $${params.length})`);
    }
    if (site) { params.push(site); where.push(`f.site_id = $${params.length}`); }
    if (keyOnly) where.push("c.is_key_account");
    const rows = await q<Row>(`
      SELECT f.order_id, s.site_name, f.site_id, c.customer_name, c.is_key_account,
             min(f.promised_date) promised, max(f.days_late) days_late, count(*) FILTER (WHERE f.is_overdue OR $${params.length + 1}::boolean) lines,
             ${money ? "sum(f.open_value_gbp)" : "NULL::float"} value
      FROM gold.fct_order_line f JOIN gold.dim_customer c USING (customer_id) JOIN gold.dim_site s USING (site_id)
      WHERE ${where.join(" AND ")}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY ${search ? "promised DESC" : money ? "value DESC NULLS LAST" : "days_late DESC"} LIMIT 100`, [...params, !!search]);
    const totals = await q<{ lines: number; value: number | null; orders: number }>(`
      SELECT count(*) lines, count(DISTINCT order_id) orders, ${money ? "sum(open_value_gbp)" : "NULL::float"} value
      FROM gold.fct_order_line WHERE is_overdue`);
    return { sites, rows, totals: totals[0] };
  });
  const money = v.caps.orderMoney;
  return (
    <>
      <PageTitle eyebrow="Orders" title={search ? `Orders matching “${search}”` : "Which customer orders are late?"}>
        {search
          ? "Search by order number or customer name."
          : <>Open order lines past their promised date: <strong>{data.totals.lines.toLocaleString()}</strong> lines on{" "}
            <strong>{data.totals.orders.toLocaleString()}</strong> orders{money && <> worth <strong>{gbp(data.totals.value)}</strong></>}. Largest first.</>}
      </PageTitle>

      <form className="card p-4 mb-5 flex flex-wrap gap-3 items-end" method="get">
        <label className="text-sm flex-1 min-w-[220px]">
          <span className="eyebrow">Order number or customer</span>
          <input name="q" defaultValue={search} placeholder="e.g. 10041234 or Atlas" className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }} />
        </label>
        <label className="text-sm">
          <span className="eyebrow">Site</span>
          <select name="site" defaultValue={site ?? ""} className="mt-1 block rounded-lg border px-3 py-2" style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }}>
            <option value="">All visible sites</option>
            {data.sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.site_name}</option>)}
          </select>
        </label>
        <label className="text-sm flex items-center gap-2 pb-2">
          <input type="checkbox" name="key" value="1" defaultChecked={keyOnly} /> Key accounts only
        </label>
        <button className="btn btn-primary">Apply</button>
        {(search || site || keyOnly) && <Link href="/orders" className="btn">Clear</Link>}
      </form>

      <div className="card overflow-x-auto">
        {data.rows.length === 0 ? <Empty>No matching orders.</Empty> : (
          <table className="data min-w-[720px]">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Site</th><th>Promised</th><th className="num">Days late</th><th className="num">{search ? "Lines" : "Late lines"}</th>{money && <th className="num">Open value</th>}</tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.order_id}>
                  <td><Link className="link tnum" href={`/orders/${r.order_id}`}>{r.order_id.replace(/^0+/, "")}</Link></td>
                  <td>{r.customer_name}{r.is_key_account && <span className="chip ml-2" style={{ padding: "0 7px", fontSize: 11 }}>Key account</span>}</td>
                  <td><Link className="link" href={`/sites/${r.site_id}`}>{r.site_name}</Link></td>
                  <td className="tnum">{dayLabel(r.promised)}</td>
                  <td className="num">{r.days_late}</td>
                  <td className="num">{r.lines}</td>
                  {money && <td className="num">{gbp(r.value)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!money && <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>Order values are hidden for your role by column-level security.</p>}
    </>
  );
}
