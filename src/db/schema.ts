import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, numeric, bigserial, date,
  uniqueIndex, index, customType, real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const ts = () => timestamp({ withTimezone: true });

/* ---------------- People, roles, audit ---------------- */

export const ROLES = ["associate", "partner", "technical_partner", "analyst", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  role: text().$type<Role>().notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean().notNull().default(true),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: now(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial({ mode: "number" }).primaryKey(),
  at: now(),
  actorId: uuid("actor_id"),
  actorRole: text("actor_role"),
  action: text().notNull(),
  entity: text().notNull(),
  entityId: text("entity_id"),
  allowed: boolean().notNull().default(true),
  detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_at_idx").on(t.at)]);

/* ---------------- Applications & documents ---------------- */

export const APP_STATUSES = [
  "received", "queued", "processing", "needs_attention", "paused", "duplicate", "invalid",
  "awaiting_review", "awaiting_technical", "awaiting_partner", "decided",
] as const;
export type AppStatus = (typeof APP_STATUSES)[number];
export const OUTCOMES = ["GO", "PASS", "HOLD", "REQUEST_INFO"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const applications = pgTable("applications", {
  id: uuid().primaryKey().defaultRandom(),
  ref: text().notNull().unique(),
  env: text().$type<"test" | "live">().notNull(),
  source: text().$type<"form" | "batch" | "backtest" | "volume_test" | "eval" | "seed">().notNull(),
  dataClass: text("data_class").$type<"case_study" | "synthetic" | "real">().notNull().default("case_study"),
  companyName: text("company_name").notNull(),
  companyKey: text("company_key").notNull(),
  website: text(),
  sector: text(),
  stage: text(),
  city: text(),
  founderType: text("founder_type"),
  status: text().$type<AppStatus>().notNull().default("received"),
  statusReason: text("status_reason"),
  contentHash: text("content_hash").notNull(),
  duplicateOf: uuid("duplicate_of"),
  asOfDate: date("as_of_date"),
  batchId: text("batch_id"),
  thesisVersionId: uuid("thesis_version_id"),
  weightedScore: real("weighted_score"),
  confidence: real(),
  recommendation: text().$type<Outcome>(),
  recommendationReasons: jsonb("recommendation_reasons").$type<string[]>().notNull().default([]),
  flags: jsonb().$type<string[]>().notNull().default([]),
  needsTechnicalReview: boolean("needs_technical_review").notNull().default(false),
  finalOutcome: text("final_outcome").$type<Outcome>(),
  submittedAt: now(),
  scoredAt: ts(),
  decidedAt: ts(),
  updatedAt: now(),
}, (t) => [
  uniqueIndex("app_hash_env_uq").on(t.env, t.contentHash).where(sql`${t.duplicateOf} is null`),
  index("app_status_idx").on(t.status),
  index("app_company_idx").on(t.companyKey),
]);

/** PII lives here only. Never joined into a model prompt; prompts see founder_code. */
export const founders = pgTable("founders", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  founderCode: text("founder_code").notNull(),
  name: text(),
  email: text(),
  phone: text(),
  linkedin: text(),
  background: text(),
}, (t) => [uniqueIndex("founder_code_uq").on(t.applicationId, t.founderCode)]);

export const documents = pgTable("documents", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  kind: text().$type<"deck" | "form" | "attachment" | "summary">().notNull(),
  filename: text().notNull(),
  mime: text().notNull(),
  bytes: bytea(),
  sha256: text().notNull(),
  pages: integer(),
  rawText: text("raw_text"),
  redactedText: text("redacted_text"),
  status: text().$type<"pending" | "ok" | "empty" | "corrupt" | "unsupported">().notNull().default("pending"),
  error: text(),
  createdAt: now(),
});

/* ---------------- Evidence ledger ---------------- */

export const claims = pgTable("claims", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  claimKey: text("claim_key").notNull(),
  text: text().notNull(),
  metric: text(),
  value: text(),
  sourceDocumentId: uuid("source_document_id"),
  sourceLocator: text("source_locator"),
  verification: text().$type<"unverified" | "verified" | "contradicted" | "unverifiable">().notNull().default("unverified"),
  verificationNote: text("verification_note"),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
}, (t) => [uniqueIndex("claim_key_uq").on(t.applicationId, t.claimKey)]);

