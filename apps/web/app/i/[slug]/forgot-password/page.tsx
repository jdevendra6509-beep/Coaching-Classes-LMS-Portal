import { AuthCard, ForgotPasswordForm } from "@/components/auth";
import { BrandMark, getBranding } from "@/components/branding";

export default async function Forgot({ params }: { params: Promise<{ slug: string }> }) {
  const brand = await getBranding((await params).slug);
  return (
    <AuthCard title="Reset your password" subtitle={brand?.name} logo={<BrandMark brand={brand} />}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
