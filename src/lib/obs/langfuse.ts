import { randomUUID } from "node:crypto";
import { env, integrations, langfuseBaseUrl } from "@/lib/env";
import { db } from "@/db";
import { systemState } from "@/db/schema";

/**
 * Minimal Langfuse client over the public ingestion API (works in serverless:
 * every flush is awaited, nothing is lost when the function freezes).
 * Bodies are NOT sent unless LANGFUSE_LOG_BODIES=true and APP_ENV=test (L8: logs are a second copy of founder data).
 */
type Event = { id: string; timestamp: string; type: string; body: Record<string, unknown> };

const iso = (d = new Date()) => d.toISOString();

async function send(batch: Event[]) {
  if (!integrations().langfuse || batch.length === 0) return;
  const e = env();
  const auth = Buffer.from(`${e.LANGFUSE_PUBLIC_KEY}:${e.LANGFUSE_SECRET_KEY}`).toString("base64");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${langfuseBaseUrl()}/api/public/ingestion`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batch }),
    });
    const ok = res.status === 200 || res.status === 207;
    const detail = ok ? null : `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
    await record(ok, detail);
  } catch (err) {
    await record(false, err instanceof Error ? err.message : "unknown");
  } finally {
    clearTimeout(t);
  }
}

async function record(ok: boolean, error: string | null) {
  const value = ok ? { ok: true, lastOkAt: iso() } : { ok: false, lastError: error, lastErrorAt: iso() };
  try {
    await db()
      .insert(systemState)
      .values({ key: "langfuse", value })
      .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
  } catch {
    /* tracing must never break the pipeline */
  }
}

const bodiesAllowed = () => env().LANGFUSE_LOG_BODIES === "true" && env().APP_ENV === "test";

export function startTrace(opts: { traceId: string; name: string; applicationId?: string | null; metadata?: Record<string, unknown> }) {
  return send([
    {
      id: randomUUID(),
      timestamp: iso(),
      type: "trace-create",
      body: {
        id: opts.traceId,
        name: opts.name,
        sessionId: opts.applicationId ?? undefined,
        tags: [env().APP_ENV],
        metadata: { ...opts.metadata, applicationId: opts.applicationId, env: env().APP_ENV },
      },
    },
  ]);
}

export function logSpan(opts: {
  traceId: string; name: string; start: Date; end: Date; error?: string | null; metadata?: Record<string, unknown>;
}) {
  return send([
    {
      id: randomUUID(),
      timestamp: iso(),
      type: "span-create",
      body: {
        id: randomUUID(),
        traceId: opts.traceId,
        name: opts.name,
        startTime: iso(opts.start),
        endTime: iso(opts.end),
        level: opts.error ? "ERROR" : "DEFAULT",
        statusMessage: opts.error ?? undefined,
        metadata: opts.metadata,
      },
    },
  ]);
}

export function logGeneration(opts: {
  traceId: string; name: string; model: string; start: Date; end: Date;
  inputTokens: number; outputTokens: number; costUsd: number | null;
  promptKey: string; promptVersion: string; retries: number; error?: string | null;
  applicationId?: string | null; route: string; input?: unknown; output?: unknown;
}) {
  return send([
    {
      id: randomUUID(),
      timestamp: iso(),
      type: "generation-create",
      body: {
        id: randomUUID(),
        traceId: opts.traceId,
        name: opts.name,
        model: opts.model,
        startTime: iso(opts.start),
        endTime: iso(opts.end),
        usage: { input: opts.inputTokens, output: opts.outputTokens, unit: "TOKENS" },
        usageDetails: { input: opts.inputTokens, output: opts.outputTokens },
        costDetails: opts.costUsd != null ? { total: opts.costUsd } : undefined,
        level: opts.error ? "ERROR" : "DEFAULT",
        statusMessage: opts.error ?? undefined,
        input: bodiesAllowed() ? opts.input : "[redacted: bodies not logged]",
        output: bodiesAllowed() ? opts.output : "[redacted: bodies not logged]",
        metadata: {
          promptKey: opts.promptKey,
          promptVersion: opts.promptVersion,
          retries: opts.retries,
          route: opts.route,
          applicationId: opts.applicationId,
        },
      },
    },
  ]);
}