export const evidence = pgTable("evidence", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  ref: text().notNull(), // E1, E2 … stable ids the model must cite
  sourceType: text("source_type").$type<"deck" | "form" | "summary" | "web" | "memo" | "portfolio" | "correction">().notNull(),
  url: text(),
  title: text(),
  publishedAt: date("published_at"),
  retrievedAt: now(),
  excerpt: text().notNull(),
  identityMatch: text("identity_match").$type<"match" | "mismatch" | "uncertain" | "n/a">().notNull().default("n/a"),
  stale: boolean().notNull().default(false),
  injectionSuspected: boolean("injection_suspected").notNull().default(false),
}, (t) => [uniqueIndex("evidence_ref_uq").on(t.applicationId, t.ref)]);

export const criterionScores = pgTable("criterion_scores", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  criterionKey: text("criterion_key").notNull(),
  score: integer(), // 1–5, null = insufficient evidence
  weight: real().notNull(),
  reasoning: text().notNull(),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
  missingInfo: jsonb("missing_info").$type<string[]>().notNull().default([]),
  confidence: real().notNull(),
  invalidRefs: jsonb("invalid_refs").$type<string[]>().notNull().default([]),
  thesisVersionId: uuid("thesis_version_id"),
  promptVersion: text("prompt_version").notNull(),
  createdAt: now(),
}, (t) => [index("cs_app_idx").on(t.applicationId, t.runId)]);

export const briefs = pgTable("briefs", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  summary: text().notNull(),
  strengths: jsonb().$type<{ text: string; refs: string[] }[]>().notNull().default([]),
  risks: jsonb().$type<{ text: string; refs: string[] }[]>().notNull().default([]),
  gaps: jsonb().$type<string[]>().notNull().default([]),
  questions: jsonb().$type<string[]>().notNull().default([]),
  promptVersion: text("prompt_version").notNull(),
  model: text().notNull(),
  createdAt: now(),
});

export const portfolioCompanies = pgTable("portfolio_companies", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  sector: text(),
  description: text(),
  keywords: jsonb().$type<string[]>().notNull().default([]),
  sourceUrl: text("source_url"),
  sourceNote: text("source_note").notNull(),
  verified: boolean().notNull().default(false),
  createdAt: now(),
});

export const conflicts = pgTable("conflicts", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  portfolioCompany: text("portfolio_company").notNull(),
  reason: text().notNull(),
  status: text().$type<"open" | "cleared" | "confirmed">().notNull().default("open"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts(),
  note: text(),
}, (t) => [uniqueIndex("conflict_uq").on(t.applicationId, t.portfolioCompany)]);

export const decisions = pgTable("decisions", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  stage: text().$type<"associate_review" | "technical_review" | "partner_signoff">().notNull(),
  actorId: uuid("actor_id").notNull(),
  outcome: text().$type<Outcome>().notNull(),
  aiRecommendation: text("ai_recommendation").$type<Outcome>(),
  note: text(),
  reviewSeconds: integer("review_seconds"),
  createdAt: now(),
}, (t) => [index("dec_app_idx").on(t.applicationId)]);

/* ---------------- Thesis, memory, backtests ---------------- */

export type Criterion = { key: string; label: string; description: string; weight: number; appliesTo?: string[] };
export type Exclusion = { key: string; rule: string; effect: "flag" | "hold"; source: string };
export type Sourced = { text: string; source: string; kind: "stated" | "revealed"; confidence: "high" | "medium" | "low" };

