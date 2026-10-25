"use client";

import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useMe } from "@/lib/hooks";

/** Turn the authenticator-app second step on or off for the signed-in user. */
export function SecurityCard() {
  const me = useMe().data!;
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);
  const start = useAction(() => api<{ secret: string; otpauthUri: string }>("/auth/mfa/setup", { method: "POST" }), { onSuccess: setSetup });
  const enable = useAction(() => api("/auth/mfa/enable", { method: "POST", json: { code } }), { success: "Two-step sign-in is on", invalidate: ["/auth/me"], onSuccess: () => (setSetup(null), setCode("")) });
  const disable = useAction(() => api("/auth/mfa/disable", { method: "POST", json: { code } }), { success: "Two-step sign-in is off", invalidate: ["/auth/me"], onSuccess: () => setCode("") });
  const isAdmin = me.isPlatformAdmin || me.roles.includes("INSTITUTE_ADMIN") || me.roles.includes("ACCOUNTANT");

  return (
    <Card>
      <CardHeader title="Two-step sign-in" description="Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) after your password." />
      <div className="space-y-4 p-5">
        {me.user.mfaEnabled ? (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => (e.preventDefault(), disable.mutate(undefined))}>
            <Alert tone="green">On for {me.user.email}.</Alert>
            <Field label="Code from your app, to turn it off">{(id) => <Input id={id} inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} className="w-40" />}</Field>
            <Button type="submit" variant="secondary" loading={disable.isPending}>
              Turn off
            </Button>
          </form>
        ) : setup ? (
          <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), enable.mutate(undefined))}>
            <p className="text-sm">1. Scan this with your authenticator app, or type the key.</p>
            <div className="flex flex-wrap items-center gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qr && <img src={qr} alt="Authenticator QR code" className="size-40 rounded border border-slate-200" />}
              <code className="rounded bg-slate-100 px-2 py-1 text-sm tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
            </div>
            <Field label="2. Enter the 6-digit code it shows">{(id) => <Input id={id} inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} className="w-40" />}</Field>
            <Button type="submit" loading={enable.isPending}>
              Turn on
            </Button>
          </form>
        ) : (
          <>
            {isAdmin && <Alert tone="amber">Recommended for anyone who can see fees and accounts.</Alert>}
            <Button onClick={() => start.mutate(undefined)} loading={start.isPending}>
              Set up two-step sign-in
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
