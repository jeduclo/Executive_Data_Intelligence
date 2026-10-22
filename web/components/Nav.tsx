"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Caps } from "@/lib/viewer";

type Item = { href: string; label: string; show?: (c: Caps) => boolean };

const REPORTING: Item[] = [
  { href: "/", label: "Executive brief" },
  { href: "/sites", label: "Sites", show: (c) => c.weekly },
  { href: "/orders", label: "Orders", show: (c) => c.orders },
  { href: "/alerts", label: "Alerts", show: (c) => c.exceptions },
];
const PLATFORM: Item[] = [
  { href: "/architecture", label: "Architecture" },
  { href: "/security", label: "Security model" },
  { href: "/data-quality", label: "Data quality" },
  { href: "/definitions", label: "KPI definitions" },
];

export default function Nav({ caps }: { caps: Caps }) {
  const path = usePathname();
  const link = (i: Item) => {
    if (i.show && !i.show(caps)) return null;
    const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
    return (
      <Link
        key={i.href}
        href={i.href}
        className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm"
        style={{
          background: active ? "var(--rail-active)" : "transparent",
          color: active ? "var(--rail-ink)" : "var(--rail-ink-2)",
          fontWeight: active ? 600 : 500,
        }}
        aria-current={active ? "page" : undefined}
      >
        {i.label}
      </Link>
    );
  };
  return (
    <nav className="flex lg:flex-col gap-1 px-3 overflow-x-auto lg:overflow-visible items-center lg:items-stretch">
      <p className="hidden lg:block eyebrow px-3 pt-2 pb-1" style={{ color: "var(--rail-ink-2)" }}>Reporting</p>
      {REPORTING.map(link)}
      <p className="hidden lg:block eyebrow px-3 pt-5 pb-1" style={{ color: "var(--rail-ink-2)" }}>Platform</p>
      {PLATFORM.map(link)}
    </nav>
  );
}
