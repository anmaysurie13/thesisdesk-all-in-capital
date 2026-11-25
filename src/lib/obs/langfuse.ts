import { createHash, randomBytes } from "node:crypto";
import { env, integrations, langfuseBaseUrl } from "@/lib/env";
import { db } from "@/db";
import { systemState } from "@/db/schema";

/**
 * Langfuse tracing over its OpenTelemetry endpoint (OTLP/HTTP JSON). The legacy /api/public/ingestion
 * API was removed by Langfuse on 2026-11-16, so spans are sent as OTLP with Langfuse attributes.
 * Every export is awaited (serverless-safe). Bodies are NOT sent unless LANGFUSE_LOG_BODIES=true in TEST
 * (L8: logs are a second copy of founder data).
 */
type Attr = { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean } };
type Span = {
  traceId: string; spanId: string; parentSpanId?: string; name: string; kind: number;
  startTimeUnixNano: string; endTimeUnixNano: string; attributes: Attr[]; status: { code: number; message?: string };
};

const hex = (s: string, len: number) => createHash("sha256").update(s).digest("hex").slice(0, len);
const otelTraceId = (traceId: string) => hex(`trace:${traceId}`, 32);
const rootSpanId = (traceId: string) => hex(`root:${traceId}`, 16);
const nano = (d: Date) => `${d.getTime()}000000`;
const bodiesAllowed = () => env().LANGFUSE_LOG_BODIES === "true" && env().APP_ENV === "test";

function attrs(o: Record<string, unknown>): Attr[] {
  const out: Attr[] = [];
  for (const [key, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === "number") out.push({ key, value: Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } });
    else if (typeof v === "boolean") out.push({ key, value: { boolValue: v } });
    else out.push({ key, value: { stringValue: typeof v === "string" ? v : JSON.stringify(v) } });
  }
  return out;
}

async function record(ok: boolean, error: string | null) {
  const value = ok ? { ok: true, lastOkAt: new Date().toISOString() } : { ok: false, lastError: error, lastErrorAt: new Date().toISOString() };
  try {
    await db().insert(systemState).values({ key: "langfuse", value }).onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
  } catch {
    /* tracing must never break the pipeline */
  }
}

export async function exportSpans(spans: Span[]): Promise<boolean> {
  if (!integrations().langfuse || spans.length === 0) return false;
  const e = env();
  const auth = Buffer.from(`${e.LANGFUSE_PUBLIC_KEY}:${e.LANGFUSE_SECRET_KEY}`).toString("base64");
  const body = {
    resourceSpans: [{
      resource: { attributes: attrs({ "service.name": "thesisdesk", "deployment.environment": e.APP_ENV }) },
      scopeSpans: [{ scope: { name: "thesisdesk", version: "1" }, spans }],
    }],
  };
  try {
    const res = await fetch(`${langfuseBaseUrl()}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const ok = res.ok;
    await record(ok, ok ? null : `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return ok;
  } catch (err) {
    await record(false, err instanceof Error ? err.message : "unknown");
    return false;
  }
}

const traceAttrs = (env_: string, applicationId?: string | null) => ({
  "langfuse.session.id": applicationId ?? undefined,
  "langfuse.trace.tags": [env_],
  "langfuse.environment": env_ === "live" ? "production" : "test",
  "langfuse.trace.metadata.applicationId": applicationId ?? undefined,
});

/** Root span of one job run (one trace per run). */
export function startTrace(opts: { traceId: string; name: string; applicationId?: string | null; metadata?: Record<string, unknown> }) {
  const now = new Date();
  return exportSpans([{
    traceId: otelTraceId(opts.traceId), spanId: rootSpanId(opts.traceId), name: opts.name, kind: 1,
    startTimeUnixNano: nano(now), endTimeUnixNano: nano(now),
    attributes: attrs({
      ...traceAttrs(env().APP_ENV, opts.applicationId),
      "langfuse.trace.name": opts.name,
      "langfuse.trace.metadata.runId": opts.traceId,
      ...Object.fromEntries(Object.entries(opts.metadata ?? {}).map(([k, v]) => [`langfuse.trace.metadata.${k}`, v])),
    }),
    status: { code: 1 },
  }]);
}

/** One pipeline step (span). */
export function logSpan(opts: { traceId: string; name: string; start: Date; end: Date; error?: string | null; metadata?: Record<string, unknown> }) {
  return exportSpans([{
    traceId: otelTraceId(opts.traceId), spanId: randomBytes(8).toString("hex"), parentSpanId: rootSpanId(opts.traceId), name: opts.name, kind: 1,
    startTimeUnixNano: nano(opts.start), endTimeUnixNano: nano(opts.end),
    attributes: attrs({
      "langfuse.observation.type": "span",
      "langfuse.observation.level": opts.error ? "ERROR" : "DEFAULT",
      "langfuse.observation.status_message": opts.error ?? undefined,
      ...Object.fromEntries(Object.entries(opts.metadata ?? {}).map(([k, v]) => [`langfuse.observation.metadata.${k}`, v])),
    }),
    status: opts.error ? { code: 2, message: opts.error } : { code: 1 },
  }]);
}

/** One model call (generation) with model, tokens, cost, prompt version and retries. */
export function logGeneration(opts: {
  traceId: string; name: string; model: string; start: Date; end: Date;
  inputTokens: number; outputTokens: number; costUsd: number | null;
  promptKey: string; promptVersion: string; retries: number; error?: string | null;
  applicationId?: string | null; route: string; input?: unknown; output?: unknown;
}) {
  return exportSpans([{
    traceId: otelTraceId(opts.traceId), spanId: randomBytes(8).toString("hex"), parentSpanId: rootSpanId(opts.traceId), name: opts.name, kind: 3,
    startTimeUnixNano: nano(opts.start), endTimeUnixNano: nano(opts.end),
    attributes: attrs({
      ...traceAttrs(env().APP_ENV, opts.applicationId),
      "langfuse.observation.type": "generation",
      "langfuse.observation.model.name": opts.model,
      "gen_ai.request.model": opts.model,
      "gen_ai.usage.input_tokens": opts.inputTokens,
      "gen_ai.usage.output_tokens": opts.outputTokens,
      "langfuse.observation.usage_details": { input: opts.inputTokens, output: opts.outputTokens },
      "langfuse.observation.cost_details": opts.costUsd != null ? { total: opts.costUsd } : undefined,
      "langfuse.observation.prompt.name": opts.promptKey,
      "langfuse.observation.metadata.promptVersion": opts.promptVersion,
      "langfuse.observation.metadata.retries": opts.retries,
      "langfuse.observation.metadata.route": opts.route,
      "langfuse.observation.level": opts.error ? "ERROR" : "DEFAULT",
      "langfuse.observation.status_message": opts.error ?? undefined,
      "langfuse.observation.input": bodiesAllowed() ? opts.input : "[redacted: bodies not logged]",
      "langfuse.observation.output": bodiesAllowed() ? opts.output : "[redacted: bodies not logged]",
    }),
    status: opts.error ? { code: 2, message: opts.error } : { code: 1 },
  }]);
}
