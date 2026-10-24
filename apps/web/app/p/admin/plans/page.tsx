"use client";

import { type FormEvent, useState } from "react";
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { inr } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";

interface Plan {
  id: string;
  code: string;
  name: string;
  pricePerMonth: string;
  maxStudents: number;
  maxStorageMb: number;
  isActive: boolean;
  razorpayPlanId: string | null;
  _count: { subscriptions: number };
}

export default function Plans() {
  const { data, isLoading } = useApi<Plan[]>("/platform/plans");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", pricePerMonth: "", maxStudents: "200", maxStorageMb: "5120" });
  const create = useAction(
    () => api("/platform/plans", { method: "POST", json: { ...form, pricePerMonth: Number(form.pricePerMonth), maxStudents: Number(form.maxStudents), maxStorageMb: Number(form.maxStorageMb) } }),
    { success: "Plan created in Razorpay and published", invalidate: ["/platform/plans"], onSuccess: () => setOpen(false) },
  );
  const toggle = useAction((p: Plan) => api(`/platform/plans/${p.id}`, { method: "PATCH", json: { isActive: !p.isActive } }), { invalidate: ["/platform/plans"] });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Plans" description="Prices are fixed once created (Razorpay plans can't change). To change a price, add a new plan and retire the old one." actions={<Button onClick={() => setOpen(true)}>New plan</Button>} />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table head={["Plan", "Price / month", "Students", "Storage", "Subscribers", "Status", ""]}>
            {data?.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.code}</div>
                </Td>
                <Td className="tabular-nums">{inr(p.pricePerMonth)} + GST</Td>
                <Td>{p.maxStudents}</Td>
                <Td>{p.maxStorageMb} MB</Td>
                <Td>{p._count.subscriptions}</Td>
                <Td>{p.isActive ? <Badge tone="green">on sale</Badge> : <Badge>retired</Badge>}</Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => toggle.mutate(p)}>
                    {p.isActive ? "Retire" : "Put on sale"}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title="New plan">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">{(id) => <Input id={id} required value={form.name} onChange={set("name")} />}</Field>
            <Field label="Code" hint="e.g. growth-2026">{(id) => <Input id={id} required pattern="[a-z0-9\-]{2,40}" value={form.code} onChange={set("code")} />}</Field>
          </div>
          <Field label="Price per month (₹, before GST)">{(id) => <Input id={id} type="number" min="1" step="0.01" required value={form.pricePerMonth} onChange={set("pricePerMonth")} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Active students">{(id) => <Input id={id} type="number" min="1" required value={form.maxStudents} onChange={set("maxStudents")} />}</Field>
            <Field label="Storage (MB)">{(id) => <Input id={id} type="number" min="1" required value={form.maxStorageMb} onChange={set("maxStorageMb")} />}</Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={create.isPending}>
              Create plan
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
