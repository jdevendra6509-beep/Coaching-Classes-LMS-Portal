import { Suspense } from "react";
import { AuthCard, SetPasswordForm } from "@/components/auth";
import { BrandMark, getBranding } from "@/components/branding";

export default async function AcceptInvite({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await getBranding((await params).slug);
  return (
    <AuthCard title={`Welcome to ${brand?.name ?? "your institute"}`} subtitle="Choose a password to activate your account." logo={<BrandMark brand={brand} />}>
      <Suspense>
        <SetPasswordForm endpoint="/auth/invite/accept" cta="Activate my account" />
      </Suspense>
    </AuthCard>
  );
}
