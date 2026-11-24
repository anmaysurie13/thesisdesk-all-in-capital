import { Suspense } from "react";
import { MobileNav, Nav } from "@/components/td/nav";
import { TopBar } from "@/components/td/topbar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-3 py-5 md:flex">
        <div className="mb-7 px-3">
          <p className="font-[family-name:var(--font-display)] text-[21px] leading-none text-[#f5f3ec]">
            Thesis<span className="text-[var(--gold)]">Desk</span>
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-sidebar-foreground/60">All In Capital</p>
        </div>
        <Suspense fallback={<div className="h-80" />}><Nav /></Suspense>
        <p className="mt-auto px-3 text-[11px] leading-relaxed text-sidebar-foreground/55">AI recommends.<br />Riya reviews. Kushal decides.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-14 border-b" />}>
          <TopBar />
        </Suspense>
        <Suspense fallback={null}><MobileNav /></Suspense>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 md:px-8">
          <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/60" />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
