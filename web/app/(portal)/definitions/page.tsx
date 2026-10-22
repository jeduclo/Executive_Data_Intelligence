import { withViewer } from "@/lib/viewer";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "KPI definitions · Halden Group" };

type K = { kpi_code: string; kpi_name: string; question: string; definition: string; target: number; direction: string; unit: string; owner: string };

function target(k: K) {
  if (k.unit === "pct") return k.target ? `${Math.round(k.target * 100)}%` : "Plan";
  if (k.unit === "days") return `${k.target} days`;
  return k.target ? String(k.target) : k.direction === "lower" ? "Minimise" : "Plan";
}

export default async function DefinitionsPage() {
  const { data } = await withViewer((q) => q<K>("SELECT * FROM gold.kpi_definitions"));
  const groups = [...new Set(data.map((k) => k.question))];
  return (
    <>
      <PageTitle eyebrow="Governance" title="One definition per KPI, for every site and every tool">
        These definitions live in the dbt project, are applied once in the gold layer and published here and to Power BI.
        A site can no longer compute OTIF its own way in a spreadsheet.
      </PageTitle>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g} className="card p-5 overflow-x-auto">
            <h2 className="question text-xl mb-2">{g}</h2>
            <table className="data">
              <thead><tr><th>KPI</th><th>Definition</th><th>Target</th><th>Owner</th></tr></thead>
              <tbody>
                {data.filter((k) => k.question === g).map((k) => (
                  <tr key={k.kpi_code}>
                    <td className="font-semibold whitespace-nowrap">{k.kpi_name}<span className="block text-xs font-normal" style={{ color: "var(--ink-3)" }}><code>{k.kpi_code}</code></span></td>
                    <td className="max-w-xl">{k.definition}</td>
                    <td className="whitespace-nowrap">{target(k)} <span style={{ color: "var(--ink-3)" }}>({k.direction} is better)</span></td>
                    <td>{k.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  );
}
