import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { modelCache, modelCalls } from "@/db/schema";
import { env, integrations } from "@/lib/env";
import { logGeneration } from "@/lib/obs/langfuse";
import { findPii } from "@/lib/pii";
import { estimateCost } from "./pricing";
import { assertQuota, QuotaError } from "./quota";

export type Tier = "primary" | "fast" | "judge";
export type CallCtx = { applicationId?: string | null; jobId?: string | null; runId?: string | null; step: string; traceId?: string | null };

export class ModelError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
  }
}

export function modelFor(tier: Tier): string {
  const e = env();
  return tier === "primary" ? e.GEMINI_MODEL_PRIMARY : tier === "fast" ? e.GEMINI_MODEL_FAST : e.GEMINI_MODEL_JUDGE;
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const MAX_TRIES = 4; // 1 + 3 retries (L8: 1s, 2s, 4s with jitter)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);

type Raw = { content: string; inputTokens: number; outputTokens: number; costUsd: number | null; retries: number; route: "portkey" | "direct" };

/**
 * Exactly one retry layer:
 *  - Portkey configured → Portkey retries (attempts=3, exponential backoff); our code does not retry.
 *  - Portkey missing    → this function retries with the same policy.
 * Exhausted requests throw ModelError(retryable) and the job goes back to the queue — never lost.
 */
async function transport(model: string, system: string, user: string, jsonSchema: unknown, traceId: string | null, meta: Record<string, unknown>): Promise<Raw> {
  const e = env();
  if (!e.OPENROUTER_API_KEY) throw new ModelError("OPENROUTER_API_KEY is not configured", false);
  const body = JSON.stringify({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name: "output", strict: false, schema: jsonSchema } },
    provider: { data_collection: e.OPENROUTER_DATA_COLLECTION, allow_fallbacks: true, require_parameters: true },
    usage: { include: true },
  });
  const viaPortkey = !!e.PORTKEY_API_KEY;
  const url = viaPortkey ? "https://api.portkey.ai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${e.OPENROUTER_API_KEY}`,
    "X-Title": "ThesisDesk",
  };
  if (viaPortkey) {
    headers["x-portkey-api-key"] = e.PORTKEY_API_KEY!;
    headers["x-portkey-provider"] = e.PORTKEY_PROVIDER;
    headers["x-portkey-config"] = JSON.stringify({
      retry: { attempts: 3, on_status_codes: [429, 500, 502, 503, 504] },
      request_timeout: 90_000,
    });
    if (traceId) headers["x-portkey-trace-id"] = traceId;
    headers["x-portkey-metadata"] = JSON.stringify(Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v ?? "")])));
  }

  const tries = viaPortkey ? 1 : MAX_TRIES;
  let lastErr: ModelError | null = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 95_000);
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
      const portkeyRetries = Number(res.headers.get("x-portkey-retry-attempt-count") ?? 0) || 0;
      if (!res.ok) {
        const text = (await res.text()).slice(0, 240).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
        lastErr = new ModelError(`Provider HTTP ${res.status}: ${text}`, RETRYABLE.has(res.status), res.status);
        if (!lastErr.retryable || attempt === tries) throw Object.assign(lastErr, { retries: viaPortkey ? portkeyRetries : attempt - 1 });
        await sleep(backoff(attempt));
        continue;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        error?: { message?: string; code?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        const status = data.error?.code;
        lastErr = new ModelError(data.error?.message ?? "Provider returned no content", status ? RETRYABLE.has(status) : true, status);
        if (attempt === tries) throw lastErr;
        await sleep(backoff(attempt));
        continue;
      }
      return {
        content,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        costUsd: typeof data.usage?.cost === "number" ? data.usage.cost : null,
        retries: viaPortkey ? portkeyRetries : attempt - 1,
        route: viaPortkey ? "portkey" : "direct",
      };
    } catch (err) {
      if (err instanceof ModelError) throw err;
      lastErr = new ModelError(err instanceof Error && err.name === "AbortError" ? "Model request timed out" : "Could not reach model provider", true);
      if (attempt === tries) throw lastErr;
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ModelError("Unknown model failure", true);
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(trimmed);
}

export type CallSpec<T extends z.ZodType> = {
  promptKey: string;
  promptVersion: string;
  tier: Tier;
  system: string;
  user: string;
  schema: T;
  ctx: CallCtx;
  /** PII that must never appear in the prompt (prompt audit guard). */
  forbidden?: { code: string; name?: string | null; email?: string | null; phone?: string | null; linkedin?: string | null }[];
  cache?: boolean;
};

export type CallResult<T> = { data: T; cached: boolean; model: string; costUsd: number; inputTokens: number; outputTokens: number };

