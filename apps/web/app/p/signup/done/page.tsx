import { AuthCard } from "@/components/auth";

export default async function SignupDone({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthCard title="Payment received">
      <p className="text-sm text-slate-600">
        Thank you. As soon as Razorpay confirms the payment (usually within a minute) we&apos;ll email {email ? <strong>{email}</strong> : "you"} a link to set your password
        and open your institute&apos;s portal.
      </p>
    </AuthCard>
  );
}
