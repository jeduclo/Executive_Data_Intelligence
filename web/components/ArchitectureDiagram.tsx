"use client";

import { useState } from "react";

export type Node = {
  id: string;
  title: string;
  tech: string;
  poc: string;
  production: string;
  stat?: string;
};

export type Column = { id: string; label: string; tone: string; nodes: Node[] };

export default function ArchitectureDiagram({ columns, orchestration }: { columns: Column[]; orchestration: Node }) {
  const all = [...columns.flatMap((c) => c.nodes), orchestration];
  const [selected, setSelected] = useState<string>("gold");
  const node = all.find((n) => n.id === selected) ?? all[0];

  const box = (n: Node, tone: string) => {
    const active = n.id === selected;
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => setSelected(n.id)}
        aria-pressed={active}
        className="w-full text-left rounded-xl px-3 py-2.5 transition-shadow"
        style={{
          // longhand border properties only: mixing `borderColor` with `borderLeft`
          // makes React warn when the selection changes
          borderStyle: "solid",
          borderWidth: "1px 1px 1px 4px",
          borderTopColor: active ? "var(--ink)" : "var(--hairline)",
          borderRightColor: active ? "var(--ink)" : "var(--hairline)",
          borderBottomColor: active ? "var(--ink)" : "var(--hairline)",
          borderLeftColor: tone,
          background: "var(--surface-1)",
          boxShadow: active ? "0 0 0 2px var(--ink) inset" : undefined,
        }}
      >
        <span className="block text-sm font-semibold leading-tight">{n.title}</span>
        <span className="block text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{n.tech}</span>
        {n.stat && <span className="block text-[11px] mt-1 tnum font-medium" style={{ color: "var(--ink-2)" }}>{n.stat}</span>}
      </button>
    );
  };

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="grid gap-2 min-w-[980px]" style={{ gridTemplateColumns: columns.map((_, i) => (i ? "18px 1fr" : "1fr")).join(" ") }}>
          {columns.map((col, i) => (
            <div key={col.id} className="contents">
              {i > 0 && (
                <div className="flex items-center justify-center" aria-hidden>
                  <svg width="18" height="24" viewBox="0 0 18 24"><path d="M2 12h12M9 6l6 6-6 6" stroke="var(--ink-3)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              )}
              <div className="rounded-2xl p-2.5 flex flex-col gap-2" style={{ background: "var(--surface-2)" }}>
                <p className="eyebrow px-1">{col.label}</p>
                <div className="flex flex-col gap-2 justify-center flex-1">{col.nodes.map((n) => box(n, col.tone))}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-[980px] mt-2">{box(orchestration, "var(--ink-3)")}</div>
      </div>

      <div className="card p-5 mt-4" aria-live="polite">
        <p className="eyebrow">{node.tech}</p>
        <h3 className="text-lg font-semibold mt-1">{node.title}</h3>
        <div className="grid md:grid-cols-2 gap-5 mt-3 text-sm leading-relaxed">
          <div>
            <p className="font-semibold mb-1">In this POC</p>
            <p style={{ color: "var(--ink-2)" }}>{node.poc}</p>
          </div>
          <div>
            <p className="font-semibold mb-1">At 150 sites / in production</p>
            <p style={{ color: "var(--ink-2)" }}>{node.production}</p>
          </div>
        </div>
        {node.stat && <p className="text-xs mt-3 tnum" style={{ color: "var(--ink-3)" }}>Last run: {node.stat}</p>}
      </div>
    </div>
  );
}