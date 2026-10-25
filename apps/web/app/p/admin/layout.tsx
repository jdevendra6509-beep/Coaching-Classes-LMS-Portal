"use client";

import type { ReactNode } from "react";
import { AuthGate, PLATFORM_NAV, Shell } from "@/components/shell";

export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate require="platform">
      {(me) => (
        <Shell me={me} nav={PLATFORM_NAV} title="Platform console">
          {children}
        </Shell>
      )}
    </AuthGate>
  );
}