export const thesisVersions = pgTable("thesis_versions", {
  id: uuid().primaryKey().defaultRandom(),
  version: integer().notNull().unique(),
  status: text().$type<"draft" | "approved" | "active" | "retired" | "rejected">().notNull().default("draft"),
  sectors: jsonb().$type<string[]>().notNull(),
  stages: jsonb().$type<string[]>().notNull(),
  criteria: jsonb().$type<Criterion[]>().notNull(),
  exclusions: jsonb().$type<Exclusion[]>().notNull(),
  goMin: real("go_min").notNull(),
  passMax: real("pass_max").notNull(),
  minScoredCriteria: integer("min_scored_criteria").notNull(),
  statements: jsonb().$type<Sourced[]>().notNull().default([]),
  changeNote: text("change_note").notNull(),
  parentId: uuid("parent_id"),
  createdBy: uuid("created_by"),
  approvedBy: uuid("approved_by"),
  approvedAt: ts(),
  activatedAt: ts(),
  backtestRunId: uuid("backtest_run_id"),
  createdAt: now(),
});

export const memoPassages = pgTable("memo_passages", {
  id: uuid().primaryKey().defaultRandom(),
  memoCompany: text("memo_company").notNull(),
  decision: text().$type<"invested" | "passed">().notNull(),
  section: text().notNull(),
  text: text().notNull(),
  tags: jsonb().$type<string[]>().notNull().default([]),
  sourceFile: text("source_file").notNull(),
  memoDate: date("memo_date"),
});

export const corrections = pgTable("corrections", {
  id: uuid().primaryKey().defaultRandom(),
  kind: text().$type<"overturn" | "score" | "email_edit" | "partner_feedback" | "call_outcome">().notNull(),
  applicationId: uuid("application_id"),
  criterionKey: text("criterion_key"),
  sector: text(),
  stage: text(),
  topic: text(),
  before: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  after: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  lesson: text().notNull(),
  authorId: uuid("author_id"),
  authorLabel: text("author_label").notNull(),
  status: text().$type<"proposed" | "approved" | "rejected" | "superseded">().notNull().default("proposed"),
  approvedBy: uuid("approved_by"),
  supersedesId: uuid("supersedes_id"),
  version: integer().notNull().default(1),
  provenance: text().notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: now(),
}, (t) => [index("corr_lookup_idx").on(t.kind, t.status, t.sector)]);

export const backtestRuns = pgTable("backtest_runs", {
  id: uuid().primaryKey().defaultRandom(),
  thesisVersionId: uuid("thesis_version_id").notNull(),
  split: text().$type<"tune" | "sealed" | "all">().notNull(),
  status: text().$type<"running" | "done" | "failed">().notNull().default("running"),
  summary: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  startedAt: now(),
  finishedAt: ts(),
});

export const backtestResults = pgTable("backtest_results", {
  id: uuid().primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => backtestRuns.id, { onDelete: "cascade" }),
  rowRef: text("row_ref").notNull(),
  company: text().notNull(),
  asOf: date("as_of").notNull(),
  applicationId: uuid("application_id"),
  /** Held outside scoring context; joined only for the report. */
  actualOutcome: text("actual_outcome").notNull(),
  predicted: text().$type<Outcome>(),
  weightedScore: real("weighted_score"),
  agreed: boolean(),
  adjudication: text().$type<"pending" | "system_right" | "human_right" | "unclear">().notNull().default("pending"),
  adjudicationNote: text("adjudication_note"),
}, (t) => [uniqueIndex("bt_row_uq").on(t.runId, t.rowRef)]);

export const backtestRows = pgTable("backtest_rows", {
  rowRef: text("row_ref").primaryKey(),
  asOf: date("as_of").notNull(),
  company: text().notNull(),
  sector: text(),
  stage: text(),
  city: text(),
  founderType: text("founder_type"),
  summary: text().notNull(),
  actualOutcome: text("actual_outcome").notNull(),
  split: text().$type<"tune" | "sealed">().notNull(),
  source: text().notNull(),
});

