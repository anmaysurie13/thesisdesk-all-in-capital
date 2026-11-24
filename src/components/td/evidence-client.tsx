"use client";

import { useEffect, useRef, useState } from "react";
import { reviewTimerAction } from "@/app/actions";

export function DocViewer({ docs }: { docs: { id: string; label: string; text: string; status: string; error: string | null }[] }) {
  const [active, setActive] = useState(0);
  const d = docs[active];
  if (!docs.length) return <p className="text-[13px] text-muted-foreground">No documents.</p>;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap gap-1">
        {docs.map((x, i) => (
          <button key={x.id} onClick={() => setActive(i)} className={`rounded-md px-2.5 py-1 text-xs ${i === active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{x.label}</button>
        ))}
      </div>
      {d.status !== "ok" && <p className="mb-2 rounded bg-[#f4dcd8] px-2 py-1 text-xs text-[#7c2a21]">{d.status}: {d.error ?? "not readable"}</p>}
      <pre className="max-h-[70vh] flex-1 overflow-auto whitespace-pre-wrap rounded-lg border bg-white/70 p-3 font-sans text-[12.5px] leading-relaxed">{d.text || "(no extracted text)"}</pre>
      <p className="mt-1 text-[11px] text-muted-foreground">Shown redacted (founder IDs instead of names/contacts) — exactly what the model saw.</p>
    </div>
  );
}

/** Measures active review time on this page (compared with Riya's 30-minute baseline). */
export function ReviewTimer({ applicationId }: { applicationId: string }) {
  const opened = useRef<Date | null>(null);
  const active = useRef(0);
  const last = useRef(0);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    opened.current = new Date();
    last.current = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible") active.current += (now - last.current) / 1000;
      last.current = now;
      setSecs(Math.round(active.current));
    }, 1000);
    const flush = () => { if (active.current > 5 && opened.current) void reviewTimerAction(applicationId, opened.current.toISOString(), active.current); };
    window.addEventListener("pagehide", flush);
    return () => { clearInterval(tick); window.removeEventListener("pagehide", flush); flush(); };
  }, [applicationId]);
  return (
    <span className="text-xs tabular-nums text-muted-foreground" title="Active time on this page; recorded when you leave">
      review time {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}
