"use server";

import { redirect } from "next/navigation";
import { clearSession, passedGate, writeSession } from "@/lib/session";
import { listPersonas } from "@/lib/viewer";

export type LoginState = { error?: string; uid?: string };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const uid = String(form.get("persona") ?? "");
  const code = String(form.get("code") ?? "");
  const expected = process.env.DEMO_ACCESS_CODE;
  if (expected && !(await passedGate()) && code.trim() !== expected) {
    return { error: "That access code is not right.", uid };
  }
  const personas = await listPersonas();
  if (!personas.some((p) => p.user_id === uid)) return { error: "Choose a persona to continue." };
  await writeSession(uid);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect("/login");
}
