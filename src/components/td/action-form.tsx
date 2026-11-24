"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "cn";
import type { ActionResult } from "@/app/actions";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function ActionForm({ action, children, className, hidden }: { action: Action; children: ReactNode; className?: string; hidden?: Record<string, string> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {state && (
        <p role="status" className={cn("mt-2 text-xs", state.ok ? "text-[var(--sage)]" : "text-destructive")}>
          {state.ok ? state.message ?? "Saved" : state.error}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, variant = "primary", className, name, value }: { children: ReactNode; variant?: "primary" | "outline" | "danger" | "gold"; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border bg-card hover:bg-muted",
    danger: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    gold: "bg-[var(--gold)] text-[var(--forest)] hover:brightness-95",
  }[variant];
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-50", v, className)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export const inputCls = "w-full rounded-lg border bg-white/80 px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring";
