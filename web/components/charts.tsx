"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type Fmt = "pct" | "pct1" | "days" | "gbp" | "gbpm";

function fmt(kind: Fmt, n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  switch (kind) {
    case "pct":
      return `${Math.round(n * 100)}%`;
    case "pct1":
      return `${(n * 100).toFixed(1)}%`;
    case "days":
      return `${Math.round(n)}d`;
    case "gbpm":
      return `£${(n / 1e6).toFixed(1)}m`;
    case "gbp": {
      const a = Math.abs(n);
      const s = n < 0 ? "−" : "";
      return a >= 1e6 ? `${s}£${(a / 1e6).toFixed(1)}m` : a >= 1e3 ? `${s}£${Math.round(a / 1e3)}k` : `${s}£${Math.round(a)}`;
    }
  }
}

export type Series = {
  key: string;
  label: string;
  color: string;
  emphasis?: boolean; // false = recede to grey context line
  dashed?: boolean; // projections only
};

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2" style={{ color: "var(--ink-2)" }}>
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="1" y1="4" x2="17" y2="4"
              stroke={s.emphasis === false ? "var(--muted-series)" : s.color}
              strokeWidth={s.emphasis === false ? 1.5 : 2.5}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              strokeLinecap="round"
            />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({
  active, payload, label, series, kind,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null }[];
  label?: string;
  series: Series[];
  kind: Fmt;
}) {
  if (!active || !payload?.length) return null;
  const rows = series
    .map((s) => ({ s, v: payload.find((p) => p.dataKey === s.key)?.value }))
    .filter((r) => r.v !== null && r.v !== undefined);
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-sm" style={{ background: "var(--surface-1)", borderColor: "var(--hairline)" }}>
      <p className="font-semibold mb-1">{label}</p>
      {rows.map(({ s, v }) => (
        <p key={s.key} className="flex items-center gap-2 tnum">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: s.emphasis === false ? "var(--muted-series)" : s.color }} />
          <span style={{ color: "var(--ink-2)" }}>{s.label}</span>
          <span className="ml-auto pl-3 font-semibold">{fmt(kind, v as number)}</span>
        </p>
      ))}
    </div>
  );
}

export function LineSeriesChart({
  data,
  series,
  kind,
  target,
  height = 260,
  yDomain,
  endLabels = true,
}: {
  data: Record<string, string | number | null>[];
  series: Series[];
  kind: Fmt;
  target?: { value: number; label: string };
  height?: number;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  endLabels?: boolean;
}) {
  // draw context lines first so emphasised ones sit on top
  const ordered = [...series].sort((a, b) => Number(a.emphasis !== false) - Number(b.emphasis !== false));
  const lastIndex = (key: string) => {
    for (let i = data.length - 1; i >= 0; i--) if (data[i][key] !== null && data[i][key] !== undefined) return i;
    return -1;
  };
  return (
    <figure>
      <Legend series={series} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: endLabels ? 56 : 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={{ stroke: "var(--hairline)" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => fmt(kind, v)}
              domain={yDomain ?? ["auto", "auto"]}
            />
            {target && (
              <ReferenceLine
                y={target.value}
                stroke="var(--ink-3)"
                strokeWidth={1}
                label={{ value: target.label, position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11 }}
              />
            )}
            <Tooltip content={<TooltipBox series={series} kind={kind} />} cursor={{ stroke: "var(--hairline)" }} />
            {ordered.map((s) => {
              const li = lastIndex(s.key);
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.emphasis === false ? "var(--muted-series)" : s.color}
                  strokeWidth={s.emphasis === false ? 1.5 : 2.25}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                  connectNulls
                  isAnimationActive={false}
                >
                  {endLabels && s.emphasis !== false && (
                    <LabelList
                      dataKey={s.key}
                      content={(p: { index?: number; x?: number | string; y?: number | string; value?: unknown }) =>
                        p.index === li ? (
                          <text x={Number(p.x) + 6} y={Number(p.y) + 4} fontSize={11} fontWeight={600} fill="var(--ink)">
                            {fmt(kind, Number(p.value))}
                          </text>
                        ) : null
                      }
                    />
                  )}
                </Line>
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Horizontal bars around zero: red = losing, blue = gaining. Each bar labelled. */
export function DivergingBars({
  data,
  kind,
  height,
}: {
  data: { label: string; value: number; note?: string }[];
  kind: Fmt;
  height?: number;
}) {
  const h = height ?? Math.max(140, data.length * 40 + 30);
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  return (
    <figure style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={10}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[-max * 1.45, max * 1.45]} hide />
          <YAxis type="category" dataKey="label" width={128} tickLine={false} axisLine={false} />
          <ReferenceLine x={0} stroke="var(--ink-3)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ background: "var(--surface-1)", borderColor: "var(--hairline)" }}>
                  <p className="font-semibold">{(payload[0].payload as { label: string }).label}</p>
                  <p className="tnum">{fmt(kind, payload[0].value as number)}</p>
                  {(payload[0].payload as { note?: string }).note && (
                    <p style={{ color: "var(--ink-2)" }}>{(payload[0].payload as { note?: string }).note}</p>
                  )}
                </div>
              ) : null
            }
          />
          <Bar dataKey="value" radius={4} isAnimationActive={false} maxBarSize={22}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.value < 0 ? "var(--neg)" : "var(--pos)"} />
            ))}
            <LabelList
              dataKey="value"
              content={(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
                const v = Number(p.value);
                const x = Number(p.x) + (v < 0 ? 0 : Number(p.width));
                return (
                  <text
                    x={v < 0 ? Math.min(x, Number(p.x) + Number(p.width)) - 6 : x + 6}
                    y={Number(p.y) + Number(p.height) / 2 + 4}
                    fontSize={11}
                    fontWeight={600}
                    textAnchor={v < 0 ? "end" : "start"}
                    fill="var(--ink)"
                  >
                    {fmt(kind, v)}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Simple vertical bars, one series, with an optional comparison line (e.g. budget). */
export function ColumnsVsPlan({
  data,
  kind,
  height = 220,
}: {
  data: { x: string; actual: number | null; plan: number | null }[];
  kind: Fmt;
  height?: number;
}) {
  const series: Series[] = [
    { key: "actual", label: "Actual", color: "var(--series-1)" },
    { key: "plan", label: "Plan", color: "var(--plan)" },
  ];
  return (
    <figure>
      <Legend series={series} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={{ stroke: "var(--hairline)" }} />
            <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmt(kind, v)} />
            <Tooltip content={<TooltipBox series={series} kind={kind} />} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="actual" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="plan" fill="var(--muted-series)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
