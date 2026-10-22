import { asPersona } from "@/lib/db";
import { getViewer, listPersonas } from "@/lib/viewer";
import { gbp, num } from "@/lib/format";
import { PageTitle, StatusIcon } from "@/components/ui";

export const metadata = { title: "Security model · Halden Group" };

const COLUMNS: [string, string, string][] = [
  ["gold.fct_order_line", "order_value_gbp", "Order values"],
  ["gold.mart_site_month", "revenue_gbp", "Revenue"],
  ["gold.mart_site_month", "margin_gbp", "Margin"],
  ["gold.fct_inventory_position", "std_cost_gbp", "Standard cost"],
  ["gold.fct_production_order", "scrap_qty", "Production"],
  ["gold.fct_po_line", "supplier_name", "Purchasing"],
];

type Probe = {
  user_id: string;
  name: string;
  title: string;
  role: string;
  sites: { site_name: string; lines: number }[];
  cols: boolean[];
  margin: { ok: true; value: number } | { ok: false; error: string };
};

export default async function SecurityPage() {
  const me = await getViewer();
  const personas = await listPersonas();
  // Run the SAME queries under every persona. Differences come only from Postgres.
  const probes: Probe[] = [];
  for (const p of personas) {
    const res = await asPersona(p.user_id, p.db_role, async (q) => {
      const cols = await q<{ ok: boolean }>(
        `SELECT has_column_privilege(t, c, 'SELECT') ok FROM unnest($1::text[], $2::text[]) WITH ORDINALITY u(t, c, i) ORDER BY i`,
        [COLUMNS.map((x) => x[0]), COLUMNS.map((x) => x[1])]);
      let sites: { site_name: string; lines: number }[] = [];
      try {
        sites = await q(`SELECT s.site_name, count(*) lines FROM gold.fct_order_line f JOIN gold.dim_site s USING (site_id) GROUP BY 1 ORDER BY 1`);
      } catch { /* no access at all */ }
      return { cols: cols.map((c) => c.ok), sites };
    });
    // a separate transaction, because a permission error aborts the transaction
    let margin: Probe["margin"];
    try {
      const [r] = await asPersona(p.user_id, p.db_role, (q) => q<{ v: number }>("SELECT sum(margin_gbp) v FROM gold.fct_order_line"));
      margin = { ok: true, value: r.v };
    } catch (e) {
      margin = { ok: false, error: (e as Error).message };
    }
    probes.push({ user_id: p.user_id, name: p.display_name, title: p.title, role: p.db_role, ...res, margin });
  }

  return (
    <>
      <PageTitle eyebrow="Security model" title="Who sees what - enforced by the database, not the dashboard">
        The portal holds no data rules of its own. It connects as a login with <strong>no privileges</strong>, and for each request
        takes on the signed-in user&rsquo;s database role inside a read-only transaction. PostgreSQL then applies row-level security
        (which sites) and column-level grants (which figures). Power BI, an API or an analyst&rsquo;s SQL tool get exactly the same answer.
      </PageTitle>

      <section className="card p-5 overflow-x-auto">
        <h2 className="font-semibold">Live test: the same SQL, run as each persona</h2>
        <p className="text-sm mb-3" style={{ color: "var(--ink-2)" }}>
          Executed just now against the serving database. Your current persona is highlighted.
        </p>
        <table className="data min-w-[860px]">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Rows visible in <code>fct_order_line</code><br /><span className="normal-case font-normal tracking-normal">(row-level security)</span></th>
              {COLUMNS.map(([, , label]) => <th key={label} className="text-center">{label}</th>)}
              <th><code>SELECT sum(margin_gbp)</code></th>
            </tr>
          </thead>
          <tbody>
            {probes.map((p) => (
              <tr key={p.user_id} style={p.user_id === me.user_id ? { background: "var(--surface-2)" } : undefined}>
                <td className="whitespace-nowrap">
                  <span className="font-semibold">{p.name}</span>
                  <span className="block text-xs" style={{ color: "var(--ink-3)" }}>{p.title}</span>
                  <code className="text-xs">{p.role}</code>
                </td>
                <td className="text-xs">
                  {p.sites.length === 0 ? "No access" : p.sites.map((s) => (
                    <span key={s.site_name} className="block tnum">{s.site_name} · {num(s.lines)}</span>
                  ))}
                </td>
                {p.cols.map((ok, i) => (
                  <td key={i} className="text-center">
                    <span className="inline-flex flex-col items-center gap-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                      <StatusIcon status={ok ? "good" : "critical"} size={14} />
                      {ok ? "granted" : "denied"}
                    </span>
                  </td>
                ))}
                <td className="text-xs tnum max-w-[200px]" style={{ wordBreak: "break-word" }}>
                  {p.margin.ok ? <span className="font-semibold">{gbp(p.margin.value)}</span> : <code style={{ color: "var(--critical-ink)" }}>ERROR: {p.margin.error}</code>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid lg:grid-cols-2 gap-5 mt-5">
        <section className="card p-5">
          <h2 className="font-semibold">Row-level security</h2>
          <p className="text-sm mt-1 mb-3" style={{ color: "var(--ink-2)" }}>
            One policy on every gold table with a <code>site_id</code>. Entitlements live in <code>sec.user_access</code> and{" "}
            <code>sec.user_site_access</code> - in production fed from Entra ID groups.
          </p>
          <pre className="text-xs overflow-x-auto rounded-lg p-3" style={{ background: "var(--surface-2)" }}>{`ALTER TABLE gold.fct_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold.fct_order_line FORCE ROW LEVEL SECURITY;

CREATE POLICY site_rls ON gold.fct_order_line FOR SELECT
  USING (site_id IN (SELECT unnest(sec.my_sites())));

-- sec.my_sites() reads current_setting('app.user_id')
-- and returns the sites that user is entitled to.`}</pre>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Column-level security</h2>
          <p className="text-sm mt-1 mb-3" style={{ color: "var(--ink-2)" }}>
            Roles are granted an explicit column list. Anything not listed - cost, margin, prices - cannot be selected at all.
          </p>
          <pre className="text-xs overflow-x-auto rounded-lg p-3" style={{ background: "var(--surface-2)" }}>{`GRANT SELECT ON gold.fct_order_line TO rpt_executive, rpt_finance;

GRANT SELECT (order_id, line_no, site_id, customer_id, ...,
              order_value_gbp, revenue_gbp)          -- no cost, no margin
  ON gold.fct_order_line TO rpt_site_manager;

GRANT SELECT (order_id, line_no, site_id, customer_id, ...,
              promised_date, ship_date, otif)        -- no money at all
  ON gold.fct_order_line TO rpt_customer_service;`}</pre>
        </section>
      </div>

      <section className="card p-5 mt-5">
        <h2 className="font-semibold">Each request, step by step</h2>
        <ol className="mt-3 grid md:grid-cols-4 gap-3 text-sm">
          {[
            ["Sign in", "Signed, HTTP-only session cookie identifies the user (Entra ID SSO in production)."],
            ["Assume role", "BEGIN READ ONLY; SET LOCAL ROLE rpt_…; set_config('app.user_id', …, true)"],
            ["Query", "Policies filter rows; missing column grants make forbidden figures unselectable."],
            ["Commit", "Role and user id vanish with the transaction - pooled connections never leak identity."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl p-3" style={{ background: "var(--surface-2)" }}>
              <span className="eyebrow tnum">Step {i + 1}</span>
              <p className="font-semibold mt-1">{t}</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>{d}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm mt-4" style={{ color: "var(--ink-2)" }}>
          <strong>Power BI:</strong> Power BI connects with one service identity, so it cannot pass each user through to PostgreSQL.
          The same <code>sec.*</code> entitlement tables are imported into the model and drive Power BI RLS roles (DAX filter on site) and
          object-level security for cost and margin columns - one source of truth for both tools.
        </p>
      </section>
    </>
  );
}
