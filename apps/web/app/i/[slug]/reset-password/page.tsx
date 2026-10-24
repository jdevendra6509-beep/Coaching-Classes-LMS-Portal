import { Suspense } from "react";
import { AuthCard, SetPasswordForm } from "@/components/auth";
import { BrandMark, getBranding } from "@/components/branding";

export default async function Reset({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await getBranding((await params).slug);
  return (
    <AuthCard title="Choose a new password" subtitle={brand?.name} logo={<BrandMark brand={brand} />}>
      <Suspense>
        <SetPasswordForm endpoint="/auth/password/reset" cta="Set password" />
      </Suspense>
    </AuthCard>
  );
}
