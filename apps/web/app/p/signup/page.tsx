"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import { type FormEvent, Suspense, useEffect, useState } from "react";
import { AuthCard } from "@/components/auth";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { inr } from "@/lib/format";

interface Plan {
  code: string;
  name: string;
  pricePerMonth: string;
  gstRate: number;
}
interface SignupResult {
  slug: string;
  razorpayKeyId: string;
  razorpaySubscriptionId: string;
  paymentUrl: string;
  amountPaise: number;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function SignupForm() {
  const router = useRouter();
  const requestedPlan = useSearchParams().get("plan") ?? "";
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ instituteName: "", slug: "", ownerName: "", email: "", phone: "", city: "", state: "", planCode: requestedPlan });
  const [slugState, setSlugState] = useState<"idle" | "checking" | "free" | "taken">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SignupResult | null>(null);
  const host = typeof window !== "undefined" ? window.location.host : "";

  useEffect(() => {
    api<Plan[]>("/plans").then((p) => {
      setPlans(p);
      setForm((f) => ({ ...f, planCode: f.planCode || p[0]?.code || "" }));
    });
  }, []);

  // Suggest a subdomain from the name; check availability as it's typed.
  useEffect(() => {
    if (form.slug.length < 3) return setSlugState("idle");
    setSlugState("checking");
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean }>(`/signup/slug-available?slug=${encodeURIComponent(form.slug)}`).catch(() => ({ available: false }));
      setSlugState(r.available ? "free" : "taken");
    }, 350);
    return () => clearTimeout(t);
  }, [form.slug]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: value };
      if (k === "instituteName" && (!f.slug || f.slug === slugify(f.instituteName))) next.slug = slugify(value);
      return next;
    });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<SignupResult>("/signup", { method: "POST", json: { ...form, city: form.city || undefined, state: form.state || undefined } });
      setPending(r);
      pay(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your institute");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Opens Razorpay Checkout for the subscription. Success here only means the browser finished;
   * the institute is activated when Razorpay's webhook reaches our server.
   */
  function pay(r: SignupResult) {
    if (!window.Razorpay || !r.razorpayKeyId) {
      window.location.href = r.paymentUrl; // hosted payment page fallback
      return;
    }
    const checkout = new window.Razorpay({
      key: r.razorpayKeyId,
      subscription_id: r.razorpaySubscriptionId,
      name: "Coaching LMS",
      description: `${form.instituteName}: monthly subscription`,
      prefill: { name: form.ownerName, email: form.email, contact: form.phone },
      handler: () => router.push(`/signup/done?slug=${r.slug}&email=${encodeURIComponent(form.email)}`),
      theme: { color: "#4f46e5" },
    });
    checkout.open();
  }

  const plan = plans.find((p) => p.code === form.planCode);
  return (
    <AuthCard title="Start your institute" subtitle="Your own portal for students, teachers and fees.">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      {pending ? (
        <div className="space-y-4">
          <Alert tone="blue">Complete the payment in the Razorpay window. If it closed, you can open it again.</Alert>
          <Button className="w-full" onClick={() => pay(pending)}>
            Pay {inr(pending.amountPaise / 100)}
          </Button>
          <a href={pending.paymentUrl} className="block text-center text-sm text-brand-600 hover:underline">
            Or pay on Razorpay&apos;s page
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Institute name">{(id) => <Input id={id} required value={form.instituteName} onChange={set("instituteName")} />}</Field>
          <Field
            label="Web address"
            hint={
              slugState === "taken" ? <span className="text-red-600">That address is taken.</span> : slugState === "free" ? <span className="text-green-700">Available: {form.slug}.{host}</span> : "Lowercase letters, digits and hyphens."
            }
          >
            {(id) => <Input id={id} required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))} />}
          </Field>
          <Field label="Your name">{(id) => <Input id={id} required value={form.ownerName} onChange={set("ownerName")} />}</Field>
          <Field label="Email" hint="Your sign-in link is sent here after payment.">
            {(id) => <Input id={id} type="email" required value={form.email} onChange={set("email")} />}
          </Field>
          <Field label="Mobile">{(id) => <Input id={id} type="tel" required pattern="\+?[0-9]{10,13}" value={form.phone} onChange={set("phone")} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">{(id) => <Input id={id} value={form.city} onChange={set("city")} />}</Field>
            <Field label="State">{(id) => <Input id={id} value={form.state} onChange={set("state")} />}</Field>
          </div>
          <Field label="Plan" hint={plan && `${inr(plan.pricePerMonth)} a month + ${plan.gstRate}% GST, billed in advance.`}>
            {(id) => (
              <Select id={id} required value={form.planCode} onChange={set("planCode")}>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={slugState === "taken"}>
            Continue to payment
          </Button>
          <p className="text-center text-xs text-slate-500">
            Already have an institute? Sign in at your institute&apos;s address. <Link href="/" className="text-brand-600 hover:underline">Home</Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
