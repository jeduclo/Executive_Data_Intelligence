export function gbp(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}£${(a / 1e6).toFixed(digits ?? (a >= 1e8 ? 0 : 1))}m`;
  if (a >= 1e3) return `${sign}£${(a / 1e3).toFixed(digits ?? 0)}k`;
  return `${sign}£${a.toFixed(0)}`;
}

export function signedGbp(n: number): string {
  return (n > 0 ? "+" : "") + gbp(n);
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return `${(n * 100).toFixed(digits)}%`;
}

export function signedPct(n: number, digits = 1): string {
  const s = (n * 100).toFixed(digits);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s.replace("-", "")}%`;
}

export function pts(n: number, digits = 1): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(digits)} pts`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "–";
  return n.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function shortDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Fixed colour per site - colour follows the entity, never its rank. */
export const SITE_COLOR: Record<number, string> = {
  1: "var(--series-1)",
  2: "var(--series-2)",
  3: "var(--series-3)",
  4: "var(--series-4)",
  5: "var(--series-5)",
};

export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}