/** The ONLY way the app talks to a model. */
export async function callModel<T extends z.ZodType>(spec: CallSpec<T>): Promise<CallResult<z.infer<T>>> {
  const e = env();
  const model = modelFor(spec.tier);
  const prompt = `${spec.system}\n\n${spec.user}`;

  // Prompt audit guard: block the call if founder PII leaks into the prompt.
  const leaks = findPii(prompt, spec.forbidden ?? []);
  if (leaks.length) {
    await db().insert(modelCalls).values({
      env: e.APP_ENV, applicationId: spec.ctx.applicationId ?? null, jobId: spec.ctx.jobId ?? null, runId: spec.ctx.runId ?? null,
      step: spec.ctx.step, promptKey: spec.promptKey, promptVersion: spec.promptVersion, model, route: "none",
      status: "error", error: `Blocked: PII in prompt (${leaks.length} item(s))`,
    });
    throw new ModelError("Blocked by prompt audit: personal data found in prompt", false);
  }

  const cacheKey = createHash("sha256").update(JSON.stringify([spec.promptKey, spec.promptVersion, model, spec.system, spec.user])).digest("hex");
  const base = {
    env: e.APP_ENV, applicationId: spec.ctx.applicationId ?? null, jobId: spec.ctx.jobId ?? null, runId: spec.ctx.runId ?? null,
    step: spec.ctx.step, promptKey: spec.promptKey, promptVersion: spec.promptVersion, model, cacheKey, traceId: spec.ctx.traceId ?? null,
  };

  if (spec.cache !== false) {
    const [hit] = await db().select().from(modelCache).where(eq(modelCache.cacheKey, cacheKey));
    if (hit) {
      const parsed = spec.schema.safeParse(hit.response);
      if (parsed.success) {
        await db().update(modelCache).set({ hits: sql`${modelCache.hits} + 1` }).where(eq(modelCache.cacheKey, cacheKey));
        await db().insert(modelCalls).values({ ...base, route: "cache", status: "cached" });
        return { data: parsed.data, cached: true, model, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      }
    }
  }

  try {
    await assertQuota();
  } catch (err) {
    if (err instanceof QuotaError) {
      await db().insert(modelCalls).values({ ...base, route: "none", status: "blocked_quota", error: err.message });
    }
    throw err;
  }
  if (!integrations().model) throw new ModelError("Model key not configured", false);

  const start = new Date();
  let raw: Raw;
  try {
    raw = await transport(model, spec.system, spec.user, z.toJSONSchema(spec.schema), spec.ctx.traceId ?? null, {
      application_id: spec.ctx.applicationId, step: spec.ctx.step, prompt: `${spec.promptKey}@${spec.promptVersion}`, env: e.APP_ENV,
    });
  } catch (err) {
    const me = err instanceof ModelError ? err : new ModelError(String(err), true);
    const end = new Date();
    await db().insert(modelCalls).values({
      ...base, route: e.PORTKEY_API_KEY ? "portkey" : "direct", status: "error", latencyMs: end.getTime() - start.getTime(),
      retries: (me as ModelError & { retries?: number }).retries ?? 0, error: me.message.slice(0, 300),
    });
    if (spec.ctx.traceId) {
      await logGeneration({
        traceId: spec.ctx.traceId, name: spec.promptKey, model, start, end, inputTokens: 0, outputTokens: 0, costUsd: null,
        promptKey: spec.promptKey, promptVersion: spec.promptVersion, retries: 0, error: me.message, applicationId: spec.ctx.applicationId,
        route: e.PORTKEY_API_KEY ? "portkey" : "direct",
      });
    }
    throw me;
  }
  const end = new Date();
  const est = estimateCost(model, raw.inputTokens, raw.outputTokens);
  // BYOK routes report cost 0 (billed by Google directly) — treat 0 with tokens as unknown and estimate.
  const providerCost = raw.costUsd != null && (raw.costUsd > 0 || raw.inputTokens + raw.outputTokens === 0) ? raw.costUsd : null;
  const cost = providerCost ?? est ?? 0;
  const costSource = providerCost != null ? "provider" : est != null ? "estimate" : "none";

  let data: z.infer<T>;
  let status: "ok" | "invalid_output" = "ok";
  let error: string | null = null;
  try {
    const parsed = spec.schema.safeParse(parseJson(raw.content));
    if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    data = parsed.data;
  } catch (err) {
    status = "invalid_output";
    error = `Invalid model output: ${err instanceof Error ? err.message : "parse error"}`.slice(0, 300);
  }

  await db().insert(modelCalls).values({
    ...base, route: raw.route, status, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
    costUsd: cost.toFixed(6), costSource, latencyMs: end.getTime() - start.getTime(), retries: raw.retries, error,
  });
  if (spec.ctx.traceId) {
    await logGeneration({
      traceId: spec.ctx.traceId, name: spec.promptKey, model, start, end, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
      costUsd: cost, promptKey: spec.promptKey, promptVersion: spec.promptVersion, retries: raw.retries, error,
      applicationId: spec.ctx.applicationId, route: raw.route, input: spec.user, output: raw.content,
    });
  }
  if (status !== "ok") throw new ModelError(error!, true);

  if (spec.cache !== false) {
    await db().insert(modelCache).values({ cacheKey, promptKey: spec.promptKey, promptVersion: spec.promptVersion, model, response: data! as object })
      .onConflictDoNothing();
  }
  return { data: data!, cached: false, model, costUsd: cost, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens };
}
