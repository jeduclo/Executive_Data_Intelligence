"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

type Option = { id: string; name: string; title: string; access: string; role: string };

export default function LoginForm({ personas, needCode, current }: { personas: Option[]; needCode: boolean; current?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const initial = state.uid ?? current ?? personas[0]?.id;
  return (
    <form action={action} className="mt-8 space-y-6">
      <fieldset className="space-y-2" key={initial}>
        <legend className="eyebrow mb-2">Persona</legend>
        {personas.map((p) => (
          <label
            key={p.id}
            className="flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors border-[var(--hairline)] has-[:checked]:border-[var(--ink)] has-[:checked]:shadow-[inset_0_0_0_1px_var(--ink)]"
            style={{ background: "var(--surface-1)" }}
          >
            <input
              type="radio"
              name="persona"
              value={p.id}
              defaultChecked={initial === p.id}
              className="mt-1 accent-current"
            />
            <span className="flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm" style={{ color: "var(--ink-2)" }}>{p.title}</span>
              </span>
              <span className="block text-xs mt-1" style={{ color: "var(--ink-3)" }}>
                {p.access} · <code>{p.role}</code>
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {needCode && (
        <label className="block">
          <span className="eyebrow">Access code</span>
          <input
            name="code"
            type="password"
            required
            autoComplete="off"
            className="mt-2 w-full rounded-xl border px-3 py-2.5 text-base"
            style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }}
          />
        </label>
      )}
      {state.error && (
        <p role="alert" className="text-sm" style={{ color: "var(--critical-ink)" }}>{state.error}</p>
      )}
      <button type="submit" className="btn btn-primary w-full justify-center" disabled={pending}>
        {pending ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}
