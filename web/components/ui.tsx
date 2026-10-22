import Link from "next/link";

export type Status = "good" | "warning" | "critical" | "neutral";

const STATUS_COLOR: Record<Status, string> = {
  good: "var(--good)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  neutral: "var(--ink-3)",
};
const STATUS_LABEL: Record<Status, string> = {
  good: "On track",
  warning: "Watch",
  critical: "Action needed",
  neutral: "Restricted",
};

/** Status never relies on colour alone: icon shape + text label. */
export function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  const c = STATUS_COLOR[status];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {status === "good" && (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M4.8 8.2l2.1 2.1 4.3-4.6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "warning" && (
        <>
          <path d="M8 1.5l7 12.5H1z" fill={c} />
          <path d="M8 6v3.6" stroke="#1a1a19" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="1" fill="#1a1a19" />
        </>
      )}
      {status === "critical" && (
        <>
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={c} />
          <path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {status === "neutral" && <circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.6" />}
    </svg>
  );
}

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
      <StatusIcon status={status} size={14} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-1">{title}</h1>
      {children && <div className="mt-2 max-w-3xl text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{children}</div>}
    </div>
  );
}

/** A question the business asks, the data's answer, and the evidence. */
export function Question({
  id,
  number,
  question,
  status,
  answer,
  owner,
  drill,
  children,
}: {
  id: string;
  number: number;
  question: string;
  status: Status;
  answer: React.ReactNode;
  owner?: string;
  drill?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="card p-5 sm:p-7 scroll-mt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="eyebrow tnum">Q{number}</span>
        {owner && <span className="eyebrow">· {owner}</span>}
        <span className="ml-auto"><StatusPill status={status} /></span>
      </div>
      <h2 className="question text-[22px] sm:text-[26px] leading-tight mt-2">{question}</h2>
      <div className="mt-3 text-[15.5px] sm:text-[17px] leading-relaxed max-w-4xl">{answer}</div>
      {children && <div className="mt-6">{children}</div>}
      {drill && (
        <div className="mt-5 pt-4 border-t text-sm" style={{ borderColor: "var(--grid)" }}>
          <Link className="link font-medium" href={drill.href}>{drill.label} →</Link>
        </div>
      )}
    </section>
  );
}

export function Locked({ what, reason }: { what: string; reason: string }) {
  return (
    <div className="rounded-xl border border-dashed p-5 flex gap-3 items-start" style={{ borderColor: "var(--hairline)", background: "var(--surface-2)" }}>
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden className="mt-0.5 shrink-0">
        <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.3 7V5a2.7 2.7 0 015.4 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <div className="text-sm">
        <p className="font-semibold">{what} is not available to your role</p>
        <p className="mt-1" style={{ color: "var(--ink-2)" }}>{reason}</p>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  status?: Status;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium" style={{ color: "var(--ink-2)" }}>{label}</p>
        {status && <StatusIcon status={status} size={14} />}
      </div>
      <p className="text-2xl font-semibold tnum mt-1.5 tracking-tight">{value}</p>
      {sub && <p className="text-xs mt-1 tnum" style={{ color: "var(--ink-3)" }}>{sub}</p>}
    </div>
  );
}

/**
 * Horizontal bullet bars for comparing sites against one target - plain HTML,
 * readable without a legend, every bar labelled with its value.
 */
export function BulletBars({
  rows,
  target,
  max,
  format,
  higherIsBetter = true,
}: {
  rows: { label: string; value: number | null; href?: string; note?: string }[];
  target: number;
  max: number;
  format: (n: number) => string;
  higherIsBetter?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const v = r.value ?? 0;
        const ok = higherIsBetter ? v >= target : v <= target;
        const near = higherIsBetter ? v >= target * 0.95 : v <= target * 1.25;
        const status: Status = r.value === null ? "neutral" : ok ? "good" : near ? "warning" : "critical";
        const w = Math.max(0, Math.min(1, v / max)) * 100;
        const t = Math.min(1, target / max) * 100;
        const label = r.href ? <Link className="link" href={r.href}>{r.label}</Link> : r.label;
        return (
          <div key={r.label} className="grid grid-cols-[110px_1fr_auto] sm:grid-cols-[140px_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate">{label}</span>
            <div className="relative h-[14px] rounded-[4px]" style={{ background: "var(--surface-2)" }}>
              <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${w}%`, background: ok ? "var(--series-1)" : "var(--critical)" }} />
              <div className="absolute -inset-y-1 w-[2px]" style={{ left: `calc(${t}% - 1px)`, background: "var(--ink)" }} title={`Target ${format(target)}`} />
            </div>
            <span className="flex items-center gap-1.5 tnum font-semibold w-[76px] justify-end">
              <StatusIcon status={status} size={13} />
              {r.value === null ? "–" : format(v)}
            </span>
          </div>
        );
      })}
      <p className="text-xs pt-1" style={{ color: "var(--ink-3)" }}>
        Black tick = target ({format(target)}). Bars turn red when the target is missed.
      </p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm py-6 text-center" style={{ color: "var(--ink-3)" }}>{children}</p>;
}
