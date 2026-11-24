CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"env" text NOT NULL,
	"source" text NOT NULL,
	"data_class" text DEFAULT 'case_study' NOT NULL,
	"company_name" text NOT NULL,
	"company_key" text NOT NULL,
	"website" text,
	"sector" text,
	"stage" text,
	"city" text,
	"founder_type" text,
	"status" text DEFAULT 'received' NOT NULL,
	"status_reason" text,
	"content_hash" text NOT NULL,
	"duplicate_of" uuid,
	"as_of_date" date,
	"batch_id" text,
	"thesis_version_id" uuid,
	"weighted_score" real,
	"confidence" real,
	"recommendation" text,
	"recommendation_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_technical_review" boolean DEFAULT false NOT NULL,
	"final_outcome" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scored_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"allowed" boolean DEFAULT true NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"row_ref" text NOT NULL,
	"company" text NOT NULL,
	"as_of" date NOT NULL,
	"application_id" uuid,
	"actual_outcome" text NOT NULL,
	"predicted" text,
	"weighted_score" real,
	"agreed" boolean,
	"adjudication" text DEFAULT 'pending' NOT NULL,
	"adjudication_note" text
);
--> statement-breakpoint
CREATE TABLE "backtest_rows" (
	"row_ref" text PRIMARY KEY NOT NULL,
	"as_of" date NOT NULL,
	"company" text NOT NULL,
	"sector" text,
	"stage" text,
	"city" text,
	"founder_type" text,
	"summary" text NOT NULL,
	"actual_outcome" text NOT NULL,
	"split" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_version_id" uuid NOT NULL,
	"split" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"summary" text NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"text" text NOT NULL,
	"metric" text,
	"value" text,
	"source_document_id" uuid,
	"source_locator" text,
	"verification" text DEFAULT 'unverified' NOT NULL,
	"verification_note" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"portfolio_company" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"application_id" uuid,
	"criterion_key" text,
	"sector" text,
	"stage" text,
	"topic" text,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lesson" text NOT NULL,
	"author_id" uuid,
	"author_label" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"approved_by" uuid,
	"supersedes_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"provenance" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"criterion_key" text NOT NULL,
	"score" integer,
	"weight" real NOT NULL,
	"reasoning" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_info" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"invalid_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thesis_version_id" uuid,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"ai_recommendation" text,
	"note" text,
	"review_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea",
	"sha256" text NOT NULL,
	"pages" integer,
	"raw_text" text,
	"redacted_text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body_draft" text,
	"body_final" text,
	"status" text NOT NULL,
	"mode" text,
	"to_address" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"resend_id" text,
	"message_id" text,
	"in_reply_to" text,
	"idempotency_key" text,
	"intent" text,
	"intent_confidence" real,
	"intent_source" text,
	"prompt_version" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"check_no" integer NOT NULL,
	"case_id" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"assertion_type" text NOT NULL,
	"passed" boolean NOT NULL,
	"expected" text NOT NULL,
	"actual" text NOT NULL,
	"diagnosis" text
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"judge_model" text,
	"git_sha" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"release_blocked" boolean,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"source_type" text NOT NULL,
	"url" text,
	"title" text,
	"published_at" date,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"excerpt" text NOT NULL,
	"identity_match" text DEFAULT 'n/a' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"injection_suspected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"founder_code" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"linkedin" text,
	"background" text
);
--> statement-breakpoint
CREATE TABLE "job_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"application_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"step" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"run_id" text NOT NULL,
	"env" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"thread_id" uuid,
	"calendly_event_uri" text,
	"invitee_uri" text,
	"status" text NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"confirmed_via" text,
	"counter_proposals" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_calendly_event_uri_unique" UNIQUE("calendly_event_uri")
);
--> statement-breakpoint
CREATE TABLE "memo_passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memo_company" text NOT NULL,
	"decision" text NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_file" text NOT NULL,
	"memo_date" date
);
--> statement-breakpoint
CREATE TABLE "model_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"prompt_key" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"env" text NOT NULL,
	"application_id" uuid,
	"job_id" uuid,
	"run_id" text,
	"step" text NOT NULL,
	"prompt_key" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"route" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cost_source" text DEFAULT 'none' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"cache_key" text,
	"trace_id" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "outreach_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"founder_id" uuid,
	"status" text DEFAULT 'drafting' NOT NULL,
	"stop_reason" text,
	"followups_sent" integer DEFAULT 0 NOT NULL,
	"next_followup_at" timestamp with time zone,
	"last_message_id" text,
	"references" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_threads_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "portfolio_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sector" text,
	"description" text,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text,
	"source_note" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "research_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"application_id" uuid,
	"provider" text NOT NULL,
	"credits" integer NOT NULL,
	"query" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_timings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"seconds" integer
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sectors" jsonb NOT NULL,
	"stages" jsonb NOT NULL,
	"criteria" jsonb NOT NULL,
	"exclusions" jsonb NOT NULL,
	"go_min" real NOT NULL,
	"pass_max" real NOT NULL,
	"min_scored_criteria" integer NOT NULL,
	"statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_note" text NOT NULL,
	"parent_id" uuid,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"backtest_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thesis_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_run_id_backtest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_thread_id_outreach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."outreach_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD CONSTRAINT "outreach_threads_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_hash_env_uq" ON "applications" USING btree ("env","content_hash") WHERE "applications"."duplicate_of" is null;--> statement-breakpoint
CREATE INDEX "app_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_company_idx" ON "applications" USING btree ("company_key");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "bt_row_uq" ON "backtest_results" USING btree ("run_id","row_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_key_uq" ON "claims" USING btree ("application_id","claim_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conflict_uq" ON "conflicts" USING btree ("application_id","portfolio_company");--> statement-breakpoint
CREATE INDEX "corr_lookup_idx" ON "corrections" USING btree ("kind","status","sector");--> statement-breakpoint
CREATE INDEX "cs_app_idx" ON "criterion_scores" USING btree ("application_id","run_id");--> statement-breakpoint
CREATE INDEX "dec_app_idx" ON "decisions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "email_thread_idx" ON "emails" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_ref_uq" ON "evidence" USING btree ("application_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_code_uq" ON "founders" USING btree ("application_id","founder_code");--> statement-breakpoint
CREATE UNIQUE INDEX "job_step_uq" ON "job_steps" USING btree ("job_id","step");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_meeting_per_app" ON "meetings" USING btree ("application_id") WHERE "meetings"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "mc_at_idx" ON "model_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "mc_app_idx" ON "model_calls" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_uq" ON "webhook_events" USING btree ("provider","event_id");