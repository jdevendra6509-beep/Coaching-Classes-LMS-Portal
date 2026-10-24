"use client";

import { UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge, Button, Card, Dialog, Empty, Field, Input, PageHeader, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { type Page, useAction, useApi } from "@/lib/hooks";
import type { Teacher } from "@/lib/types";

const EMPTY = { name: "", email: "", phone: "", employeeCode: "", qualification: "", joiningDate: "" };

export default function Teachers() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useApi<Page<Teacher>>(`/teachers?status=all&pageSize=200${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  const [editing, setEditing] = useState<Teacher | "new" | null>(null);
  const [f, setF] = useState(EMPTY);
  const open = (t: Teacher | "new") => {
    setEditing(t);
    setF(t === "new" ? EMPTY : { name: t.membership.user.name, email: t.membership.user.email, phone: t.membership.user.phone ?? "", employeeCode: t.employeeCode ?? "", qualification: t.qualification ?? "", joiningDate: t.joiningDate?.slice(0, 10) ?? "" });
  };
  const isNew = editing === "new";
  const invited = editing !== "new" && editing?.membership.user.status === "INVITED";
  const save = useAction(
    () => {
      const body: Record<string, string | undefined> = { ...f };
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = undefined;
      if (!isNew) {
        delete body.email;
        if (!invited) delete body.name, delete body.phone;
      }
      return isNew ? api("/teachers", { method: "POST", json: body }) : api(`/teachers/${(editing as Teacher).id}`, { method: "PATCH", json: body });
    },
    { success: isNew ? "Teacher added and invited by email" : "Saved", invalidate: ["/teachers"], onSuccess: () => setEditing(null) },
  );
  const toggle = useAction((t: Teacher) => api(`/teachers/${t.id}/${t.membership.isActive ? "deactivate" : "activate"}`, { method: "POST" }), { success: "Updated", invalidate: ["/teachers"] });
  const resend = useAction((t: Teacher) => api(`/teachers/${t.id}/resend-invite`, { method: "POST" }), { success: "Invitation sent again" });
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Teachers" description="Teachers mark attendance, upload course material and sign off course completion for their batches." actions={<Button onClick={() => open("new")}><UserPlus className="size-4" aria-hidden /> Add teacher</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Input placeholder="Search name, email or code" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" aria-label="Search teachers" />
        </div>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title="No teachers yet" />
        ) : (
          <Table head={["Teacher", "Code", "Qualification", "Joined", "Batches", "Account", ""]}>
            {data.items.map((t) => (
              <tr key={t.id}>
                <Td>
                  <div className="font-medium">{t.membership.user.name}</div>
                  <div className="text-xs text-slate-500">{t.membership.user.email}</div>
                </Td>
                <Td>{t.employeeCode ?? "—"}</Td>
                <Td>{t.qualification ?? "—"}</Td>
                <Td>{date(t.joiningDate)}</Td>
                <Td>{t._count.batches}</Td>
                <Td>{t.membership.isActive ? <StatusBadge status={t.membership.user.status} /> : <Badge tone="red">deactivated</Badge>}</Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {t.membership.user.status === "INVITED" && t.membership.isActive && (
                      <Button size="sm" variant="ghost" onClick={() => resend.mutate(t)}>
                        Resend invite
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => open(t)}>
                      Edit
                    </Button>
                    <Button size="sm" variant={t.membership.isActive ? "ghost" : "secondary"} onClick={() => toggle.mutate(t)}>
                      {t.membership.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={isNew ? "Add teacher" : "Edit teacher"}>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <Field label="Full name" hint={!isNew && !invited ? "The teacher manages their own name now." : undefined}>{(id) => <Input id={id} required disabled={!isNew && !invited} value={f.name} onChange={set("name")} />}</Field>
          {isNew && <Field label="Email" hint="Login details are sent here.">{(id) => <Input id={id} type="email" required value={f.email} onChange={set("email")} />}</Field>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile">{(id) => <Input id={id} type="tel" disabled={!isNew && !invited} pattern="\+?[0-9]{10,13}" value={f.phone} onChange={set("phone")} />}</Field>
            <Field label="Employee code">{(id) => <Input id={id} value={f.employeeCode} onChange={set("employeeCode")} />}</Field>
            <Field label="Qualification">{(id) => <Input id={id} value={f.qualification} onChange={set("qualification")} />}</Field>
            <Field label="Joining date">{(id) => <Input id={id} type="date" value={f.joiningDate} onChange={set("joiningDate")} />}</Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              {isNew ? "Add teacher" : "Save"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
