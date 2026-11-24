/**
 * Data minimisation before any text leaves the fund (L8 prompt audit):
 * founder names → F1/F2, emails/phones/LinkedIn/URLs-with-names removed.
 */
export type FounderRef = { code: string; name?: string | null; email?: string | null; phone?: string | null; linkedin?: string | null };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)]+/gi;
const AADHAAR_PAN = /\b(?:\d{4}\s?\d{4}\s?\d{4}|[A-Z]{5}\d{4}[A-Z])\b/g;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redact(text: string, founders: FounderRef[] = []): string {
  let out = text
    .replace(LINKEDIN, "[LINKEDIN]")
    .replace(EMAIL, "[EMAIL]")
    .replace(AADHAAR_PAN, "[ID]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 10 ? "[PHONE]" : m));
  for (const f of founders) {
    if (!f.name) continue;
    const parts = f.name.split(/\s+/).filter((p) => p.length > 1);
    const full = escapeRe(f.name.trim());
    out = out.replace(new RegExp(`\\b${full}\\b`, "gi"), f.code);
    for (const p of parts) out = out.replace(new RegExp(`\\b${escapeRe(p)}\\b`, "g"), f.code);
  }
  return out;
}

/** Returns the PII fragments still present — used by the prompt-audit script and eval check 9. */
export function findPii(text: string, founders: FounderRef[] = []): string[] {
  const hits: string[] = [];
  for (const re of [EMAIL, LINKEDIN]) for (const m of text.match(re) ?? []) hits.push(m);
  for (const m of text.match(PHONE) ?? []) if (m.replace(/\D/g, "").length >= 10) hits.push(m);
  for (const f of founders) {
    for (const v of [f.email, f.phone, f.linkedin]) if (v && text.includes(v)) hits.push(v);
    if (f.name && f.name.trim().length > 3 && new RegExp(`\\b${escapeRe(f.name.trim())}\\b`, "i").test(text)) hits.push(f.name);
  }
  return [...new Set(hits)];
}

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (the |all )?(system|previous) (prompt|instructions)/i,
  /you are now/i,
  /(score|rate) (this|us|me) (a )?(10|ten|5\/5|perfect)/i,
  /system prompt/i,
  /\bact as\b.*\b(admin|developer|system)\b/i,
  /<\/?(system|assistant|instructions)>/i,
];

/** Code-side detector; model output can never clear this flag. */
export function detectInjection(text: string): boolean {
  return INJECTION.some((re) => re.test(text));
}

export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|llp|inc|technologies|technology|labs?)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}
