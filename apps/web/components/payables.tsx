"use client";

import { type FormEvent, useState } from "react";
import { Button, Card, CardHeader, Dialog, Empty, Field, Input, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr, titleCase, today } from "@/lib/format";
import { type Page, useAction, useApi } from "@/lib/hooks";
import type { Account } from "@/lib/types";

interface Vendor {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
}
interface Bill {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  description: string | null;
  total: string;
  amountPaid: string;
  status: string;
  vendor: { id: string; name: string };
  expenseAccount: { code: string; name: string };
}

export function Bills() {
  const bills = useApi<Page<Bill>>("/bills?pageSize=100");
  const vendors = useApi<Page<Vendor>>("/vendors?pageSize=200").data;
  const accounts = useApi<Account[]>("/accounts").data;
  const [dialog, setDialog] = useState<"vendor" | "bill" | Bill | null>(null);
  const [v, setV] = useState({ name: "", gstin: "", phone: "", email: "" });
  const [b, setB] = useState({ vendorId: "", billNumber: "", billDate: today(), dueDate: "", expenseAccountId: "", total: "", description: "" });
  const [pay, setPay] = useState({ amount: "", method: "BANK_TRANSFER", reference: "" });
  const inval = { invalidate: ["/bills", "/vendors", "/reports"] };
  const addVendor = useAction(() => api("/vendors", { method: "POST", json: { name: v.name, gstin: v.gstin || undefined, phone: v.phone || undefined, email: v.email || undefined } }), { ...inval, success: "Vendor added", onSuccess: () => setDialog("bill") });
  const addBill = useAction(() => api("/bills", { method: "POST", json: { ...b, total: Number(b.total), dueDate: b.dueDate || undefined, description: b.description || undefined } }), { ...inval, success: "Bill recorded", onSuccess: () => setDialog(null) });
  const payBill = useAction((bill: Bill) => api(`/bills/${bill.id}/payments`, { method: "POST", json: { amount: Number(pay.amount), method: pay.method, reference: pay.reference || undefined } }), { ...inval, success: "Payment recorded", onSuccess: () => setDialog(null) });
  const expenses = accounts?.filter((a) => a.type === "EXPENSE" && a.isActive) ?? [];
  const payingBill = typeof dialog === "object" && dialog ? dialog : null;

  return (
    <Card>
      <CardHeader
        title="Vendor bills"
        description="Rent, electricity, printing and other things you owe."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog("vendor")}>
              New vendor
            </Button>
            <Button size="sm" onClick={() => setDialog("bill")}>
              Record bill
            </Button>
          </>
        }
      />
      {bills.isLoading ? (
        <Spinner />
      ) : !bills.data?.items.length ? (
        <Empty title="No bills recorded" />
      ) : (
        <Table head={["Bill", "Vendor", "Expense", "Due", "Total", "Paid", "Status", ""]}>
          {bills.data.items.map((x) => (
            <tr key={x.id}>
              <Td>
                {x.billNumber}
                <div className="text-xs text-slate-500">{date(x.billDate)}</div>
              </Td>
              <Td>{x.vendor.name}</Td>
              <Td>{x.expenseAccount.name}</Td>
              <Td>{date(x.dueDate)}</Td>
              <Td className="tabular-nums">{inr(x.total)}</Td>
              <Td className="tabular-nums">{inr(x.amountPaid)}</Td>
              <Td>
                <StatusBadge status={x.status} />
              </Td>
              <Td className="text-right">
                {(x.status === "ISSUED" || x.status === "PARTIALLY_PAID") && (
                  <Button size="sm" variant="secondary" onClick={() => (setPay({ amount: String(Number(x.total) - Number(x.amountPaid)), method: "BANK_TRANSFER", reference: "" }), setDialog(x))}>
                    Pay
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Dialog open={dialog === "vendor"} onClose={() => setDialog(null)} title="New vendor">
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), addVendor.mutate(undefined))}>
          <Field label="Name">{(id) => <Input id={id} required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GSTIN">{(id) => <Input id={id} value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value })} />}</Field>
            <Field label="Phone">{(id) => <Input id={id} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={addVendor.isPending}>
              Save vendor
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "bill"} onClose={() => setDialog(null)} title="Record a bill">
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), addBill.mutate(undefined))}>
          <Field label="Vendor">
            {(id) => (
              <Select id={id} required value={b.vendorId} onChange={(e) => setB({ ...b, vendorId: e.target.value })}>
                <option value="">Choose…</option>
                {vendors?.items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor's bill no.">{(id) => <Input id={id} required value={b.billNumber} onChange={(e) => setB({ ...b, billNumber: e.target.value })} />}</Field>
            <Field label="Amount (₹)">{(id) => <Input id={id} type="number" min="0.01" step="0.01" required value={b.total} onChange={(e) => setB({ ...b, total: e.target.value })} />}</Field>
            <Field label="Bill date">{(id) => <Input id={id} type="date" required value={b.billDate} onChange={(e) => setB({ ...b, billDate: e.target.value })} />}</Field>
            <Field label="Due date">{(id) => <Input id={id} type="date" min={b.billDate} value={b.dueDate} onChange={(e) => setB({ ...b, dueDate: e.target.value })} />}</Field>
          </div>
          <Field label="Expense type">
            {(id) => (
              <Select id={id} required value={b.expenseAccountId} onChange={(e) => setB({ ...b, expenseAccountId: e.target.value })}>
                <option value="">Choose…</option>
                {expenses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={b.description} onChange={(e) => setB({ ...b, description: e.target.value })} />}</Field>
          <div className="flex justify-end">
            <Button type="submit" loading={addBill.isPending}>
              Record bill
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!payingBill} onClose={() => setDialog(null)} title={`Pay ${payingBill?.vendor.name}: ${payingBill?.billNumber}`}>
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), payBill.mutate(payingBill!))}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)">{(id) => <Input id={id} type="number" min="0.01" step="0.01" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />}</Field>
            <Field label="Mode">
              {(id) => (
                <Select id={id} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "CARD"].map((m) => (
                    <option key={m} value={m}>
                      {titleCase(m)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Reference">{(id) => <Input id={id} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />}</Field>
          <div className="flex justify-end">
            <Button type="submit" loading={payBill.isPending}>
              Record payment
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

interface Journal {
  id: string;
  date: string;
  memo: string | null;
  sourceType: string | null;
  reversalOfId: string | null;
  lines: { debit: string; credit: string; account: { code: string; name: string } }[];
  postedBy: { user: { name: string } };
}

export function Journals() {
  const { data } = useApi<Page<Journal>>("/journals?pageSize=50");
  const accounts = useApi<Account[]>("/accounts").data?.filter((a) => a.isActive);
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [day, setDay] = useState(today());
  const [lines, setLines] = useState([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  const dr = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  const post = useAction(
    () => api("/journals", { method: "POST", json: { date: day, memo, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) } }),
    { success: "Entry posted", invalidate: ["/journals", "/reports"], onSuccess: () => setOpen(false) },
  );
  const reverse = useAction((id: string) => api(`/journals/${id}/reverse`, { method: "POST" }), { success: "Reversed", invalidate: ["/journals", "/reports"] });

  return (
    <Card>
      <CardHeader title="Day book" description="Every accounting entry, newest first. Invoices, receipts and bills post automatically." actions={<Button size="sm" onClick={() => setOpen(true)}>Manual entry</Button>} />
      {!data ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.items.map((j) => (
            <li key={j.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {date(j.date)} · {j.memo}
                </span>
                <span className="text-xs text-slate-500">
                  {j.sourceType === "Manual" ? "manual" : j.sourceType?.replace(/([A-Z])/g, " $1").trim().toLowerCase()} · {j.postedBy.user.name}
                  {j.sourceType === "Manual" && !j.reversalOfId && (
                    <button className="ml-3 text-brand-700 hover:underline" onClick={() => confirm("Post a reversing entry?") && reverse.mutate(j.id)}>
                      reverse
                    </button>
                  )}
                </span>
              </div>
              <table className="mt-1 w-full text-xs text-slate-600">
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i}>
                      <td className={Number(l.credit) ? "pl-8" : ""}>
                        {l.account.code} {l.account.name}
                      </td>
                      <td className="w-28 text-right tabular-nums">{Number(l.debit) ? inr(l.debit, { symbol: false }) : ""}</td>
                      <td className="w-28 text-right tabular-nums">{Number(l.credit) ? inr(l.credit, { symbol: false }) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Manual journal entry" wide>
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), post.mutate(undefined))}>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Date">{(id) => <Input id={id} type="date" required value={day} onChange={(e) => setDay(e.target.value)} />}</Field>
            <Field label="Narration" hint="e.g. October salaries paid">{(id) => <Input id={id} required minLength={3} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_8rem] gap-2">
              <Select aria-label={`Account ${i + 1}`} value={l.accountId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
                <option value="">Account…</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
              <Input aria-label={`Debit ${i + 1}`} placeholder="Debit" type="number" min="0" step="0.01" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: "" } : x)))} />
              <Input aria-label={`Credit ${i + 1}`} placeholder="Credit" type="number" min="0" step="0.01" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: "" } : x)))} />
            </div>
          ))}
          <div className="flex items-center justify-between text-sm">
            <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, { accountId: "", debit: "", credit: "" }])}>
              + Add line
            </Button>
            <span className={dr === cr && dr > 0 ? "text-green-700" : "text-red-600"}>
              Debits {inr(dr)} · Credits {inr(cr)}
            </span>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={post.isPending} disabled={dr !== cr || dr === 0}>
              Post entry
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

