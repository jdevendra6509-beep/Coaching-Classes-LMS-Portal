"use client";

import { Award } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { DEFAULT_FIELDS } from "@/components/certificate-fields";
import { Badge, Button, Card, CardHeader, Dialog, Empty, Field, Input, PageHeader, Spinner, Table, Td, Textarea } from "@/components/ui";
import { api, uploadDirect } from "@/lib/api";
import { date } from "@/lib/format";
import { type Page, useAction, useApi } from "@/lib/hooks";
import type { Certificate } from "@/lib/types";

interface Template {
  id: string;
  name: string;
  backgroundMime: string;
  courses: { id: string; name: string }[];
  _count: { certificates: number };
  updatedAt: string;
}

export default function Certificates() {
  const router = useRouter();
  const templates = useApi<Template[]>("/certificate-templates");
  const [search, setSearch] = useState("");
  const issued = useApi<Page<Certificate>>(`/certificates?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [reason, setReason] = useState("");

  const create = useAction(
    async () => {
      const ask = await api<{ uploadUrl: string; headers: Record<string, string>; uploadToken: string }>("/certificate-templates/upload-url", {
        method: "POST",
        json: { fileName: file!.name, mimeType: file!.type, sizeBytes: file!.size },
      });
      const uploadToken = await uploadDirect(ask, file!);
      return api<Template>("/certificate-templates", { method: "POST", json: { name, uploadToken, fields: DEFAULT_FIELDS } });
    },
    { success: "Design uploaded; now place the fields", invalidate: ["/certificate-templates"], onSuccess: (t) => router.push(`/certificates/templates/${t.id}`) },
  );
  const resend = useAction((c: Certificate) => api(`/certificates/${c.id}/resend`, { method: "POST" }), { success: "Certificate emailed again" });
  const revoke = useAction(() => api(`/certificates/${revoking!.id}/revoke`, { method: "POST", json: { reason } }), { success: "Certificate revoked", invalidate: ["/certificates"], onSuccess: () => setRevoking(null) });
  const download = async (c: Certificate) => window.open((await api<{ url: string }>(`/certificates/${c.id}/download`)).url, "_blank", "noopener");

  return (
    <>
      <PageHeader title="Certificates" description="Issued automatically when a teacher marks the course complete and the fees are fully paid." actions={<Button onClick={() => setCreating(true)}>New design</Button>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Designs" description="Assign a design to a course from the course's Certificate tab." />
          {templates.isLoading ? (
            <Spinner />
          ) : !templates.data?.length ? (
            <Empty title="No designs yet">Upload your certificate artwork (PDF, PNG or JPEG) and place the student&apos;s name, course, date and QR code on it.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <Award className="size-5 text-brand-600" aria-hidden />
                    <div>
                      <Link href={`/certificates/templates/${t.id}`} className="font-medium text-brand-700 hover:underline">
                        {t.name}
                      </Link>
                      <p className="text-sm text-slate-500">
                        {t.courses.length ? t.courses.map((c) => c.name).join(", ") : "Not used by any course yet"} · {t._count.certificates} issued
                      </p>
                    </div>
                  </div>
                  <Link href={`/certificates/templates/${t.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    Edit layout
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Issued" actions={<Input placeholder="Search name or serial" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" aria-label="Search certificates" />} />
          {issued.isLoading ? (
            <Spinner />
          ) : !issued.data?.items.length ? (
            <Empty title="No certificates issued yet" />
          ) : (
            <Table head={["Serial", "Student", "Course", "Issued", "Emailed", ""]}>
              {issued.data.items.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono text-xs">
                    {c.serialNo} {c.revokedAt && <Badge tone="red">revoked</Badge>}
                  </Td>
                  <Td>
                    <Link href={`/students/${c.enrollment.studentId}`} className="text-brand-700 hover:underline">
                      {c.data.studentName}
                    </Link>
                  </Td>
                  <Td>{c.data.courseName}</Td>
                  <Td>{date(c.issuedAt)}</Td>
                  <Td>{c.emailedAt ? date(c.emailedAt) : <Badge tone="amber">not yet</Badge>}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => download(c)}>
                        PDF
                      </Button>
                      <a className="inline-flex h-8 items-center px-3 text-sm text-slate-700 hover:underline" href={c.data.verificationUrl} target="_blank" rel="noopener">
                        Verify page
                      </a>
                      {!c.revokedAt && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => resend.mutate(c)}>
                            Resend
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => (setReason(""), setRevoking(c))}>
                            Revoke
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New certificate design">
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), create.mutate(undefined))}>
          <Field label="Name" hint="e.g. Course completion 2026">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Artwork" hint="Your certificate design without the student's details: PDF (first page is used), PNG or JPEG, up to 15 MB.">
            {(id) => <Input id={id} type="file" required accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={create.isPending} disabled={!file}>
              Upload and place fields
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={!!revoking} onClose={() => setRevoking(null)} title={`Revoke ${revoking?.serialNo}?`}>
        <form className="space-y-4" onSubmit={(e: FormEvent) => (e.preventDefault(), revoke.mutate(undefined))}>
          <p className="text-sm text-slate-600">The verification page will show it as revoked and the student can no longer download it. This can&apos;t be undone.</p>
          <Field label="Reason">{(id) => <Textarea id={id} required minLength={3} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end">
            <Button type="submit" variant="danger" loading={revoke.isPending}>
              Revoke certificate
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
