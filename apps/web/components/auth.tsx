"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Alert, Button, Field, Input } from "./ui";

export function AuthCard({ title, subtitle, logo, children }: { title: string; subtitle?: ReactNode; logo?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {logo}
          <h1 className="mt-4 text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

/** Only same-site relative paths, so ?next= can't send someone to another website. */
function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export function LoginForm({ home = "/", forgotHref = "/forgot-password" }: { home?: string; forgotHref?: string }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", json: { email, password, ...(needsOtp && { otp }) } });
      router.replace(safeNext(next, home));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") setNeedsOtp(true);
      else setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {!needsOtp ? (
        <>
          <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Password">
            {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        </>
      ) : (
        <Field label="Authenticator code" hint="Open your authenticator app and enter the 6-digit code.">
          {(id) => (
            <Input id={id} inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" autoFocus required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
          )}
        </Field>
      )}
      <Button type="submit" className="w-full" loading={busy}>
        {needsOtp ? "Verify" : "Sign in"}
      </Button>
      {!needsOtp && (
        <p className="text-center text-sm">
          <Link href={forgotHref} className="text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </p>
      )}
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api("/auth/password/forgot", { method: "POST", json: { email } }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }
  if (sent) return <Alert tone="green">If an account exists for {email}, we&apos;ve emailed a link to reset the password. It&apos;s valid for an hour.</Alert>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Button type="submit" className="w-full" loading={busy}>
        Email me a reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

/** For both "accept invite" and "reset password": a token from the email plus a new password. */
export function SetPasswordForm({ endpoint, cta }: { endpoint: "/auth/invite/accept" | "/auth/password/reset"; cta: string }) {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match");
    setBusy(true);
    setError(null);
    try {
      await api(endpoint, { method: "POST", json: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Alert>This link is incomplete. Please use the link from your email.</Alert>;
  if (done)
    return (
      <div className="space-y-4">
        <Alert tone="green">Your password is set.</Alert>
        <Link href="/login" className="block">
          <Button className="w-full">Sign in</Button>
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="New password" hint="At least 8 characters.">
        {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Field label="Confirm password">{(id) => <Input id={id} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
      <Button type="submit" className="w-full" loading={busy}>
        {cta}
      </Button>
    </form>
  );
}