export function ChartOfAccounts({ onOpen }: { onOpen: (id: string) => void }) {
  const { data } = useApi<Account[]>("/accounts");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: "", name: "", type: "ASSET" });
  const add = useAction(() => api("/accounts", { method: "POST", json: f }), { success: "Account added", invalidate: ["/accounts"], onSuccess: () => setOpen(false) });
  if (!data) return <Spinner />;
  return (
    <Card>
      <CardHeader title="Chart of accounts" actions={<Button size="sm" onClick={() => setOpen(true)}>New account</Button>} />
      <Table head={["Code", "Name", "Type", ""]}>
        {data.map((a) => (
          <tr key={a.id} className={a.isActive ? "" : "text-slate-400"}>
            <Td className="font-mono">{a.code}</Td>
            <Td>
              <button className="text-brand-700 hover:underline" onClick={() => onOpen(a.id)}>
                {a.name}
              </button>
            </Td>
            <Td>{titleCase(a.type)}</Td>
            <Td className="text-xs text-slate-500">{a.isSystem ? "used by automatic postings" : ""}</Td>
          </tr>
        ))}
      </Table>
      <Dialog open={open} onClose={() => setOpen(false)} title="New account">
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), add.mutate(undefined))}>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Code">{(id) => <Input id={id} required pattern="[0-9A-Z\-]{1,10}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />}</Field>
            <Field label="Name" hint="e.g. HDFC Current A/c">{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          </div>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={add.isPending}>
              Add account
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