/* ---------------- Outreach & scheduling ---------------- */

export const outreachThreads = pgTable("outreach_threads", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }).unique(),
  founderId: uuid("founder_id"),
  status: text().$type<"drafting" | "awaiting_approval" | "sent" | "replied" | "stopped" | "meeting_link_sent" | "meeting_booked" | "closed">().notNull().default("drafting"),
  stopReason: text("stop_reason"),
  followupsSent: integer("followups_sent").notNull().default(0),
  nextFollowupAt: ts(),
  lastMessageId: text("last_message_id"),
  references: text().notNull().default(""),
  createdAt: now(),
  updatedAt: now(),
});

export const emails = pgTable("emails", {
  id: uuid().primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => outreachThreads.id, { onDelete: "cascade" }),
  direction: text().$type<"out" | "in">().notNull(),
  kind: text().$type<"first" | "follow_up" | "response" | "inbound">().notNull(),
  subject: text().notNull(),
  bodyDraft: text("body_draft"),
  bodyFinal: text("body_final"),
  status: text().$type<"draft" | "approved" | "sending" | "simulated" | "sent" | "delivered" | "bounced" | "failed" | "received" | "discarded">().notNull(),
  mode: text().$type<"simulate" | "test" | "live">(),
  toAddress: text("to_address"),
  approvedBy: uuid("approved_by"),
  approvedAt: ts(),
  sentAt: ts(),
  resendId: text("resend_id"),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  idempotencyKey: text("idempotency_key").unique(),
  intent: text().$type<"interested" | "not_interested" | "needs_info" | "reschedule" | "out_of_office" | "ambiguous" | "bounce">(),
  intentConfidence: real("intent_confidence"),
  intentSource: text("intent_source").$type<"model" | "manual" | "webhook">(),
  promptVersion: text("prompt_version"),
  error: text(),
  createdAt: now(),
}, (t) => [index("email_thread_idx").on(t.threadId)]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid().primaryKey().defaultRandom(),
  provider: text().$type<"resend" | "calendly">().notNull(),
  eventId: text("event_id").notNull(),
  type: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  receivedAt: now(),
  processedAt: ts(),
  error: text(),
}, (t) => [uniqueIndex("webhook_uq").on(t.provider, t.eventId)]);

export const suppressionList = pgTable("suppression_list", {
  emailHash: text("email_hash").primaryKey(),
  reason: text().notNull(),
  createdAt: now(),
});

export const meetings = pgTable("meetings", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id"),
  calendlyEventUri: text("calendly_event_uri").unique(),
  inviteeUri: text("invitee_uri"),
  status: text().$type<"link_sent" | "scheduled" | "canceled" | "rescheduled" | "completed" | "no_show">().notNull(),
  startTime: ts(),
  endTime: ts(),
  confirmedVia: text("confirmed_via").$type<"webhook" | "poll" | "api_booking" | "manual">(),
  counterProposals: integer("counter_proposals").notNull().default(0),
  outcome: text(),
  notes: text(),
  createdAt: now(),
  updatedAt: now(),
}, (t) => [
  uniqueIndex("one_live_meeting_per_app").on(t.applicationId).where(sql`${t.status} = 'scheduled'`),
]);

/* ---------------- Queue, ledger, operations ---------------- */

export const jobs = pgTable("jobs", {
  id: uuid().primaryKey().defaultRandom(),
  kind: text().$type<"screen" | "draft_email" | "classify_reply" | "followup_scan" | "calendly_poll" | "backtest_row">().notNull(),
  applicationId: uuid("application_id"),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: text().$type<"queued" | "running" | "done" | "needs_attention" | "paused" | "canceled">().notNull().default("queued"),
  step: text(),
  attempts: integer().notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: ts(),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  runId: text("run_id").notNull(),
  env: text().$type<"test" | "live">().notNull(),
  createdAt: now(),
  updatedAt: now(),
  startedAt: ts(),
  finishedAt: ts(),
}, (t) => [index("jobs_claim_idx").on(t.status, t.runAfter)]);

