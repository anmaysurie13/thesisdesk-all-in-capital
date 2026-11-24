import { NextResponse } from "next/server";
import { z } from "zod";
import { callModel } from "@/lib/ai/gateway";
import { ReplyOut, replyPrompt } from "@/lib/ai/prompts";
import { redact } from "@/lib/pii";
import { harnessAuthorized } from "@/lib/session";

/** Harness-only (TEST env): classify a reply exactly as production does, without touching any thread. */
export async function POST(req: Request) {
  if (!harnessAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = z.object({ text: z.string().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "text required" }, { status: 400 });
  const { data } = await callModel({
    promptKey: replyPrompt.key, promptVersion: replyPrompt.version, tier: "fast", system: replyPrompt.system,
    user: replyPrompt.user(redact(b.data.text)), schema: ReplyOut, ctx: { step: "eval.reply.classify" },
  });
  return NextResponse.json({ intent: data.confidence < 0.7 ? "ambiguous" : data.intent, raw: data });
}
