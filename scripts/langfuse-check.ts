/** Sends one synthetic trace (root span + step span + generation) to Langfuse and confirms it is queryable. */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.APP_ENV = "test";

async function main() {
  const { startTrace, logSpan, logGeneration } = await import("../src/lib/obs/langfuse");
  const id = `check_${Date.now()}`;
  const t0 = new Date(Date.now() - 2000);
  const ok = [
    await startTrace({ traceId: id, name: "langfuse.check", applicationId: null, metadata: { purpose: "connectivity check" } }),
    await logSpan({ traceId: id, name: "step.check", start: t0, end: new Date() }),
    await logGeneration({ traceId: id, name: "check.generation", model: "google/gemini-3.1-flash-lite", start: t0, end: new Date(), inputTokens: 10, outputTokens: 5, costUsd: 0.00001, promptKey: "check", promptVersion: "v1", retries: 0, route: "check" }),
  ];
  console.log("export accepted:", ok);
  const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
  const base = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${base}/api/public/v2/observations?limit=5&name=check.generation&fromStartTime=${encodeURIComponent(t0.toISOString())}`, { headers: { Authorization: `Basic ${auth}` } });
    const body = (await res.json()) as { data?: { name: string }[] };
    if (body.data?.length) { console.log(`found ${body.data.length} generation(s) from this check in Langfuse`); process.exit(0); }
    console.log(`not visible yet (HTTP ${res.status})`);
  }
  process.exit(1);
}
main();
