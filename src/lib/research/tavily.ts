import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { researchUsage } from "@/db/schema";
import { env } from "@/lib/env";
import { istStart } from "@/lib/ai/quota";

export type WebHit = { url: string; title: string; snippet: string; publishedAt: string | null };

/**
 * External research with a hard credit budget (free plan: 1,000 credits/month).
 * Only PUBLIC identifiers are sent (company name, city, sector, public website). Never deck contents.
 * Results are short snippets (extracted claims), never whole pages.
 */
export async function research(applicationId: string, q: { company: string; city?: string | null; sector?: string | null; website?: string | null }) {
  const e = env();
  const queries = [
    `"${q.company}" startup ${q.city ?? ""} ${q.sector ?? ""}`.trim(),
    `"${q.company}" founders funding OR revenue OR customers`,
    q.website ? `site:${q.website.replace(/^https?:\/\//, "").split("/")[0]}` : `"${q.company}" news`,
  ].slice(0, Math.max(0, e.TAVILY_CREDITS_PER_APPLICATION));

  if (!e.TAVILY_API_KEY) {
    await db().insert(researchUsage).values({ applicationId, provider: "tavily", credits: 0, query: "(not configured)", status: "skipped_unconfigured" });
    return { hits: [] as WebHit[], note: "External research skipped: Tavily is not configured. Claims stay unverified." };
  }
  const [{ used }] = await db().select({ used: sql<number>`coalesce(sum(${researchUsage.credits}),0)`.mapWith(Number) })
    .from(researchUsage).where(and(eq(researchUsage.provider, "tavily"), gte(researchUsage.at, istStart("month"))));
  if (used + queries.length > e.TAVILY_MONTHLY_CREDIT_CAP) {
    await db().insert(researchUsage).values({ applicationId, provider: "tavily", credits: 0, query: "(budget)", status: "skipped_budget" });
    return { hits: [], note: `External research skipped: monthly Tavily budget reached (${used}/${e.TAVILY_MONTHLY_CREDIT_CAP} credits).` };
  }

  const hits: WebHit[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${e.TAVILY_API_KEY}` },
        body: JSON.stringify({ query, search_depth: "basic", max_results: 4, include_answer: false, include_raw_content: false }),
        signal: AbortSignal.timeout(20_000),
      });
      await db().insert(researchUsage).values({ applicationId, provider: "tavily", credits: 1, query, status: res.ok ? "ok" : "error" });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: { url: string; title: string; content: string; published_date?: string }[] };
      for (const r of data.results ?? []) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        hits.push({ url: r.url, title: r.title.slice(0, 160), snippet: r.content.slice(0, 600), publishedAt: r.published_date?.slice(0, 10) ?? null });
      }
    } catch {
      await db().insert(researchUsage).values({ applicationId, provider: "tavily", credits: 1, query, status: "error" });
    }
  }
  return { hits: hits.slice(0, 10), note: hits.length ? null : "External research found no results for this company." };
}

/** Evidence older than 18 months relative to the decision date cannot verify a current claim. */
export function isStale(publishedAt: string | null, asOf: Date): boolean {
  if (!publishedAt) return false;
  const d = new Date(publishedAt);
  return asOf.getTime() - d.getTime() > 548 * 86400_000;
}

/** Point-in-time guard for backtests: evidence published after the decision date is excluded. */
export function isFuture(publishedAt: string | null, asOf: Date): boolean {
  return !!publishedAt && new Date(publishedAt).getTime() > asOf.getTime();
}