export const jobSteps = pgTable("job_steps", {
  id: uuid().primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  step: text().notNull(),
  status: text().$type<"done" | "skipped" | "failed">().notNull(),
  output: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  durationMs: integer("duration_ms").notNull(),
  createdAt: now(),
}, (t) => [uniqueIndex("job_step_uq").on(t.jobId, t.step)]);

export const modelCalls = pgTable("model_calls", {
  id: uuid().primaryKey().defaultRandom(),
  at: now(),
  env: text().notNull(),
  applicationId: uuid("application_id"),
  jobId: uuid("job_id"),
  runId: text("run_id"),
  step: text().notNull(),
  promptKey: text("prompt_key").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text().notNull(),
  route: text().$type<"portkey" | "direct" | "cache" | "none">().notNull(),
  status: text().$type<"ok" | "error" | "cached" | "blocked_quota" | "invalid_output">().notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  costSource: text("cost_source").$type<"provider" | "estimate" | "none">().notNull().default("none"),
  latencyMs: integer("latency_ms").notNull().default(0),
  retries: integer().notNull().default(0),
  cacheKey: text("cache_key"),
  traceId: text("trace_id"),
  error: text(),
}, (t) => [index("mc_at_idx").on(t.at), index("mc_app_idx").on(t.applicationId)]);

export const modelCache = pgTable("model_cache", {
  cacheKey: text("cache_key").primaryKey(),
  promptKey: text("prompt_key").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text().notNull(),
  response: jsonb().$type<unknown>().notNull(),
  hits: integer().notNull().default(0),
  createdAt: now(),
});

export const researchUsage = pgTable("research_usage", {
  id: uuid().primaryKey().defaultRandom(),
  at: now(),
  applicationId: uuid("application_id"),
  provider: text().notNull(),
  credits: integer().notNull(),
  query: text().notNull(),
  status: text().$type<"ok" | "error" | "skipped_budget" | "skipped_unconfigured">().notNull(),
});

export const systemState = pgTable("system_state", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedAt: now(),
});

export const alerts = pgTable("alerts", {
  id: uuid().primaryKey().defaultRandom(),
  at: now(),
  level: text().$type<"info" | "warning" | "critical">().notNull(),
  kind: text().notNull(),
  message: text().notNull(),
  acknowledgedBy: uuid("acknowledged_by"),
  acknowledgedAt: ts(),
});

export const reviewTimings = pgTable("review_timings", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull(),
  userId: uuid("user_id").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: ts(),
  seconds: integer(),
});

/* ---------------- Evaluations ---------------- */

export const evalRuns = pgTable("eval_runs", {
  id: uuid().primaryKey().defaultRandom(),
  kind: text().$type<"checks" | "volume" | "prompt_audit" | "backtest">().notNull(),
  target: text().notNull(),
  judgeModel: text("judge_model"),
  gitSha: text("git_sha"),
  summary: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  releaseBlocked: boolean("release_blocked"),
  startedAt: now(),
  finishedAt: ts(),
});

export const evalResults = pgTable("eval_results", {
  id: uuid().primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => evalRuns.id, { onDelete: "cascade" }),
  checkNo: integer("check_no").notNull(),
  caseId: text("case_id").notNull(),
  category: text().$type<"normal" | "boundary" | "missing" | "adversarial" | "failure">().notNull(),
  severity: text().$type<"critical" | "high" | "low">().notNull(),
  assertionType: text("assertion_type").$type<"hard" | "soft">().notNull(),
  passed: boolean().notNull(),
  expected: text().notNull(),
  actual: text().notNull(),
  diagnosis: text(),
});
