import { createHmac, timingSafeEqual } from "node:crypto";

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Resend webhooks are signed with Svix: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`. */
export function verifySvix(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowMs = Date.now()): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false; // 5-minute replay window
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest("base64");
  return headers.signature.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    return ver === "v1" && !!sig && safeEq(sig, expected);
  });
}

/** Calendly: header `Calendly-Webhook-Signature: t=<ts>,v1=<hex hmac of "t.body">`. */
export function verifyCalendly(rawBody: string, header: string | null, signingKey: string, nowMs = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(nowMs / 1000 - Number(parts.t)) > 180) return false;
  const expected = createHmac("sha256", signingKey).update(`${parts.t}.${rawBody}`).digest("hex");
  return safeEq(parts.v1, expected);
}
