import { withViewer } from "@/lib/viewer";
import { num } from "@/lib/format";
import { PageTitle, Stat, StatusPill } from "@/components/ui";

export const metadata = { title: "Data quality · Halden Group" };

type Run = { run_id: string; started_at: Date; finished_at: Date; as_of_date: string; status: string; files_changed: number; rows_ingested: number; tests_passed: number; tests_warned: number; tests_failed: number; step_seconds: Record<string, number> };

export default async function DQPage() {
  const { data } = await withViewer(async (q) => {
    const runs = await q<Run>("SELECT * FROM ops.pipeline_run ORDER BY finished_at DESC LIMIT 15");
    const tests = runs[0] ? await q<{ test_name: string; layer: string; status: string; failures: number; message: string }>(
      "SELECT test_name, layer, status, failures, message FROM ops.dq_test WHERE run_id = $1 ORDER BY (status = 'pass'), layer, test_name", [runs[0].run_id]) : [];
    const fixes = await q<{ correction: string; source: string; records_affected: number }>("SELECT * FROM ops.data_corrections");
    return { runs, tests, fixes };
  });
  const last = data.runs[0];
  const fmtTime = (d: Date) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  const dur = (r: Run) => Object.values(r.step_seconds ?? {}).reduce((t, s) => t + s, 0);
  return (
    <>
      <PageTitle eyebrow="Trust" title="Can we trust these numbers?">
        Every run ingests, cleans and tests the data before anything is published. If a test fails, the gold layer is not
        published and the previous good version stays live - a bad extract never reaches the board pack.
      </PageTitle>
      {last && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Last refresh" value={fmtTime(last.finished_at).replace(" UTC", "")} sub="UTC" status={last.status === "success" ? "good" : "critical"} />
          <Stat label="Tests passed" value={`${last.tests_passed} / ${last.tests_passed + last.tests_warned + last.tests_failed}`} sub={`${last.tests_warned} warnings · ${last.tests_failed} failures`} status={last.tests_failed ? "critical" : last.tests_warned ? "warning" : "good"} />
          <Stat label="Rows ingested last run" value={num(last.rows_ingested)} sub={`${last.files_changed} source files changed`} />
          <Stat label="End-to-end duration" value={`${Math.round(dur(last))}s`} sub={Object.entries(last.step_seconds ?? {}).map(([k, s]) => `${k} ${s}s`).join(" · ")} />
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card p-5 overflow-x-auto">
          <h2 className="font-semibold">What the silver layer fixed</h2>
          <p className="text-sm mb-2" style={{ color: "var(--ink-2)" }}>Problems in the source data that used to be fixed by hand in spreadsheets - now fixed once, automatically and visibly.</p>
          <table className="data">
            <thead><tr><th>Correction</th><th>Source</th><th className="num">Records</th></tr></thead>
            <tbody>{data.fixes.map((f) => <tr key={f.correction}><td>{f.correction}</td><td>{f.source}</td><td className="num">{num(f.records_affected)}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card p-5 overflow-x-auto">
          <h2 className="font-semibold">Recent pipeline runs</h2>
          <table className="data mt-2">
            <thead><tr><th>Finished</th><th>Status</th><th className="num">Rows</th><th className="num">Tests</th><th className="num">Duration</th></tr></thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.run_id}>
                  <td className="tnum">{fmtTime(r.finished_at)}</td>
                  <td><StatusPill status={r.tests_failed ? "critical" : "good"} label={r.tests_failed ? "Failed" : "Published"} /></td>
                  <td className="num">{num(r.rows_ingested)}</td>
                  <td className="num">{r.tests_passed}/{r.tests_passed + r.tests_warned + r.tests_failed}</td>
                  <td className="num">{Math.round(dur(r))}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card p-5 mt-5 overflow-x-auto">
        <h2 className="font-semibold">Data tests in the last run</h2>
        <p className="text-sm mb-2" style={{ color: "var(--ink-2)" }}>Uniqueness, completeness, referential integrity, accepted values and business rules, defined in dbt next to the models they protect.</p>
        <table className="data">
          <thead><tr><th>Test</th><th>Layer</th><th>Result</th><th className="num">Failing rows</th></tr></thead>
          <tbody>
            {data.tests.map((t) => (
              <tr key={t.test_name}>
                <td className="tnum" style={{ fontSize: 12 }}><code>{t.test_name}</code></td>
                <td>{t.layer}</td>
                <td><StatusPill status={t.status === "pass" ? "good" : t.status === "warn" ? "warning" : "critical"} label={t.status} /></td>
                <td className="num">{t.failures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
