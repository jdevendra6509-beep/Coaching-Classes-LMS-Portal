"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, Dialog, Field, PageHeader, Spinner, Stat, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";

interface Detail {
  id: string;
  slug: string;
  name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  status: string;
  createdAt: string;
  subscriptions: { id: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; razorpaySubscriptionId: string | null; plan: { name: string; maxStudents: number } }[];
  platformPayments: { id: string; amount: string; gstAmount: string; status: string; paidAt: string | null; razorpayPaymentId: string | null }[];
  memberships: { user: { id: string; name: string; email: string; status: string } }[];
  _count: { students: number; teachers: number; courses: number };
}

export default function InstituteDetail() {
  const { id } = useParams<{ id: string }>();
  const path = `/platform/institutes/${id}`;
  const { data: inst, isLoading } = useApi<Detail>(path);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  const suspend = useAction(() => api(`${path}/suspend`, { method: "POST", json: { reason } }), { success: "Institute suspended", invalidate: ["/platform"], onSuccess: () => setSuspending(false) });
  const reactivate = useAction(() => api(`${path}/reactivate`, { method: "POST" }), { success: "Institute reactivated", invalidate: ["/platform"] });
  const resend = useAction(() => api<{ sent: number }>(`${path}/resend-welcome`, { method: "POST" }), { success: (r) => `Sent ${r.sent} welcome email(s)` });

  if (isLoading || !inst) return <Spinner />;
  const sub = inst.subscriptions[0];
  return (
    <>
      <PageHeader
        title={inst.name}
        description={`${inst.slug} · ${inst.email} · ${inst.phone}${inst.city ? ` · ${inst.city}` : ""}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => resend.mutate(undefined)} loading={resend.isPending} disabled={inst.status === "PENDING_PAYMENT"}>
              Resend welcome email
            </Button>
            {inst.status === "SUSPENDED" ? (
              <Button onClick={() => reactivate.mutate(undefined)} loading={reactivate.isPending}>
                Reactivate
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setSuspending(true)}>
                Suspend
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Status" value={<StatusBadge status={inst.status} />} />
        <Stat label="Students" value={inst._count.students} hint={sub && `Plan limit ${sub.plan.maxStudents}`} />
        <Stat label="Teachers" value={inst._count.teachers} />
        <Stat label="Paid until" value={date(sub?.currentPeriodEnd)} hint={sub?.plan.name} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Admins" />
          <Table head={["Name", "Email", "Account"]}>
            {inst.memberships.map(({ user }) => (
              <tr key={user.id}>
                <Td>{user.name}</Td>
                <Td>{user.email}</Td>
                <Td>
                  <StatusBadge status={user.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Subscription payments" />
          <Table head={["Paid", "Amount", "GST", "Razorpay id"]}>
            {inst.platformPayments.map((p) => (
              <tr key={p.id}>
                <Td>{date(p.paidAt)}</Td>
                <Td className="tabular-nums">{inr(p.amount)}</Td>
                <Td className="tabular-nums">{inr(p.gstAmount)}</Td>
                <Td className="font-mono text-xs">{p.razorpayPaymentId}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Dialog open={suspending} onClose={() => setSuspending(false)} title={`Suspend ${inst.name}?`}>
        <div className="space-y-4">
          <Alert tone="amber">Everyone at this institute is signed out immediately and can&apos;t sign in until you reactivate it.</Alert>
          <Field label="Reason (kept in the audit log)">{(fid) => <Textarea id={fid} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSuspending(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={suspend.isPending} onClick={() => suspend.mutate(undefined)}>
              Suspend institute
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
