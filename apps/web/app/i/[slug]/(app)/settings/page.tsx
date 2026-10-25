"use client";

import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { SecurityCard } from "@/components/security";
import { Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, uploadDirect } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useAction, useApi, useHasRole, useMe } from "@/lib/hooks";

interface Profile {
  name: string;
  legalName: string | null;
  email: string;
  phone: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}
interface Member {
  id: string;
  role: string;
  isActive: boolean;
  user: { id: string; name: string; email: string; status: string };
}

export default function Settings() {
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {isAdmin && <InstituteProfile />}
        {isAdmin && <Staff />}
        <SecurityCard />
      </div>
    </>
  );
}

function InstituteProfile() {
  const { slug } = useParams<{ slug: string }>();
  const { data } = useApi<Profile>("/institute");
  const storage = useApi<{ usedBytes: number; limitBytes: number | null }>("/institute/storage").data;
  const brand = useApi<{ logoUrl: string | null }>(`/public/institutes/${slug}`).data;
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setF(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? ""])));
  }, [data]);
  const save = useAction(
    () => {
      const body = { ...f };
      delete body.email;
      for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
      return api("/institute", { method: "PATCH", json: body });
    },
    { success: "Saved", invalidate: ["/institute", "/public"] },
  );
  const logo = useAction(
    async (file: File) => {
      const ask = await api<{ uploadUrl: string; headers: Record<string, string>; uploadToken: string }>("/institute/logo/upload-url", { method: "POST", json: { mimeType: file.type, sizeBytes: file.size } });
      return api("/institute/logo", { method: "POST", json: { uploadToken: await uploadDirect(ask, file) } });
    },
    { success: "Logo updated", invalidate: ["/public"] },
  );
  if (!data) return <Spinner />;
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card>
      <CardHeader title="Institute" description="Shown on invoices, receipts and your login page." />
      <form className="space-y-4 p-5" onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}>
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {brand?.logoUrl ? <img src={brand.logoUrl} alt="Logo" className="size-16 rounded border border-slate-200 object-contain" /> : <div className="flex size-16 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">No logo</div>}
          <label className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">
            {logo.isPending ? "Uploading…" : "Upload logo (PNG, JPEG or WebP, up to 2 MB)"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{(id) => <Input id={id} required value={f.name ?? ""} onChange={set("name")} />}</Field>
          <Field label="Legal name">{(id) => <Input id={id} value={f.legalName ?? ""} onChange={set("legalName")} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={f.phone ?? ""} onChange={set("phone")} />}</Field>
          <Field label="GSTIN" hint="Printed on invoices when set.">{(id) => <Input id={id} value={f.gstin ?? ""} onChange={set("gstin")} />}</Field>
          <Field label="City">{(id) => <Input id={id} value={f.city ?? ""} onChange={set("city")} />}</Field>
          <Field label="State">{(id) => <Input id={id} value={f.state ?? ""} onChange={set("state")} />}</Field>
          <Field label="PIN code">{(id) => <Input id={id} value={f.pincode ?? ""} onChange={set("pincode")} />}</Field>
          <Field label="Contact email" hint="Change via support.">{(id) => <Input id={id} value={f.email ?? ""} disabled />}</Field>
        </div>
        <Field label="Address">{(id) => <Textarea id={id} rows={2} value={f.address ?? ""} onChange={set("address")} />}</Field>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            Course files: {bytes(storage?.usedBytes)} used{storage?.limitBytes ? ` of ${bytes(storage.limitBytes)}` : ""}
          </span>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Staff() {
  const me = useMe().data!;
  const { data } = useApi<Member[]>("/institute/members");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", role: "ACCOUNTANT" });
  const add = useAction(() => api("/staff", { method: "POST", json: f }), { success: "Invitation sent", invalidate: ["/institute/members"], onSuccess: () => setOpen(false) });
  const toggle = useAction((m: Member) => api(`/staff/${m.id}/${m.isActive ? "deactivate" : "activate"}`, { method: "POST" }), { success: "Updated", invalidate: ["/institute/members"] });
  const staff = data?.filter((m) => m.role === "INSTITUTE_ADMIN" || m.role === "ACCOUNTANT");
  return (
    <Card>
      <CardHeader title="Office staff" description="Admins can do everything. Accountants handle fees, bills and reports." actions={<Button size="sm" onClick={() => setOpen(true)}>Invite</Button>} />
      {!staff ? (
        <Spinner />
      ) : (
        <Table head={["Name", "Role", "Account", ""]}>
          {staff.map((m) => (
            <tr key={m.id}>
              <Td>
                {m.user.name}
                <div className="text-xs text-slate-500">{m.user.email}</div>
              </Td>
              <Td>{m.role === "INSTITUTE_ADMIN" ? "Admin" : "Accountant"}</Td>
              <Td>{m.isActive ? <StatusBadge status={m.user.status} /> : <Badge tone="red">deactivated</Badge>}</Td>
              <Td className="text-right">
                {m.user.id !== me.user.id && (
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(m)}>
                    {m.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Invite office staff">
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), add.mutate(undefined))}>
          <Field label="Name">{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Email">{(id) => <Input id={id} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Role">
            {(id) => (
              <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="INSTITUTE_ADMIN">Admin</option>
              </Select>
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={add.isPending}>
              Send invitation
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
