import Link from "next/link";
import { withViewer } from "@/lib/viewer";
import { loadBrief, type Brief } from "@/lib/brief";
import { gbp, listJoin, possessive, monthLabel, pct, pts, signedPct, SITE_COLOR, shortDay } from "@/lib/format";
import { BulletBars, Locked, PageTitle, Question, StatusIcon, type Status } from "@/components/ui";
import { DivergingBars, LineSeriesChart, type Series } from "@/components/charts";

export const metadata = { title: "Executive brief · Halden Group" };

const CLS = "Withheld by column-level security in PostgreSQL: your database role has no SELECT on these columns.";
const NOACCESS = "Your database role has no access to this data.";

export default async function BriefPage() {
  const { v, data: b } = await withViewer(loadBrief);
  const scope = v.siteNames.length >= 5 ? "the group" : listJoin(v.siteNames);
  const nav = [
    ["plan", "Plan"], ["margin", "Margin"], ["delivery", "Customers"], ["stock", "Cash in stock"], ["quality", "Quality"], ["supply", "Supply"],
  ];
  return (
    <>
      <PageTitle eyebrow={`Executive brief · ${b.fy.label}`} title={`Six questions about ${scope}, answered`}>
        Each section states the answer first, then the evidence. Figures are in GBP, recomputed from source systems on every
        pipeline run, and identical to what Power BI would show from the same gold layer.
      </PageTitle>

      <nav className="flex flex-wrap gap-2 mb-6 text-sm" aria-label="Jump to question">
        {nav.map(([id, label], i) => (
          <a key={id} href={`#${id}`} className="chip hover:opacity-80"><span className="tnum" style={{ color: "var(--ink-3)" }}>Q{i + 1}</span>{label}</a>
        ))}
      </nav>

      <div className="space-y-5">
        <Attention b={b} />
        <PlanQ b={b} />
        <MarginQ b={b} />
        <DeliveryQ b={b} />
        <StockQ b={b} />
        <QualityQ b={b} />
        <SupplyQ b={b} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ attention
function Attention({ b }: { b: Brief }) {
  if (!b.exceptions) return null;
  const top = b.exceptions.slice(0, 5);
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="attention">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attention" className="font-semibold text-lg">What needs your attention</h2>
        {b.exceptions.length > 0 && <Link href="/alerts" className="link text-sm">All {b.exceptions.length} exceptions →</Link>}
      </div>
      {top.length === 0 ? (
        <p className="mt-3 text-sm flex items-center gap-2"><StatusIcon status="good" /> No KPI is outside its threshold for your sites.</p>
      ) : (
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--grid)" }}>
          {top.map((e) => (
            <li key={e.exception_id} className="py-3 grid grid-cols-[auto_1fr_auto] gap-3 items-start" style={{ borderColor: "var(--grid)" }}>
              <StatusIcon status={e.severity === "High" ? "critical" : "warning"} />
              <div className="min-w-0">
                <p className="text-[15px]">
                  <Link href={`/sites/${e.site_id}`} className="font-semibold link" style={{ color: "var(--ink)" }}>{e.site_name}</Link>
                  <span style={{ color: "var(--ink-3)" }}> · {e.category}</span>
                </p>
                <p className="text-[15px]">{e.headline}</p>
                <p className="text-sm" style={{ color: "var(--ink-2)" }}>{e.detail}</p>
              </div>
              {e.impact_gbp != null && (
                <div className="text-right">
                  <p className="tnum font-semibold">{gbp(e.impact_gbp)}</p>
                  <p className="text-xs" style={{ color: "var(--ink-3)" }}>at stake</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Q1
function PlanQ({ b }: { b: Brief }) {
  const p = b.plan;
  const q = "Will we hit this year's plan?";
  if (!p) return <Question id="plan" number={1} question={q} status="neutral" answer={<Locked what="Revenue" reason={NOACCESS} />} />;
  const gap = p.landing - p.fyPlan;
  const gapPct = gap / p.fyPlan;
  const status: Status = gapPct >= -0.01 ? "good" : gapPct >= -0.03 ? "warning" : "critical";
  const losers = [...p.sites].map((s) => ({ ...s, gap: s.landing - s.fyPlan })).sort((a, b) => a.gap - b.gap);
  const drivers = losers.filter((s) => s.gap < 0 && gap < 0 && s.gap / gap > 0.2);
  const share = drivers.reduce((t, s) => t + s.gap, 0) / (gap || 1);
  const answer = status === "good" ? (
    <p><strong>Yes.</strong> At the current run-rate we land at <strong className="tnum">{gbp(p.landing)}</strong>, {signedPct(gapPct)} against the {gbp(p.fyPlan)} plan.</p>
  ) : (
    <p>
      <strong>{status === "warning" ? "At risk." : "No."}</strong> At the run-rate of the last three months we land at{" "}
      <strong className="tnum">{gbp(p.landing)}</strong> - <strong className="tnum">{gbp(-gap)} ({signedPct(gapPct)})</strong> short of the{" "}
      {gbp(p.fyPlan)} plan.
      {drivers.length > 0 && (
        <> {listJoin(drivers.map((d) => d.site_name))} account{drivers.length === 1 ? "s" : ""} for {pct(share)} of the gap.</>
      )}
    </p>
  );
  const series: Series[] = [
    { key: "actual", label: "Actual (cumulative)", color: "var(--series-1)" },
    { key: "forecast", label: "Forecast at current run-rate", color: "var(--series-1)", dashed: true },
    { key: "plan", label: "Plan", color: "var(--plan)" },
  ];
  return (
    <Question id="plan" number={1} question={q} status={status} answer={answer} owner="CFO" drill={{ href: "/sites", label: "Compare sites" }}>
      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-6">
        <LineSeriesChart
          data={p.chart.map((r) => ({ x: monthLabel(r.month), actual: r.actual, forecast: r.forecast, plan: r.plan }))}
          series={series}
          kind="gbpm"
          height={250}
        />
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr><th>Site</th><th className="num">YTD vs plan</th><th className="num">Landing</th><th className="num">vs FY plan</th></tr>
            </thead>
            <tbody>
              {losers.map((s) => (
                <tr key={s.site_id}>
                  <td><Link className="link" href={`/sites/${s.site_id}`}>{s.site_name}</Link></td>
                  <td className="num">{signedPct(s.ytd / s.ytdPlan - 1)}</td>
                  <td className="num">{gbp(s.landing)}</td>
                  <td className="num font-semibold" style={{ color: s.gap < 0 ? "var(--critical-ink)" : undefined }}>{gbp(s.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs mt-2" style={{ color: "var(--ink-3)" }}>
            {p.months} completed months to {monthLabel(p.lastComplete)}. Landing = actual to date + remaining budget × last-3-month actual/budget ratio.
          </p>
        </div>
      </div>
    </Question>
  );
}

// ------------------------------------------------------------------ Q2
function MarginQ({ b }: { b: Brief }) {
  const q = "Where is margin leaking?";
  const m = b.margin;
  if (!m) return <Question id="margin" number={2} question={q} status="neutral" answer={<Locked what="Margin and cost" reason={CLS} />} />;
  const w = m.worst;
  const gapPts = m.gm - m.gmPlan;
  const status: Status = gapPts >= -0.005 ? "good" : gapPts >= -0.015 ? "warning" : "critical";
  const answer = (
    <p>
      {w && w.impact < 0 ? (
        <>
          <strong>{w.family}.</strong> Margin fell from {pct(w.gm_py, 1)} to <strong>{pct(w.gm, 1)}</strong> versus the same months last year
          {m.unit && m.unit.cost > m.unit.price + 0.01 && (
            <> - unit cost is up {pct(m.unit.cost, 1)} but price only {pct(m.unit.price, 1)}, so April&rsquo;s cost increase has not been passed on in full</>
          )}.
          That is <strong className="tnum">{gbp(-w.impact)}</strong> of margin lost this year to date.{" "}
        </>
      ) : (
        <><strong>No family is losing margin</strong> against last year. </>
      )}
      Overall gross margin is {pct(m.gm, 1)} against a {pct(m.gmPlan, 1)} plan ({pts(gapPts)}).
    </p>
  );
  return (
    <Question id="margin" number={2} question={q} status={status} answer={answer} owner="CFO">
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold mb-2">Margin change vs last year, £, by product family</p>
          <DivergingBars
            kind="gbp"
            data={m.families.map((f) => ({
              label: f.family,
              value: Math.round(f.impact),
              note: `${pct(f.gm_py, 1)} → ${pct(f.gm, 1)}`,
            }))}
          />
        </div>
        <div className="overflow-x-auto">
          <p className="text-sm font-semibold mb-2">Gross margin vs plan, year to date</p>
          <table className="data">
            <thead><tr><th>Site</th><th className="num">Actual</th><th className="num">Plan</th><th className="num">Gap</th></tr></thead>
            <tbody>
              {m.sites.map((s) => (
                <tr key={s.site_id}>
                  <td><Link className="link" href={`/sites/${s.site_id}`}>{s.site_name}</Link></td>
                  <td className="num">{pct(s.gm, 1)}</td>
                  <td className="num">{pct(s.gm_plan, 1)}</td>
                  <td className="num font-semibold" style={{ color: s.gap < -1 ? "var(--critical-ink)" : undefined }}>{gbp(s.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Question>
  );
}

// ------------------------------------------------------------------ Q3
function DeliveryQ({ b }: { b: Brief }) {
  const q = "Are we keeping our promises to customers?";
  const d = b.delivery;
  if (!d) return <Question id="delivery" number={3} question={q} status="neutral" answer={<Locked what="Order data" reason={NOACCESS} />} />;
  const target = 0.95;
  const below = d.sites.filter((s) => s.pct < 0.9).sort((a, b) => a.pct - b.pct);
  const fine = d.sites.filter((s) => s.pct >= 0.9);
  const status: Status = (d.group ?? 1) >= target ? "good" : below.length ? "critical" : "warning";
  const overdueVal = d.overdue.reduce((t, o) => t + (o.value ?? 0), 0);
  const overdueLines = d.overdue.reduce((t, o) => t + o.lines, 0);
  const worstOverdue = [...d.overdue].sort((a, b) => (b.value ?? b.lines) - (a.value ?? a.lines))[0];
  const share = worstOverdue ? (worstOverdue.value ?? worstOverdue.lines) / (overdueVal || overdueLines || 1) : 0;
  const range = fine.length ? `${pct(Math.min(...fine.map((s) => s.pct)))}–${pct(Math.max(...fine.map((s) => s.pct)))}` : "";
  const answer = (
    <p>
      {below.length ? (
        <>
          <strong>Not at {listJoin(below.map((s) => s.site_name))}.</strong> On-time-in-full there is{" "}
          <strong className="tnum">{listJoin(below.map((s) => pct(s.pct)))}</strong> over the last four weeks against a 95% target
          {fine.length > 0 && <>; the other {fine.length === 1 ? "site is" : `${fine.length} sites are`} at {range}</>}.{" "}
        </>
      ) : (
        <><strong>{(d.group ?? 0) >= target ? "Yes." : "Mostly."}</strong> OTIF is {pct(d.group)} over the last four weeks. </>
      )}
      {overdueLines > 0 && (
        <>
          {overdueVal > 0 ? <strong className="tnum">{gbp(overdueVal)}</strong> : <strong>{overdueLines.toLocaleString()} lines</strong>} of customer orders
          are past their promised date{worstOverdue && share > 0.4 && <>, {pct(share)} of it at {worstOverdue.site_name}</>}.
        </>
      )}
    </p>
  );
  const weeks = [...new Set(d.weekly.map((w) => w.wk))].sort();
  const emph = new Set(below.map((s) => s.site_id));
  const series: Series[] = d.sites.map((s) => ({
    key: `s${s.site_id}`,
    label: s.site_name,
    color: SITE_COLOR[s.site_id],
    emphasis: emph.size === 0 || emph.has(s.site_id),
  }));
  const chart = weeks.map((wk) => {
    const row: Record<string, string | number | null> = { x: shortDay(wk) };
    for (const s of d.sites) row[`s${s.site_id}`] = d.weekly.find((r) => r.wk === wk && r.site_id === s.site_id)?.otif ?? null;
    return row;
  });
  return (
    <Question id="delivery" number={3} question={q} status={status} answer={answer} owner="COO" drill={{ href: "/orders", label: "See overdue orders" }}>
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold mb-2">OTIF by promised week</p>
          <LineSeriesChart data={chart} series={series} kind="pct" target={{ value: target, label: "Target 95%" }} yDomain={[0.4, 1]} />
        </div>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold mb-3">OTIF, last 4 weeks</p>
            <BulletBars
              rows={d.sites.map((s) => ({ label: s.site_name, value: s.pct, href: `/sites/${s.site_id}` }))}
              target={target}
              max={1}
              format={(n) => pct(n)}
            />
          </div>
          {d.customers.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-sm font-semibold mb-1">Customers hit hardest (last 4 weeks)</p>
              <table className="data">
                <thead><tr><th>Customer</th><th className="num">Late lines</th>{d.customers[0].value !== null && <th className="num">Value</th>}<th>From</th></tr></thead>
                <tbody>
                  {d.customers.map((c) => (
                    <tr key={c.customer_name}>
                      <td>{c.customer_name}{c.is_key_account && <span className="chip ml-2" style={{ padding: "0 7px", fontSize: 11 }}>Key account</span>}</td>
                      <td className="num">{c.late} of {c.due}</td>
                      {c.value !== null && <td className="num">{gbp(c.value)}</td>}
                      <td>{c.sites}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Question>
  );
}

// ------------------------------------------------------------------ Q4
function StockQ({ b }: { b: Brief }) {
  const q = "Is cash tied up in stock?";
  const s = b.stock;
  if (!s) return <Question id="stock" number={4} question={q} status="neutral" answer={<Locked what="Inventory" reason={NOACCESS} />} />;
  const excess = s.sites.reduce((t, x) => t + x.excess, 0);
  const value = s.sites.reduce((t, x) => t + x.value, 0);
  const worst = [...s.sites].sort((a, b) => b.excess - a.excess)[0];
  const doiNow = (id: number) => [...s.monthly].reverse().find((m) => m.site_id === id)?.doi ?? null;
  const doiApr = (id: number) => s.monthly.find((m) => m.site_id === id && m.month_start === b.fy.start)?.doi ?? null;
  const share = worst ? worst.excess / (excess || 1) : 0;
  const status: Status = excess < value * 0.05 ? "good" : excess < value * 0.15 ? "warning" : "critical";
  const highDoi = s.sites.filter((x) => (doiNow(x.site_id) ?? 0) > 60);
  const answer = (
    <p>
      {excess > value * 0.05 && worst ? (
        <>
          <strong>Yes - <span className="tnum">{gbp(excess)}</span></strong> of finished goods sits above 60 days of cover
          {share > 0.5 ? <>, {pct(share)} of it at <strong>{worst.site_name}</strong></> : null}
          {doiApr(worst.site_id) && doiNow(worst.site_id) ? (
            <>, where days of inventory went from {Math.round(doiApr(worst.site_id)!)} in April to <strong>{Math.round(doiNow(worst.site_id)!)}</strong> against a 45-day target</>
          ) : null}
          . Total finished-goods stock is {gbp(value)}.
        </>
      ) : (
        <><strong>No.</strong> Finished-goods stock is {gbp(value)} with only {gbp(excess)} above 60 days of cover.</>
      )}
    </p>
  );
  const months = [...new Set(s.monthly.map((m) => m.month_start))].sort();
  const emph = new Set(highDoi.map((x) => x.site_id));
  const series: Series[] = s.sites.map((x) => ({ key: `s${x.site_id}`, label: x.site_name, color: SITE_COLOR[x.site_id], emphasis: emph.size === 0 || emph.has(x.site_id) }));
  const chart = months.map((m) => {
    const row: Record<string, string | number | null> = { x: monthLabel(m) };
    for (const x of s.sites) row[`s${x.site_id}`] = s.monthly.find((r) => r.month_start === m && r.site_id === x.site_id)?.doi ?? null;
    return row;
  });
  return (
    <Question id="stock" number={4} question={q} status={status} answer={answer} owner="CFO" drill={worst ? { href: `/sites/${worst.site_id}#stock`, label: `See ${worst.site_name} stock` } : undefined}>
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold mb-2">Days of inventory, month end</p>
          <LineSeriesChart data={chart} series={series} kind="days" target={{ value: 45, label: "Target 45 days" }} yDomain={[0, "auto"]} />
        </div>
        <div className="overflow-x-auto">
          <p className="text-sm font-semibold mb-1">Stock and excess by site, today</p>
          <table className="data">
            <thead><tr><th>Site</th><th className="num">Stock</th><th className="num">Days</th><th className="num">Excess &gt;60 days</th></tr></thead>
            <tbody>
              {[...s.sites].sort((a, b) => b.excess - a.excess).map((x) => (
                <tr key={x.site_id}>
                  <td><Link className="link" href={`/sites/${x.site_id}#stock`}>{x.site_name}</Link></td>
                  <td className="num">{gbp(x.value)}</td>
                  <td className="num">{doiNow(x.site_id) ? Math.round(doiNow(x.site_id)!) : "–"}</td>
                  <td className="num font-semibold">{gbp(x.excess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Question>
  );
}

// ------------------------------------------------------------------ Q5
function QualityQ({ b }: { b: Brief }) {
  const q = "Is quality costing us money?";
  const x = b.quality;
  if (!x) return <Question id="quality" number={5} question={q} status="neutral" answer={<Locked what="Production and quality" reason={NOACCESS} />} />;
  const spikes = x.sites.filter((s) => (s.rate ?? 0) > 0.045).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const change = x.copq / Math.max(1, x.copqPrior) - 1;
  const status: Status = spikes.length ? "critical" : x.rate > 0.03 ? "warning" : "good";
  const answer = (
    <p>
      {spikes.length ? (
        <>
          <strong>At {listJoin(spikes.map((s) => s.site_name))}, yes.</strong>{" "}
          {spikes.map((s, i) => (
            <span key={s.site_id}>
              {i > 0 && " "}Scrap at {s.site_name} jumped to <strong className="tnum">{pct(s.rate, 1)}</strong> in the last 14 days from{" "}
              {pct(s.prior_rate, 1)} before{s.defect && <>, mostly <strong>{s.defect.toLowerCase()}</strong></>} - {gbp(s.cost)} scrapped.
            </span>
          ))}{" "}
        </>
      ) : (
        <><strong>Not materially.</strong> </>
      )}
      Cost of poor quality across {x.sites.length === 1 ? "the site" : "the sites"} was <strong className="tnum">{gbp(x.copq)}</strong> in the last four weeks,{" "}
      {signedPct(change, 0)} on the four weeks before.
    </p>
  );
  const weeks = [...new Set(x.weekly.map((w) => w.week_start))].sort();
  const emph = new Set(spikes.map((s) => s.site_id));
  const series: Series[] = x.sites.map((s) => ({ key: `s${s.site_id}`, label: s.site_name, color: SITE_COLOR[s.site_id], emphasis: emph.size === 0 || emph.has(s.site_id) }));
  const chart = weeks.map((wk) => {
    const row: Record<string, string | number | null> = { x: shortDay(wk) };
    for (const s of x.sites) row[`s${s.site_id}`] = x.weekly.find((r) => r.week_start === wk && r.site_id === s.site_id)?.scrap_rate ?? null;
    return row;
  });
  return (
    <Question id="quality" number={5} question={q} status={status} answer={answer} owner="COO" drill={spikes[0] ? { href: `/sites/${spikes[0].site_id}#quality`, label: `See ${spikes[0].site_name} quality` } : undefined}>
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold mb-2">Scrap rate by week</p>
          {chart.length ? <LineSeriesChart data={chart} series={series} kind="pct1" target={{ value: 0.03, label: "Target 3%" }} yDomain={[0, "auto"]} /> : <Locked what="Weekly trend" reason={NOACCESS} />}
        </div>
        <div>
          <p className="text-sm font-semibold mb-3">Scrap rate, last 14 days</p>
          <BulletBars
            rows={x.sites.map((s) => ({ label: s.site_name, value: s.rate, href: `/sites/${s.site_id}#quality` }))}
            target={0.03}
            max={Math.max(0.12, ...x.sites.map((s) => s.rate ?? 0))}
            format={(n) => pct(n, 1)}
            higherIsBetter={false}
          />
        </div>
      </div>
    </Question>
  );
}

// ------------------------------------------------------------------ Q6
function SupplyQ({ b }: { b: Brief }) {
  const q = "Is the supply base putting output at risk?";
  const s = b.supply;
  if (!s) return <Question id="supply" number={6} question={q} status="neutral" answer={<Locked what="Purchasing" reason={NOACCESS} />} />;
  const bad = s.suppliers.filter((x) => x.otd < 0.85);
  const w = bad[0];
  const status: Status = w ? (w.otd < 0.7 ? "critical" : "warning") : "good";
  const answer = (
    <p>
      {w ? (
        <>
          <strong>Yes - {w.supplier_name}.</strong> This critical {w.category.toLowerCase()} supplier to {w.sites} delivered only{" "}
          <strong className="tnum">{pct(w.otd)}</strong> on time over the last eight weeks, with {gbp(w.overdue_value)} of purchase orders overdue.
          {s.link && s.link.length > 0 && <> Its decline tracks {possessive(w.sites)} customer OTIF week by week - fixing this supplier is the lever for Q3.</>}
        </>
      ) : (
        <><strong>No.</strong> Critical suppliers are delivering on time; overall supplier on-time delivery is {pct(s.overall)}.</>
      )}
    </p>
  );
  const link = s.link ?? [];
  return (
    <Question id="supply" number={6} question={q} status={status} answer={answer} owner="CPO">
      <div className="grid lg:grid-cols-2 gap-6">
        {w && link.length > 0 ? (
          <div>
            <p className="text-sm font-semibold mb-2">{w.supplier_name} on-time vs {w.sites} OTIF, by week</p>
            <LineSeriesChart
              data={link.map((r) => ({ x: shortDay(r.wk), supplier: r.supplier, otif: r.otif }))}
              series={[
                { key: "supplier", label: `${w.supplier_name} on-time`, color: "var(--series-2)" },
                { key: "otif", label: `${w.sites} customer OTIF`, color: "var(--series-1)" },
              ]}
              kind="pct"
              yDomain={[0, 1]}
            />
          </div>
        ) : <div />}
        <div className="overflow-x-auto">
          <p className="text-sm font-semibold mb-1">Critical suppliers, last 8 weeks</p>
          <table className="data">
            <thead><tr><th>Supplier</th><th>Supplies</th><th className="num">On time</th><th className="num">Overdue POs</th></tr></thead>
            <tbody>
              {s.suppliers.map((x) => (
                <tr key={x.supplier_name}>
                  <td><span className="inline-flex items-center gap-1.5"><StatusIcon size={13} status={x.otd >= 0.92 ? "good" : x.otd >= 0.85 ? "warning" : "critical"} />{x.supplier_name}</span></td>
                  <td>{x.sites}</td>
                  <td className="num">{pct(x.otd)}</td>
                  <td className="num">{gbp(x.overdue_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Question>
  );
}
