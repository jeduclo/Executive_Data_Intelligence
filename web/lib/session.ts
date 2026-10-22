import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "hp_session";
const GATE = "hp_gate";
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (16+ chars)");
  return "dev-only-secret-change-me";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function seal(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function unseal<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp: number };
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

export type Session = { uid: string; exp: number };

export async function readSession(): Promise<Session | null> {
  return unseal<Session>((await cookies()).get(COOKIE)?.value);
}

export async function writeSession(uid: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE };
  const jar = await cookies();
  jar.set(COOKIE, seal({ uid, exp }), opts);
  jar.set(GATE, seal({ ok: true, exp }), opts);
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** True once the visitor has entered the demo access code in this browser. */
export async function passedGate(): Promise<boolean> {
  if (!process.env.DEMO_ACCESS_CODE) return true;
  return unseal<{ ok: boolean }>((await cookies()).get(GATE)?.value) !== null;
}
