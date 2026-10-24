"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGate, INSTITUTE_NAV, Shell } from "@/components/shell";
import { useApi } from "@/lib/hooks";

export default function InstituteLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const brand = useApi<{ name: string; logoUrl: string | null }>(`/public/institutes/${slug}`).data;
  return (
    <AuthGate require="institute">
      {(me) => (
        <Shell me={me} nav={INSTITUTE_NAV} title={brand?.name ?? me.institute!.name} logoUrl={brand?.logoUrl}>
          {me.institute!.status === "PAST_DUE" && me.roles.includes("INSTITUTE_ADMIN") && (
            <div role="alert" className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Your subscription renewal didn&apos;t go through. Please update your payment method in Razorpay to avoid interruption.
            </div>
          )}
          {children}
        </Shell>
      )}
    </AuthGate>
  );
}
