import { Suspense } from "react";
import { AuthCard, LoginForm } from "@/components/auth";

export const metadata = { title: "Platform sign in" };

export default function PlatformLogin() {
  return (
    <AuthCard title="Platform sign in" subtitle="For the platform team. Institutes sign in at their own address.">
      <Suspense>
        <LoginForm home="/admin" />
      </Suspense>
    </AuthCard>
  );
}
