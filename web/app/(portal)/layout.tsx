import { getViewer } from "@/lib/viewer";
import { signOut } from "../login/actions";
import Nav from "@/components/Nav";
import Link from "next/link";

const ROLE_LABEL: Record<string, string> = {
  rpt_executive: "Executive",
  rpt_finance: "Finance",
  rpt_site_manager: "Site manager",
  rpt_customer_service: "Customer service",
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const v = await getViewer();
  const scope = v.siteNames.length >= 5 ? "All 5 sites" : v.siteNames.join(", ");
  const refreshed = v.refreshedAt
    ? new Date(v.refreshedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"
    : "never";
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside
        className="lg:sticky lg:top-0 lg:h-screen flex lg:flex-col"
        style={{ background: "var(--rail)", color: "var(--rail-ink)" }}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 lg:py-6 shrink-0">
          <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden>
            <rect width="28" height="28" rx="7" fill="#2a78d6" />
            <path d="M8 7v14M20 7v14M8 14h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span className="font-semibold tracking-tight">Halden Group</span>
        </div>
        <Nav caps={v.caps} />
        <div className="hidden lg:block mt-auto px-5 pb-5 text-xs" style={{ color: "var(--rail-ink-2)" }}>
          Synthetic data · POC
        </div>
      </aside>
      <div className="min-w-0">
        <header
          className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-between px-4 sm:px-8 py-3 border-b"
          style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{v.display_name}</span>
            <span style={{ color: "var(--ink-2)" }}>{v.title}</span>
            <span className="chip">{ROLE_LABEL[v.db_role] ?? v.db_role} · {scope}</span>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--ink-3)" }}>
            <span className="tnum">Data as of {v.asOf} · refreshed {refreshed}</span>
            <Link href="/login" className="btn" style={{ padding: "5px 10px", fontSize: 12 }}>Switch persona</Link>
            <form action={signOut}>
              <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }}>Sign out</button>
            </form>
          </div>
        </header>
        <main className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1280px]">{children}</main>
      </div>
    </div>
  );
}
