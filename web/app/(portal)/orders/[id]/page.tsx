import Link from "next/link";
import { withViewer } from "@/lib/viewer";
import { dayLabel, gbp, num, pct } from "@/lib/format";
import { Locked, PageTitle, StatusPill } from "@/components/ui";

export const metadata = { title: "Order · Halden Group" };

type Line = {
  line_no: number; material_id: string; family: string; qty_ordered: number; qty_shipped: number; status: string;
  order_date: string; promised_date: string; ship_date: string | null; invoice_date: string | null;
  days_late: number; on_time: boolean | null; in_full: boolean | null; otif: boolean | null;
  order_value_gbp?: number; revenue_gbp?: number | null; margin_gbp?: number | null; currency: string; net_value_local?: number;
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const { v, data } = await withViewer(async (q, v) => {
    const c = v.caps;
    const cols = [
      "line_no", "material_id", "family", "qty_ordered", "qty_shipped", "status", "order_date", "promised_date", "ship_date",
      "invoice_date", "days_late", "on_time", "in_full", "otif", "currency",
      ...(c.orderMoney ? ["order_value_gbp", "revenue_gbp", "net_value_local"] : []),
      ...(c.finance ? ["margin_gbp"] : []),
    ];
    const lines = await q<Line>(`SELECT ${cols.join(", ")} FROM gold.fct_order_line WHERE order_id = $1 ORDER BY line_no`, [id]);
    const head = (await q<{ site_id: number; site_name: string; customer_name: string; country: string; segment: string; is_key_account: boolean }>(`
      SELECT f.site_id, s.site_name, c.customer_name, c.country, c.segment, c.is_key_account
      FROM gold.fct_order_line f JOIN gold.dim_site s USING (site_id) JOIN gold.dim_customer c USING (customer_id)
      WHERE f.order_id = $1 LIMIT 1`, [id]))[0];
    return { lines, head };
  });
  if (!data.head) {
    return (
      <>
        <PageTitle eyebrow="Orders" title={`Order ${id.replace(/^0+/, "")}`} />
        <Locked what="This order" reason="Either it does not exist or row-level security hides its site from you." />
      </>
    );
  }
  const { lines, head } = data;
  const c = v.caps;
  const total = lines.reduce((t, l) => t + (l.order_value_gbp ?? 0), 0);
  const margin = lines.reduce((t, l) => t + (l.margin_gbp ?? 0), 0);
  const rev = lines.reduce((t, l) => t + (l.revenue_gbp ?? 0), 0);
  const late = lines.filter((l) => l.otif === false).length;
  return (
    <>
      <p className="text-sm mb-2"><Link href="/orders" className="link">← Orders</Link> · <Link href={`/sites/${head.site_id}`} className="link">{head.site_name}</Link></p>
      <PageTitle eyebrow={`Sales order · ${head.site_name}`} title={`Order ${id.replace(/^0+/, "")}`}>
        {head.customer_name} ({head.country}, {head.segment}{head.is_key_account ? ", key account" : ""}) · ordered {dayLabel(lines[0]?.order_date)} ·{" "}
        {late ? <strong>{late} of {lines.length} lines missed OTIF</strong> : <>all due lines on time and in full</>}
      </PageTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-4"><p className="text-xs" style={{ color: "var(--ink-2)" }}>Lines</p><p className="text-2xl font-semibold tnum">{lines.length}</p></div>
        <div className="card p-4"><p className="text-xs" style={{ color: "var(--ink-2)" }}>Order value</p><p className="text-2xl font-semibold tnum">{c.orderMoney ? gbp(total) : "Hidden"}</p></div>
        <div className="card p-4"><p className="text-xs" style={{ color: "var(--ink-2)" }}>Invoiced</p><p className="text-2xl font-semibold tnum">{c.orderMoney ? gbp(rev) : "Hidden"}</p></div>
        <div className="card p-4"><p className="text-xs" style={{ color: "var(--ink-2)" }}>Gross margin</p><p className="text-2xl font-semibold tnum">{c.finance ? (rev ? pct(margin / rev, 1) : "–") : "Hidden"}</p></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data min-w-[900px]">
          <thead>
            <tr>
              <th>Line</th><th>Material</th><th className="num">Qty</th><th>Promised</th><th>Shipped</th><th>Invoiced</th>
              <th className="num">Days late</th><th>Status</th>
              {c.orderMoney && <th className="num">Value</th>}
              {c.finance && <th className="num">Margin</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_no}>
                <td className="tnum">{l.line_no}</td>
                <td className="tnum">{l.material_id}<span className="block text-xs" style={{ color: "var(--ink-3)" }}>{l.family}</span></td>
                <td className="num">{num(l.qty_shipped)} / {num(l.qty_ordered)}</td>
                <td className="tnum">{dayLabel(l.promised_date)}</td>
                <td className="tnum">{dayLabel(l.ship_date)}</td>
                <td className="tnum">{dayLabel(l.invoice_date)}</td>
                <td className="num">{l.days_late || "–"}</td>
                <td>
                  {l.otif === null ? <StatusPill status="neutral" label="Not yet due" /> :
                    l.otif ? <StatusPill status="good" label="On time, in full" /> :
                      <StatusPill status="critical" label={l.ship_date ? (l.on_time ? "Short shipped" : "Shipped late") : "Overdue"} />}
                </td>
                {c.orderMoney && <td className="num">{gbp(l.order_value_gbp)}<span className="block text-xs" style={{ color: "var(--ink-3)" }}>{num(l.net_value_local)} {l.currency}</span></td>}
                {c.finance && <td className="num">{l.margin_gbp === null ? "–" : gbp(l.margin_gbp)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(!c.orderMoney || !c.finance) && (
        <p className="text-xs mt-3" style={{ color: "var(--ink-3)" }}>
          {!c.orderMoney ? "Values" : "Margin"} hidden by column-level security for your role.
        </p>
      )}
    </>
  );
}
