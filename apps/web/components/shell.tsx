"use client";

import {
  Award, BarChart3, BookOpen, CalendarCheck, GraduationCap, Home, IndianRupee, Landmark, LogOut, Menu, Receipt, Settings, Users, X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { type Me, type Role, useMe } from "@/lib/hooks";
import { Button, Spinner } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[]; // omitted = everyone
}

export const INSTITUTE_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/students", label: "Students", icon: GraduationCap, roles: ["INSTITUTE_ADMIN", "ACCOUNTANT", "TEACHER"] },
  { href: "/teachers", label: "Teachers", icon: Users, roles: ["INSTITUTE_ADMIN"] },
  { href: "/courses", label: "Courses", icon: BookOpen, roles: ["INSTITUTE_ADMIN", "TEACHER"] },
  { href: "/batches", label: "Batches & attendance", icon: CalendarCheck, roles: ["INSTITUTE_ADMIN", "TEACHER"] },
  { href: "/fees", label: "Fees", icon: IndianRupee, roles: ["INSTITUTE_ADMIN", "ACCOUNTANT"] },
  { href: "/accounts", label: "Accounts", icon: BarChart3, roles: ["INSTITUTE_ADMIN", "ACCOUNTANT"] },
  { href: "/certificates", label: "Certificates", icon: Award, roles: ["INSTITUTE_ADMIN"] },
  { href: "/my/fees", label: "My fees", icon: Receipt, roles: ["STUDENT"] },
  { href: "/my/certificates", label: "My certificates", icon: Award, roles: ["STUDENT"] },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const PLATFORM_NAV: NavItem[] = [
  { href: "/admin", label: "Institutes", icon: Landmark },
  { href: "/admin/plans", label: "Plans", icon: Receipt },
  { href: "/admin/payments", label: "Payments", icon: IndianRupee },
];

/** Signs out, clearing cookies on this host, then goes to the login page. */
export async function signOut() {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.href = "/login";
}

/**
 * Loads the session and sends visitors without one to the login page. Rendering the page
 * is only a convenience: every request is still authorised by the API.
 */
export function AuthGate({ children, require }: { children: (me: Me) => ReactNode; require?: "platform" | "institute" }) {
  const { data: me, error, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);
  if (isLoading || !me) return error && !(error instanceof ApiError && error.status === 401) ? <div className="p-8">Could not load your session.</div> : <Spinner />;
  if (require === "platform" && !me.isPlatformAdmin) return <Forbidden />;
  if (require === "institute" && !me.institute) return <Forbidden />;
  return <>{children(me)}</>;
}

function Forbidden() {
  return (
    <div className="mx-auto max-w-md p-12 text-center">
      <p className="font-medium">You don&apos;t have access to this page.</p>
      <Button className="mt-4" variant="secondary" onClick={signOut}>
        Sign in as someone else
      </Button>
    </div>
  );
}

export function Shell({ me, nav, title, logoUrl, children }: { me: Me; nav: NavItem[]; title: string; logoUrl?: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const items = nav.filter((n) => !n.roles || n.roles.some((r) => me.roles.includes(r)));
  const active = (href: string) => (href === "/" || href === "/admin" ? pathname === href : pathname.startsWith(href));
  const roleLabel = me.isPlatformAdmin ? "Platform admin" : me.roles.map((r) => r.replace("INSTITUTE_", "").toLowerCase()).join(", ");

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex items-center gap-3 px-5 py-5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-9 rounded-md object-contain" />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-md bg-brand-600 font-semibold text-white">{title.slice(0, 1)}</div>
        )}
        <span className="truncate font-semibold">{title}</span>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {items.map((n) => (
          <li key={n.href}>
            <Link
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                active(n.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-sm font-medium">{me.user.name}</p>
        <p className="truncate text-xs capitalize text-slate-500">{roleLabel}</p>
        <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={signOut}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button className="absolute right-3 top-4 rounded p-1 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded p-1 hover:bg-slate-100" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <span className="font-semibold">{title}</span>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
