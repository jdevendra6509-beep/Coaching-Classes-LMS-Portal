import { Suspense } from "react";
import { AuthCard, SetPasswordForm } from "@/components/auth";

export default function Reset() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense>
        <SetPasswordForm endpoint="/auth/password/reset" cta="Set password" />
      </Suspense>
    </AuthCard>
  );
}
