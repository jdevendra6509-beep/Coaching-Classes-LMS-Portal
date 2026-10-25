"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, openPdf } from "@/lib/api";
import { date, dateTime, inr, titleCase } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import type { Account, Invoice } from "@/lib/types";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const path = `/invoices/${id}`;
  const { data: inv, isLoading } = useApi<Invoice>(path);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reversing, setReversing] = useState<Invoice["payments"][number] | null>(null);
  const [reason, setReason] = useState("");
  const inval = { invalidate: ["/invoices", "/students", "/payments", "/reports"] };
  const issue = useAction(() => api(`${path}/issue`, { method: "POST" }), { ...inval, success: "Invoice issued" });
  const del = useAction(() => api(path, { method: "DELETE" }), { ...inval, success: "Draft deleted", onSuccess: () => router.push("/fees") });
  const voidIt = useAction(() => api(`${path}/void`, { method: "POST", json: { reason } }), { ...inval, success: "Invoice voided", onSuccess: () => setVoiding(false) });
  const reverse = useAction(() => api(`/payments/${reversing!.id}/reverse`, { method: "POST", json: { reason } }), { ...inval, success: "Payment reversed", onSuccess: () => setReversing(null) });

  if (isLoading || !inv) return <Spinner />;
  const open = inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID";
  const livePayments = inv.payments.filter((p) => !p.reversedAt);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {inv.number.startsWith("DRAFT") ? "Draft invoice" : `Invoice ${inv.number}`} <StatusBadge status={inv.status} />
          </span>
        }
        description={
          <>
            <Link href={`/students/${inv.student.id}`} className="text-brand-700 hover:underline">
              {inv.student.membership.user.name}
            </Link>{" "}
            ({inv.student.admissionNo}) · issued {date(inv.issueDate)}
            {inv.dueDate ? ` · due ${date(inv.dueDate)}` : ""}
          </>
        }
        actions={
          <>
            {inv.status === "DRAFT" ? (
              <>
                <Button variant="secondary" onClick={() => confirm("Delete this draft?") && del.mutate(undefined)}>
                  Delete draft
                </Button>
                <Button onClick={() => issue.mutate(undefined)} loading={issue.isPending}>
                  Issue invoice
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => openPdf(`${path}/pdf`)}>
                  <FileDown className="size-4" aria-hidden /> PDF
                </Button>
                {open && !livePayments.length && (
                  <Button variant="secondary" onClick={() => (setReason(""), setVoiding(true))}>
                    Void
                  </Button>
                )}
                {open && <Button onClick={() => setPaying(true)}>Record payment</Button>}
              </>
            )}
          </>
        }
      />
      {inv.status === "VOID" && <div className="mb-6"><Alert>Voided: {inv.voidReason}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items" />
          <Table head={["Description", "Qty", "Rate", "GST", "Amount"]}>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <Td>{l.description}</Td>
                <Td>{l.quantity}</Td>
                <Td className="tabular-nums">{inr(l.unitPrice)}</Td>
                <Td>{Number(l.taxRate)}%</Td>
                <Td className="text-right tabular-nums">{inr(l.amount)}</Td>
              </tr>
            ))}
          </Table>
          <dl className="space-y-1 border-t border-slate-100 px-5 py-4 text-sm">
            <Row k="Subtotal" v={inr(inv.subtotal)} />
            {inv.discounts.map((d, i) => (
              <Row key={i} k={`Less: ${d.description}`} v={`−${inr(d.amount)}`} />
            ))}
            {Number(inv.taxTotal) > 0 && <Row k="GST" v={inr(inv.taxTotal)} />}
            <Row k="Total" v={inr(inv.total)} bold />
            <Row k="Paid" v={inr(inv.amountPaid)} />
            <Row k="Balance due" v={inr(inv.outstanding)} bold />
            {Number(inv.overdue) > 0 && <Row k="Of which overdue" v={<span className="text-red-600">{inr(inv.overdue)}</span>} />}
          </dl>
        </Card>
        {inv.installments.length > 0 && (
          <Card>
            <CardHeader title="Payment schedule" />
            <ul className="divide-y divide-slate-100 text-sm">
              {inv.installments.map((s, i) => (
                <li key={i} className="flex justify-between px-5 py-3">
                  <span>
                    Instalment {i + 1} · {date(s.dueDate)}
                  </span>
                  <span className="tabular-nums">{inr(s.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Card className="mt-6">
        <CardHeader title="Payments" />
        {!inv.payments.length ? (
          <p className="px-5 py-4 text-sm text-slate-500">No payments yet.</p>
        ) : (
          <Table head={["Receipt", "Received", "Amount", "Mode", ""]}>
            {inv.payments.map((p) => (
              <tr key={p.id} className={p.reversedAt ? "text-slate-400 line-through" : ""}>
                <Td>
                  {p.receiptNo} {p.reversedAt && <Badge tone="red">reversed: {p.reversalReason}</Badge>}
                </Td>
                <Td>{dateTime(p.receivedAt)}</Td>
                <Td className="tabular-nums">{inr(p.amount)}</Td>
                <Td>
                  {titleCase(p.method)}
                  {p.reference && <span className="text-slate-500"> · {p.reference}</span>}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => openPdf(`/payments/${p.id}/receipt.pdf`)}>
                      Receipt
                    </Button>
                    {!p.reversedAt && (
                      <Button size="sm" variant="ghost" onClick={() => (setReason(""), setReversing(p))}>
                        Reverse
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {paying && <PaymentDialog invoice={inv} onClose={() => setPaying(false)} />}
      <Dialog open={voiding} onClose={() => setVoiding(false)} title={`Void ${inv.number}?`}>
        <ReasonForm reason={reason} setReason={setReason} note="The invoice number stays used and the accounts entry is reversed." cta="Void invoice" loading={voidIt.isPending} onSubmit={() => voidIt.mutate(undefined)} />
      </Dialog>
      <Dialog open={!!reversing} onClose={() => setReversing(null)} title={`Reverse ${reversing?.receiptNo}?`}>
        <ReasonForm reason={reason} setReason={setReason} note="Use this when money didn't arrive, e.g. a bounced cheque. The amount becomes owed again." cta="Reverse payment" loading={reverse.isPending} onSubmit={() => reverse.mutate(undefined)} />
      </Dialog>
    </>
  );
}

function Row({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <dt>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function ReasonForm({ reason, setReason, note, cta, loading, onSubmit }: { reason: string; setReason: (s: string) => void; note: string; cta: string; loading: boolean; onSubmit: () => void }) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Alert tone="amber">{note}</Alert>
      <Field label="Reason">{(id) => <Textarea id={id} rows={2} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <div className="flex justify-end">
        <Button type="submit" variant="danger" loading={loading}>
          {cta}
        </Button>
      </div>
    </form>
  );
}

function PaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const accounts = useApi<Account[]>("/accounts").data?.filter((a) => a.type === "ASSET" && a.isActive && !["1100"].includes(a.code));
  const [f, setF] = useState({ amount: invoice.outstanding, method: "UPI", reference: "", receivedAt: new Date().toISOString().slice(0, 16), accountId: "", sendReceipt: true });
  const pay = useAction(
    () =>
      api<{ receiptNo: string }>(`/invoices/${invoice.id}/payments`, {
        method: "POST",
        json: { amount: Number(f.amount), method: f.method, reference: f.reference || undefined, receivedAt: new Date(f.receivedAt).toISOString(), accountId: f.accountId || undefined, sendReceipt: f.sendReceipt },
      }),
    { success: (r) => `Receipt ${r.receiptNo} recorded`, invalidate: ["/invoices", "/students", "/payments", "/reports"], onSuccess: onClose },
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onClose={onClose} title={`Record payment for ${invoice.number}`}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          pay.mutate(undefined);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" hint={`Balance ${inr(invoice.outstanding)}`}>{(id) => <Input id={id} type="number" min="0.01" max={invoice.outstanding} step="0.01" required value={f.amount} onChange={set("amount")} />}</Field>
          <Field label="Mode">
            {(id) => (
              <Select id={id} value={f.method} onChange={set("method")}>
                {["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD"].map((m) => (
                  <option key={m} value={m}>
                    {titleCase(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={f.method === "CHEQUE" ? "Cheque no." : "Reference / UTR"}>{(id) => <Input id={id} value={f.reference} onChange={set("reference")} />}</Field>
          <Field label="Received">{(id) => <Input id={id} type="datetime-local" required value={f.receivedAt} max={new Date().toISOString().slice(0, 16)} onChange={set("receivedAt")} />}</Field>
        </div>
        <Field label="Into account" hint="Default: Cash in Hand for cash, Bank for everything else.">
          {(id) => (
            <Select id={id} value={f.accountId} onChange={set("accountId")}>
              <option value="">Default</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.sendReceipt} onChange={(e) => setF((x) => ({ ...x, sendReceipt: e.target.checked }))} /> Email the receipt to the student and parent
        </label>
        <div className="flex justify-end">
          <Button type="submit" loading={pay.isPending}>
            Record payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
