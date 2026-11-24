import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users, ROLES } from "@/db/schema";
import { deactivateUserAction, userAction } from "@/app/actions";
import { ActionForm, inputCls, Submit } from "@/components/td/action-form";
import { PageHeader, Panel, Pill, Table } from "@/components/td/ui";
import { can, PERMISSIONS, ROLE_LABEL } from "@/lib/authz";
import { env, integrations } from "@/lib/env";
import { currentUser } from "@/lib/session";

export default async function Settings() {
  await connection();
  const u = await currentUser();
  const e = env();
  const i = integrations();
  const team = await db().select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users).orderBy(asc(users.name));
  const manage = !!u && can(u.role, "manage_users");
  const config: [string, string][] = [
    ["Environment", e.APP_ENV], ["Data mode", e.DATA_MODE], ["Email mode", e.EMAIL_MODE],
    ["Primary model", e.GEMINI_MODEL_PRIMARY], ["Fast model", e.GEMINI_MODEL_FAST], ["Judge model", e.GEMINI_MODEL_JUDGE],
    ["Provider data collection", e.OPENROUTER_DATA_COLLECTION], ["Daily / monthly spend cap", `$${e.DAILY_SPEND_CAP_USD} / $${e.MONTHLY_SPEND_CAP_USD}`],
    ["Model calls per day / minute", `${e.DAILY_MODEL_CALL_CAP} / ${e.MODEL_RPM_CAP}`], ["Screening rate", `${e.SCREEN_PER_MINUTE}/min · concurrency ${e.WORKER_CONCURRENCY}`],
    ["Follow-ups", `days ${e.FOLLOWUP_DAYS} · max ${e.FOLLOWUP_MAX}`], ["Tavily", `${e.TAVILY_CREDITS_PER_APPLICATION} credits/app · ${e.TAVILY_MONTHLY_CREDIT_CAP}/month`],
  ];
  return (
    <>
      <PageHeader kicker="Admin" title="Settings" description="Configuration is read from environment variables on the server; secrets are never displayed. Changing a value means updating it in Vercel and redeploying, so every change is deliberate and logged." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Team & roles">
          <Table head={["Name", "Email", "Role", "Status", ""]}>
            {team.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-1.5 font-medium">{t.name}</td><td className="px-3 py-1.5 text-xs">{t.email}</td>
                <td className="px-3 py-1.5">{ROLE_LABEL[t.role]}</td><td className="px-3 py-1.5"><Pill tone={t.active ? "ok" : "muted"}>{t.active ? "active" : "disabled"}</Pill></td>
                <td className="px-3 py-1.5">{manage && t.id !== u?.id && <ActionForm action={deactivateUserAction} hidden={{ id: t.id, active: String(!t.active) }}><Submit variant="outline">{t.active ? "Disable" : "Enable"}</Submit></ActionForm>}</td>
              </tr>
            ))}
          </Table>
          {manage && (
            <ActionForm action={userAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input name="name" required placeholder="Name" className={inputCls} />
              <input name="email" type="email" required placeholder="Email" className={inputCls} />
              <select name="role" className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              <input name="password" type="password" required minLength={12} placeholder="Initial password (12+ chars)" className={inputCls} />
              <Submit variant="outline">Add team member</Submit>
            </ActionForm>
          )}
        </Panel>
        <Panel title="Configuration">
          <ul className="space-y-1.5 text-[13px]">{config.map(([k, v]) => <li key={k} className="flex justify-between gap-3 border-b border-dashed pb-1"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></li>)}</ul>
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Integrations</p>
          <div className="flex flex-wrap gap-1.5">{Object.entries(i).map(([k, v]) => <Pill key={k} tone={v ? "ok" : "bad"}>{k}</Pill>)}</div>
        </Panel>
      </div>
      <Panel title="Permission matrix" subtitle="Enforced on the server for every action" className="mt-4">
        <Table head={["Action", ...ROLES.map((r) => ROLE_LABEL[r])]}>
          {Object.entries(PERMISSIONS).map(([p, roles]) => <tr key={p}><td className="px-3 py-1 font-mono text-[11px]">{p}</td>{ROLES.map((r) => <td key={r} className="px-3 py-1 text-center">{(roles as readonly string[]).includes(r) ? "✓" : ""}</td>)}</tr>)}
        </Table>
      </Panel>
    </>
  );
}
