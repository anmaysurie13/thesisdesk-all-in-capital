"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenCheck, CalendarClock, FlaskConical, Gauge, Inbox, LayoutDashboard, Mail, Settings, Scale, Wallet,
} from "lucide-react";
import { cn } from "cn";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Deal Inbox", icon: Inbox },
  { href: "/review", label: "Partner Review", icon: Scale },
  { href: "/founders", label: "Founder Desk", icon: Mail },
  { href: "/meetings", label: "Meetings", icon: CalendarClock },
  { href: "/thesis", label: "Thesis & Memory", icon: BookOpenCheck },
  { href: "/evals", label: "Evaluations", icon: FlaskConical },
  { href: "/costs", label: "Cost Centre", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/inbox" && path.startsWith("/applications"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className={cn("size-4", active ? "text-sidebar-primary" : "opacity-70")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
      {NAV.map(({ href, label }) => (
        <Link key={href} href={href} className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs", (href === "/" ? path === "/" : path.startsWith(href)) ? "bg-primary text-primary-foreground" : "bg-secondary")}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export { Gauge };
