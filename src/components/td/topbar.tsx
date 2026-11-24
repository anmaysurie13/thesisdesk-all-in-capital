import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signOut } from "@/auth";
import { ROLE_LABEL } from "@/lib/authz";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { getPause } from "@/lib/state";
import { Pill } from "./ui";

export async function TopBar() {
  await connection();
  const u = await currentUser();
  if (!u && process.env.OPEN_ACCESS === "false") redirect("/login");
  const e = env();
  const pause = await getPause().catch(() => ({ paused: false, reason: "database unreachable" }));
  return (
    <>
      {pause.paused && (
        <div role="alert" className="bg-destructive px-6 py-2 text-[13px] font-medium text-white">
          System paused — {pause.reason}. Queued work is safe and resumes from System Health.
        </div>
      )}
      <div className="flex h-14 items-center justify-between gap-3 border-b bg-card/70 px-4 backdrop-blur md:px-8">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={e.APP_ENV === "live" ? "bad" : "info"} title="Test and live use separate databases">{e.APP_ENV.toUpperCase()} environment</Pill>
          <Pill tone={e.EMAIL_MODE === "live" ? "bad" : e.EMAIL_MODE === "test" ? "warn" : "muted"} title="Email delivery mode">
            Email: {e.EMAIL_MODE === "simulate" ? "SIMULATION" : e.EMAIL_MODE === "test" ? "TEST INBOX ONLY" : "LIVE"}
          </Pill>
          <Pill tone="muted" title="Founder-data policy">Data: {e.DATA_MODE === "case_study" ? "case study only" : "real"}</Pill>
        </div>
        {u ? (
          <div className="flex items-center gap-3 text-[13px]">
            <div className="text-right leading-tight">
              <p className="font-medium text-primary">{u.name}</p>
              <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[u.role]}</p>
            </div>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
              <button className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">Sign out</button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px]">
            <Pill tone="muted" title="Viewing is open; decisions, sends and approvals need a signed-in role">Viewing as guest · read-only</Pill>
            <a href="/login" className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">Team sign-in</a>
          </div>
        )}
      </div>
    </>
  );
}
