import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, LoginForm } from "@/components/auth";
import { BrandMark, getBranding } from "@/components/branding";

export default async function InstituteLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBranding(slug);
  if (!brand) notFound(); // unknown, unpaid or suspended institute
  return (
    <AuthCard title={brand.name} subtitle="Sign in to your account" logo={<BrandMark brand={brand} />}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
