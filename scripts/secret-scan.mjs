// Fails if a tracked/untracked (non-ignored) file looks like it holds a secret or confidential case data. Run before every commit.
import { execSync } from "node:child_process";
import fs from "node:fs";

const PATTERNS = [
  [/sk-or-v1-[a-f0-9]{20,}/, "OpenRouter key"],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/, "Resend key"],
  [/tvly-[A-Za-z0-9]{16,}/, "Tavily key"],
  [/\bsk-lf-[a-f0-9-]{20,}|\bpk-lf-[a-f0-9-]{20,}/, "Langfuse key"],
  [/npg_[A-Za-z0-9]{8,}/, "Neon password"],
  [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]{6,}@/, "Postgres URL with password"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/whsec_[A-Za-z0-9+/=]{20,}/, "Webhook secret"],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/, "JWT / Calendly PAT"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key"],
];
const BLOCKED_FILES = [/\.env(\..*)?$/, /seed-credentials/, /AIC_B6_/, /\.pdf$/i, /\.xlsx$/i];
const ALLOWED = new Set([".env.example"]);

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
let bad = 0;
for (const f of files) {
  if (!ALLOWED.has(f) && BLOCKED_FILES.some((re) => re.test(f))) { console.error(`BLOCKED FILE: ${f}`); bad++; continue; }
  if (f.endsWith("package-lock.json") || !fs.existsSync(f)) continue;
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  for (const [re, label] of PATTERNS) if (re.test(text)) { console.error(`SECRET? ${label} in ${f}`); bad++; }
}
if (bad) { console.error(`\n${bad} problem(s). Nothing should be committed until fixed.`); process.exit(1); }
console.log(`Secret scan clean (${files.length} files).`);
