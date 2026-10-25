"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { Badge, Button, Card, Dialog, Empty, Field, Input, PageHeader, Pager, Select, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { date, dateTime, inr, titleCase } from "@/lib/format";
import { type Page, useAction, useApi } from "@/lib/hooks";
import type { Course, Invoice } from "@/lib/types";

function FeesPage() {
  const requested = useSearchParams().get("tab") as "invoices" | "payments" | "discounts" | null;
  const [tab, setTab] = useState(requested ?? "invoices");
  return (
    <>
      <PageHeader title="Fees" description="Bill a student from their profile (Courses → Bill fee). Record payments on the invoice." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "invoices", label: "Invoices" }, { value: "payments", label: "Payments received" }, { value: "discounts", label: "Discounts" }]} />
      {tab === "invoices" && <Invoices />}
      {tab === "payments" && <Payments />}
      {tab === "discounts" && <Discounts />}
    </>
  );
}

function Invoices() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const overdue = status === "OVERDUE";
  const { data, isLoading } = useApi<Page<Invoice>>(`/invoices${qs({ search, status: overdue ? undefined : status, overdue: overdue || undefined, page, pageSize: 25 })}`);
  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <Input placeholder="Invoice no., student or admission no." value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-sm" aria-label="Search invoices" />
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="max-w-48" aria-label="Status">
          <option value="">All</option>
          <option value="OVERDUE">Overdue</option>
          <option value="ISSUED">Unpaid</option>
          <option value="PARTIALLY_PAID">Part paid</option>
          <option value="PAID">Paid</option>
          <option value="DRAFT">Drafts</option>
          <option value="VOID">Void</option>
        </Select>
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Empty title="No invoices" />
      ) : (
        <>
          <Table head={["Invoice", "Student", "Date", "Total", "Balance", "Status"]}>
            {data.items.map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/fees/invoices/${i.id}`)}>
                <Td>
                  <Link href={`/fees/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {i.number}
                  </Link>
                  <div className="text-xs text-slate-500">{i.enrollment?.course.name}</div>
                </Td>
                <Td>
                  {i.student.membership.user.name}
                  <div className="text-xs text-slate-500">{i.student.admissionNo}</div>
                </Td>
                <Td>{date(i.issueDate)}</Td>
                <Td className="tabular-nums">{inr(i.total)}</Td>
                <Td className="tabular-nums">
                  {inr(i.outstanding)}
                  {Number(i.overdue) > 0 && <div className="text-xs text-red-600">{inr(i.overdue)} overdue</div>}
                </Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

interface PaymentRow {
  id: string;
  receiptNo: string;
  amount: string;
  method: string;
  reference: string | null;
  receivedAt: string;
  reversedAt: string | null;
  invoice: { id: string; number: string };
  student: { membership: { user: { name: string } } };
  account: { code: string; name: string };
}

function Payments() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<Page<PaymentRow>>(`/payments${qs({ from, to, method, page, pageSize: 50 })}`);
  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
        <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="max-w-44" aria-label="Mode">
          <option value="">All modes</option>
          {["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD"].map((m) => (
            <option key={m} value={m}>
              {titleCase(m)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Empty title="No payments" />
      ) : (
        <>
          <Table head={["Receipt", "Student", "Invoice", "Amount", "Mode", "Into", "Received"]}>
            {data.items.map((p) => (
              <tr key={p.id}>
                <Td>
                  {p.receiptNo} {p.reversedAt && <Badge tone="red">reversed</Badge>}
                </Td>
                <Td>{p.student.membership.user.name}</Td>
                <Td>
                  <Link href={`/fees/invoices/${p.invoice.id}`} className="text-brand-700 hover:underline">
                    {p.invoice.number}
                  </Link>
                </Td>
                <Td className="tabular-nums">{inr(p.amount)}</Td>
                <Td>
                  {titleCase(p.method)}
                  {p.reference && <div className="text-xs text-slate-500">{p.reference}</div>}
                </Td>
                <Td>{p.account.name}</Td>
                <Td>{dateTime(p.receivedAt)}</Td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

interface Discount {
  id: string;
  name: string;
  type: "PERCENT" | "FLAT";
  value: string;
  isActive: boolean;
  validFrom: string | null;
  validTo: string | null;
  course: { name: string } | null;
}

function Discounts() {
  const { data } = useApi<Discount[]>("/discounts");
  const courses = useApi<Page<Course>>("/courses?pageSize=200").data;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", type: "PERCENT", value: "", courseId: "", validFrom: "", validTo: "" });
  const create = useAction(
    () => api("/discounts", { method: "POST", json: { ...f, value: Number(f.value), courseId: f.courseId || undefined, validFrom: f.validFrom || undefined, validTo: f.validTo || undefined } }),
    { success: "Discount saved", invalidate: ["/discounts"], onSuccess: () => setOpen(false) },
  );
  const toggle = useAction((d: Discount) => api(`/discounts/${d.id}`, { method: "PATCH", json: { isActive: !d.isActive } }), { invalidate: ["/discounts"] });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card>
      <div className="flex justify-between border-b border-slate-100 p-4">
        <p className="text-sm text-slate-500">Saved discounts can be picked when billing. One-off concessions can be entered on the bill itself.</p>
        <Button size="sm" onClick={() => setOpen(true)}>
          New discount
        </Button>
      </div>
      {!data?.length ? (
        <Empty title="No saved discounts" />
      ) : (
        <Table head={["Name", "Value", "Course", "Valid", "Status", ""]}>
          {data.map((d) => (
            <tr key={d.id}>
              <Td className="font-medium">{d.name}</Td>
              <Td>{d.type === "PERCENT" ? `${Number(d.value)}%` : inr(d.value)}</Td>
              <Td>{d.course?.name ?? "Any course"}</Td>
              <Td>
                {d.validFrom || d.validTo ? `${d.validFrom ? date(d.validFrom) : "…"} – ${d.validTo ? date(d.validTo) : "…"}` : "Always"}
              </Td>
              <Td>{d.isActive ? <Badge tone="green">active</Badge> : <Badge>off</Badge>}</Td>
              <Td className="text-right">
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(d)}>
                  {d.isActive ? "Turn off" : "Turn on"}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New discount">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <Field label="Name" hint="e.g. Sibling discount, Early bird">{(id) => <Input id={id} required value={f.name} onChange={set("name")} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              {(id) => (
                <Select id={id} value={f.type} onChange={set("type")}>
                  <option value="PERCENT">Percentage</option>
                  <option value="FLAT">Fixed amount (₹)</option>
                </Select>
              )}
            </Field>
            <Field label={f.type === "PERCENT" ? "Percent" : "Amount (₹)"}>{(id) => <Input id={id} type="number" min="0.01" max={f.type === "PERCENT" ? 100 : undefined} step="0.01" required value={f.value} onChange={set("value")} />}</Field>
          </div>
          <Field label="Course">
            {(id) => (
              <Select id={id} value={f.courseId} onChange={set("courseId")}>
                <option value="">Any course</option>
                {courses?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from">{(id) => <Input id={id} type="date" value={f.validFrom} onChange={set("validFrom")} />}</Field>
            <Field label="Valid until">{(id) => <Input id={id} type="date" value={f.validTo} onChange={set("validTo")} />}</Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={create.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense>
      <FeesPage />
    </Suspense>
  );
}
