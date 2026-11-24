"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputCls } from "./action-form";

type Result = { status: string; ref?: string | null; reason?: string };

export function IntakeForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "batch" | "csv">("single");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (mode === "batch") fd.set("mode", "batch");
    try {
      const res = await fetch("/api/v1/applications", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResults(body.results);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div role="tablist" className="mb-4 inline-flex rounded-lg bg-muted p-1 text-[13px]">
        {(["single", "batch", "csv"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 ${mode === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>
            {m === "single" ? "Single application" : m === "batch" ? "Batch of PDFs" : "CSV batch"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === "single" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="companyName" required placeholder="Company name *" className={inputCls} />
              <input name="website" placeholder="Public website" className={inputCls} />
              <select name="sector" className={inputCls} defaultValue=""><option value="">Sector…</option>{["Fintech", "Deeptech", "Consumer tech", "Consumer brands", "Commerce infrastructure", "Other"].map((s) => <option key={s}>{s}</option>)}</select>
              <select name="stage" className={inputCls} defaultValue=""><option value="">Stage…</option>{["Pre-seed", "Seed", "Series A"].map((s) => <option key={s}>{s}</option>)}</select>
              <input name="city" placeholder="City" className={inputCls} />
              <select name="founderType" className={inputCls} defaultValue=""><option value="">Founder type…</option>{["software", "hardware", "services"].map((s) => <option key={s}>{s}</option>)}</select>
              <input name="founderName" placeholder="Founder name (kept private)" className={inputCls} />
              <input name="founderEmail" type="email" placeholder="Founder email (kept private)" className={inputCls} />
            </div>
            <textarea name="summary" rows={3} placeholder="Application summary / form answers (optional if a deck is attached)" className={inputCls} />
            <input name="files" type="file" multiple accept="application/pdf" className="block text-[13px]" aria-label="Deck and form PDFs" />
          </>
        )}
        {mode === "batch" && (
          <>
            <p className="text-[13px] text-muted-foreground">Drop a week of decks and forms. Files are grouped per company by filename (e.g. <code>Acme_Deck.pdf</code> + <code>Acme_Form.pdf</code>). Up to 60 files.</p>
            <input name="files" type="file" multiple required accept="application/pdf" className="block text-[13px]" aria-label="Batch PDFs" />
          </>
        )}
        {mode === "csv" && (
          <>
            <p className="text-[13px] text-muted-foreground">Columns: <code>companyName, sector, stage, city, website, founderType, summary, founder_name, founder_email</code>. Up to 60 rows.</p>
            <input name="csv" type="file" required accept=".csv,text/csv" className="block text-[13px]" aria-label="CSV file" />
          </>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <select name="dataClass" defaultValue="case_study" className="rounded border bg-card px-1 py-0.5"><option value="case_study">MESA case data</option><option value="synthetic">Synthetic test data</option><option value="real">Real founder data</option></select>
          Real founder data is refused while the data mode is “case study only”.
        </label>
        <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50">{busy ? "Uploading…" : "Submit to the queue"}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p>}
      {results && (
        <ul className="mt-4 space-y-1 text-[13px]" aria-live="polite">
          {results.map((r, i) => (
            <li key={i}><span className="font-mono text-xs">{r.ref ?? "—"}</span> · <b>{r.status}</b>{r.reason ? ` — ${r.reason}` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
