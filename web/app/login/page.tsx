import { listPersonas } from "@/lib/viewer";
import { passedGate, readSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Halden Group reporting" };

const ACCESS: Record<string, string> = {
  rpt_executive: "All sites · all figures",
  rpt_finance: "Assigned sites · all figures incl. margin",
  rpt_site_manager: "Own site · no cost or margin",
  rpt_customer_service: "Order status only · no financial values",
};

export default async function LoginPage() {
  const [personas, gate, session] = await Promise.all([listPersonas(), passedGate(), readSession()]);
  const options = personas.map((p) => ({
    id: p.user_id,
    name: p.display_name,
    title: p.title,
    access: ACCESS[p.db_role] ?? p.db_role,
    role: p.db_role,
  }));
  return (
    <main className="min-h-screen grid lg:grid-cols-[1fr_1.1fr]">
      <section className="hidden lg:flex flex-col justify-between p-12" style={{ background: "var(--rail)", color: "var(--rail-ink)" }}>
        <div className="flex items-center gap-3">
          <Logo />
          <span className="font-semibold tracking-tight">Halden Group</span>
        </div>
        <div className="max-w-md">
          <p className="eyebrow" style={{ color: "var(--rail-ink-2)" }}>Proof of concept</p>
          <h1 className="serif text-4xl leading-tight mt-3">
            One version of the numbers, for every site, without the spreadsheets.
          </h1>
          <p className="mt-5 leading-relaxed" style={{ color: "var(--rail-ink-2)" }}>
            ERP, MES, quality and finance data flow automatically through a governed medallion pipeline into a
            secured reporting layer. Each persona below sees exactly what the database allows - nothing more.
          </p>
        </div>
        <p className="text-xs" style={{ color: "var(--rail-ink-2)" }}>
          All data is synthetic. Company, sites, customers and suppliers are fictional.
        </p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-lg">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Logo />
            <span className="font-semibold">Halden Group</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in as a persona</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            Switch between roles to see row- and column-level security enforced by PostgreSQL.
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
            Use the following password: Halden-2026.
          </p>
          <LoginForm personas={options} needCode={!gate} current={session?.uid} />
        </div>
      </section>
    </main>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="7" fill="#2a78d6" />
      <path d="M8 7v14M20 7v14M8 14h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
