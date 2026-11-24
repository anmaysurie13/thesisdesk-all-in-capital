// Server-side only: none of these variables are NEXT_PUBLIC_, so they never reach the browser bundle.
import { z } from "zod";

const num = (d: number) => z.coerce.number().default(d);
const opt = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  APP_ENV: z.enum(["test", "live"]).default("test"),
  DATA_MODE: z.enum(["case_study", "real"]).default("case_study"),
  EMAIL_MODE: z.enum(["simulate", "test", "live"]).default("simulate"),
  EMAIL_TEST_ALLOWLIST: opt,
  APP_URL: opt,

  DATABASE_URL: opt,
  DATABASE_URL_TEST: opt,
  AUTH_SECRET: opt,
  WORKER_SECRET: opt,
  CRON_SECRET: opt,
  EVAL_TOKEN: opt,

  OPENROUTER_API_KEY: opt,
  PORTKEY_API_KEY: opt,
  PORTKEY_PROVIDER: z.string().default("openrouter"),
  GEMINI_MODEL_PRIMARY: z.string().default("google/gemini-3.8-flash"),
  GEMINI_MODEL_FAST: z.string().default("google/gemini-3.1-flash-lite"),
  GEMINI_MODEL_JUDGE: z.string().default("google/gemini-3.6-flash"),
  OPENROUTER_DATA_COLLECTION: z.enum(["deny", "allow"]).default("deny"),
  DAILY_SPEND_CAP_USD: num(1),
  MONTHLY_SPEND_CAP_USD: num(15),
  DAILY_MODEL_CALL_CAP: num(800),
  MODEL_RPM_CAP: num(30),
  SCREEN_PER_MINUTE: num(5),
  WORKER_CONCURRENCY: num(3),

  LANGFUSE_PUBLIC_KEY: opt,
  LANGFUSE_SECRET_KEY: opt,
  LANGFUSE_BASE_URL: opt,
  LANGFUSE_HOST: opt,
  LANGFUSE_LOG_BODIES: z.enum(["true", "false"]).default("false"),

  TAVILY_API_KEY: opt,
  TAVILY_MONTHLY_CREDIT_CAP: num(900),
  TAVILY_CREDITS_PER_APPLICATION: num(4),

  RESEND_API_KEY: opt,
  RESEND_FROM: opt,
  RESEND_INBOUND_ADDRESS: opt,
  RESEND_WEBHOOK_SECRET: opt,

  CALENDLY_PAT: opt,
  CALENDLY_EVENT_TYPE_URI: opt,
  CALENDLY_SCHEDULING_URL: opt,
  CALENDLY_WEBHOOK_SIGNING_KEY: opt,

  FOLLOWUP_DAYS: z.string().default("3,7"),
  FOLLOWUP_MAX: num(2),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
/** Tests only. */
export function resetEnvCache() {
  cached = null;
}

export function integrations() {
  const e = env();
  return {
    database: !!(e.APP_ENV === "test" ? e.DATABASE_URL_TEST ?? e.DATABASE_URL : e.DATABASE_URL),
    model: !!e.OPENROUTER_API_KEY,
    portkey: !!e.PORTKEY_API_KEY,
    langfuse: !!(e.LANGFUSE_PUBLIC_KEY && e.LANGFUSE_SECRET_KEY),
    tavily: !!e.TAVILY_API_KEY,
    resend: !!e.RESEND_API_KEY,
    resendDomain: !!e.RESEND_FROM && !/resend\.dev/i.test(e.RESEND_FROM ?? ""),
    resendWebhook: !!e.RESEND_WEBHOOK_SECRET,
    calendly: !!(e.CALENDLY_PAT && e.CALENDLY_EVENT_TYPE_URI),
    calendlyWebhook: !!e.CALENDLY_WEBHOOK_SIGNING_KEY,
    worker: !!e.WORKER_SECRET,
  };
}

export const langfuseBaseUrl = () => env().LANGFUSE_BASE_URL ?? env().LANGFUSE_HOST ?? "https://cloud.langfuse.com";
export const followupDays = () => env().FOLLOWUP_DAYS.split(",").map((d) => Number(d.trim())).filter((d) => d > 0);
