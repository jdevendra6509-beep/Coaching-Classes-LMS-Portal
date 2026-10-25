"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { Alert, Button, Dialog, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, today } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import type { Invoice } from "@/lib/types";

interface Discount {
  id: string;
  name: string;
  type: "PERCENT" | "FLAT";
  value: string;
  courseId: string | null;
  isActive: boolean;
  validFrom: string | null;
  validTo: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const addMonths = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};

/** Bills an enrollment's course fee: optional discount, GST and an instalment plan. */
export function BillDialog({ open, onClose, enrollment }: { open: boolean; onClose: () => void; enrollment: { id: string; course: { id: string; name: string }; fee: number } }) {
  const router = useRouter();
  const discounts = useApi<Discount[]>(open ? "/discounts" : null).data?.filter((d) => d.isActive && (!d.courseId || d.courseId === enrollment.course.id) && (!d.validTo || d.validTo.slice(0, 10) >= today()));
  const [discountId, setDiscountId] = useState("");
  const [adhoc, setAdhoc] = useState({ amount: "", reason: "" });
  const [taxRate, setTaxRate] = useState("0");
  const [count, setCount] = useState(1);
  const [firstDue, setFirstDue] = useState(today());
  const [plan, setPlan] = useState<{ dueDate: string; amount: string }[] | null>(null);
  const [issue, setIssue] = useState(true);

  const rule = discounts?.find((d) => d.id === discountId);
  const ruleAmount = rule ? (rule.type === "PERCENT" ? r2((enrollment.fee * Number(rule.value)) / 100) : Number(rule.value)) : 0;
  const taxable = Math.max(0, enrollment.fee - ruleAmount - (Number(adhoc.amount) || 0));
  const tax = r2((taxable * Number(taxRate)) / 100);
  const total = r2(taxable + tax);

  // Even split to the paisa; the last instalment takes the remainder. Editable after.
  const autoPlan = useMemo(() => {
    const each = Math.floor((total / count) * 100) / 100;
    return Array.from({ length: count }, (_, i) => ({ dueDate: addMonths(firstDue, i), amount: (i === count - 1 ? r2(total - each * (count - 1)) : each).toFixed(2) }));
  }, [total, count, firstDue]);
  const rows = plan ?? autoPlan;
  const planTotal = r2(rows.reduce((a, r) => a + Number(r.amount), 0));

  const create = useAction(
    () =>
      api<Invoice>("/invoices/from-enrollment", {
        method: "POST",
        json: {
          enrollmentId: enrollment.id,
          taxRate: Number(taxRate),
          issue,
          discounts: [...(discountId ? [{ discountId }] : []), ...(Number(adhoc.amount) > 0 ? [{ amount: Number(adhoc.amount), description: adhoc.reason }] : [])],
          ...(count > 1 ? { installments: rows.map((r) => ({ dueDate: r.dueDate, amount: Number(r.amount) })) } : { dueDate: firstDue }),
        },
      }),
    { success: (i) => (issue ? `Invoice ${i.number} issued` : "Draft saved"), invalidate: ["/students", "/invoices", "/reports"], onSuccess: (i) => router.push(`/fees/invoices/${i.id}`) },
  );

  return (
    <Dialog open={open} onClose={onClose} title={`Bill fee: ${enrollment.course.name}`} wide>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate(undefined);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Course fee">{(id) => <Input id={id} value={inr(enrollment.fee)} disabled />}</Field>
          <Field label="Saved discount">
            {(id) => (
              <Select id={id} value={discountId} onChange={(e) => (setDiscountId(e.target.value), setPlan(null))}>
                <option value="">None</option>
                {discounts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.type === "PERCENT" ? `${Number(d.value)}%` : inr(d.value)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="GST">
            {(id) => (
              <Select id={id} value={taxRate} onChange={(e) => (setTaxRate(e.target.value), setPlan(null))}>
                <option value="0">Not charged</option>
                <option value="18">18%</option>
              </Select>
            )}
          </Field>
          <Field label="Extra concession (₹)">{(id) => <Input id={id} type="number" min="0" step="0.01" value={adhoc.amount} onChange={(e) => (setAdhoc({ ...adhoc, amount: e.target.value }), setPlan(null))} />}</Field>
          <Field label="Reason for concession" className="sm:col-span-2">
            {(id) => <Input id={id} required={Number(adhoc.amount) > 0} minLength={3} value={adhoc.reason} onChange={(e) => setAdhoc({ ...adhoc, reason: e.target.value })} />}
          </Field>
        </div>
        <div className="rounded-md bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span>After discounts</span><span className="tabular-nums">{inr(taxable)}</span></div>
          {tax > 0 && <div className="flex justify-between"><span>GST {taxRate}%</span><span className="tabular-nums">{inr(tax)}</span></div>}
          <div className="mt-1 flex justify-between font-semibold"><span>Invoice total</span><span className="tabular-nums">{inr(total)}</span></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pay in">
            {(id) => (
              <Select id={id} value={count} onChange={(e) => (setCount(Number(e.target.value)), setPlan(null))}>
                {[1, 2, 3, 4, 6, 12].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "One payment" : `${n} monthly instalments`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={count > 1 ? "First instalment due" : "Due date"}>{(id) => <Input id={id} type="date" required value={firstDue} onChange={(e) => (setFirstDue(e.target.value), setPlan(null))} />}</Field>
        </div>
        {count > 1 && (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-center gap-3 text-sm">
                <span className="w-24 text-slate-500">Instalment {i + 1}</span>
                <Input type="date" aria-label={`Instalment ${i + 1} due date`} value={r.dueDate} onChange={(e) => setPlan(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                <Input type="number" step="0.01" min="0.01" aria-label={`Instalment ${i + 1} amount`} value={r.amount} onChange={(e) => setPlan(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              </div>
            ))}
            {planTotal !== total && <Alert tone="amber">Instalments add up to {inr(planTotal)} but the total is {inr(total)}.</Alert>}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!issue} onChange={(e) => setIssue(!e.target.checked)} /> Save as draft (no number yet, not in the accounts)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={count > 1 && planTotal !== total}>
            {issue ? "Issue invoice" : "Save draft"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
