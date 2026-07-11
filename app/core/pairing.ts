import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const pairingCodes = new Map<string, { secret: string; expires: number }>();
const appSessions = new Map<string, number>();

export function extensionToken(installSecret: string): string {
  return createHmac("sha256", installSecret).update("x2md-extension-v1").digest("base64url");
}

export function issuePairingCode(installSecret: string, ttlMs = 5 * 60_000): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  pairingCodes.set(code, { secret: installSecret, expires: Date.now() + ttlMs });
  return code;
}

export function consumePairingCode(code: string, installSecret: string): string | null {
  const entry = pairingCodes.get(code);
  pairingCodes.delete(code);
  if (!entry || entry.expires < Date.now() || entry.secret !== installSecret) return null;
  return extensionToken(installSecret);
}

export function issueAppSession(ttlMs = Number.POSITIVE_INFINITY): string {
  const token = randomBytes(24).toString("base64url");
  appSessions.set(token, Date.now() + ttlMs);
  return token;
}

export function revokeAppSession(token: string): void {
  appSessions.delete(token);
}

function equalToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidCredential(token: string, installSecret: string): boolean {
  const expires = appSessions.get(token);
  if (expires) {
    if (expires >= Date.now()) return true;
    appSessions.delete(token);
  }
  return Boolean(token) && equalToken(token, extensionToken(installSecret));
}

export function credentialKind(token: string, installSecret: string): "app" | "extension" | null {
  const expires = appSessions.get(token);
  if (expires) {
    if (expires >= Date.now()) return "app";
    appSessions.delete(token);
  }
  return Boolean(token) && equalToken(token, extensionToken(installSecret)) ? "extension" : null;
}
