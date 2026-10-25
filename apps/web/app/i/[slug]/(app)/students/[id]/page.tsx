"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BillDialog } from "@/components/bill-dialog";
import { StudentForm } from "@/components/student-forms";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Empty, Field, PageHeader, Select, Spinner, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr } from "@/lib/format";
import { type Page, useAction, useApi, useHasRole } from "@/lib/hooks";
import type { AttendanceSummary, Batch, Course, FeeSummary, Student } from "@/lib/types";

interface Eligibility {
  eligible: boolean;
  reasons: string[];
  certificateId: string | null;
}

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  const canFees = useHasRole("INSTITUTE_ADMIN", "ACCOUNTANT");
  const { data: s, isLoading } = useApi<Student>(`/students/${id}`);
  const fees = useApi<FeeSummary>(canFees ? `/students/${id}/fees` : null).data;
  const attendance = useApi<AttendanceSummary[]>(`/students/${id}/attendance`).data;
  const courses = useApi<Page<Course>>(canFees ? "/courses?pageSize=200" : null).data;
  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [billing, setBilling] = useState<Student["enrollments"][number] | null>(null);
  const [cert, setCert] = useState<{ enrollmentId: string; status: Eligibility } | null>(null);

  const setActive = useAction((active: boolean) => api(`/students/${id}/${active ? "activate" : "deactivate"}`, { method: "POST" }), { success: "Updated", invalidate: ["/students"] });
  const resend = useAction(() => api(`/students/${id}/resend-invite`, { method: "POST" }), { success: "Invitation sent again" });
  const complete = useAction((eid: string) => api<{ certificate: Eligibility | null }>(`/enrollments/${eid}/complete`, { method: "POST" }), {
    success: (r) => (r.certificate?.eligible ? "Marked complete: certificate issued and emailed" : `Marked complete. Certificate pending: ${r.certificate?.reasons.join("; ") ?? "check status"}`),
    invalidate: ["/students"],
  });
  const drop = useAction((eid: string) => api(`/enrollments/${eid}/drop`, { method: "POST" }), { success: "Enrollment dropped", invalidate: ["/students", "/batches"] });
  const checkCert = useAction((eid: string) => api<Eligibility>(`/enrollments/${eid}/certificate-status`).then((status) => ({ enrollmentId: eid, status })), { onSuccess: setCert });
  const issueCert = useAction((eid: string) => api<Eligibility>(`/enrollments/${eid}/certificate`, { method: "POST" }), {
    success: (r) => (r.eligible ? "Certificate issued and emailed" : "Not issued yet"),
    onSuccess: () => setCert(null),
  });

  if (isLoading || !s) return <Spinner />;
  const u = s.membership.user;
  const feeFor = (courseId: string) => Number(courses?.items.find((c) => c.id === courseId)?.fee ?? 0);
  const billed = new Set(fees?.invoices.map((i) => i.enrollment?.id));

  return (
    <>
      <PageHeader
        title={u.name}
        description={
          <>
            {s.admissionNo} · {u.email}
            {u.phone ? ` · ${u.phone}` : ""} · {s.membership.isActive ? <StatusBadge status={u.status} /> : <Badge tone="red">deactivated</Badge>}
          </>
        }
        actions={
          isAdmin && (
            <>
              {u.status === "INVITED" && s.membership.isActive && (
                <Button variant="secondary" onClick={() => resend.mutate(undefined)} loading={resend.isPending}>
                  Resend invitation
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant={s.membership.isActive ? "danger" : "primary"} onClick={() => setActive.mutate(!s.membership.isActive)} loading={setActive.isPending}>
                {s.membership.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </>
          )
        }
      />

      {fees && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <Stat label="Billed" value={inr(fees.billed)} />
          <Stat label="Paid" value={inr(fees.paid)} />
          <Stat label="Outstanding" value={inr(fees.outstanding)} />
          <Stat label="Overdue" value={<span className={Number(fees.overdue) > 0 ? "text-red-600" : ""}>{inr(fees.overdue)}</span>} />
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader title="Courses" actions={isAdmin && <Button size="sm" onClick={() => setEnrolling(true)}>Enroll in a batch</Button>} />
          {!s.enrollments.length ? (
            <Empty title="Not enrolled in any batch" />
          ) : (
            <Table head={["Course", "Batch", "Enrolled", "Status", "Attendance", ""]}>
              {s.enrollments.map((e) => {
                const att = attendance?.find((a) => a.batchId === e.batch.id);
                return (
                  <tr key={e.id}>
                    <Td className="font-medium">{e.course.name}</Td>
                    <Td>
                      <Link href={`/batches/${e.batch.id}`} className="text-brand-700 hover:underline">
                        {e.batch.name}
                      </Link>
                    </Td>
                    <Td>{date(e.enrolledAt)}</Td>
                    <Td>
                      <StatusBadge status={e.status} />
                    </Td>
                    <Td className="tabular-nums">{att?.percentage != null ? `${att.percentage}%` : "—"}</Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-2">
                        {canFees && e.status !== "DROPPED" && !billed.has(e.id) && feeFor(e.course.id) > 0 && (
                          <Button size="sm" variant="secondary" onClick={() => setBilling(e)}>
                            Bill fee
                          </Button>
                        )}
                        {e.status === "ACTIVE" && (
                          <Button size="sm" variant="secondary" onClick={() => complete.mutate(e.id)} loading={complete.isPending && complete.variables === e.id}>
                            Mark complete
                          </Button>
                        )}
                        {isAdmin && e.status === "COMPLETED" && (
                          <Button size="sm" variant="secondary" onClick={() => checkCert.mutate(e.id)}>
                            Certificate
                          </Button>
                        )}
                        {isAdmin && e.status === "ACTIVE" && (
                          <Button size="sm" variant="ghost" onClick={() => confirm(`Drop ${u.name} from ${e.batch.name}?`) && drop.mutate(e.id)}>
                            Drop
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        {fees && (
          <Card>
            <CardHeader title="Invoices" />
            {!fees.invoices.length ? (
              <Empty title="No invoices yet" />
            ) : (
              <Table head={["Invoice", "Date", "For", "Total", "Paid", "Balance", "Status"]}>
                {fees.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <Link href={`/fees/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">
                        {i.number}
                      </Link>
                    </Td>
                    <Td>{date(i.issueDate)}</Td>
                    <Td>{i.enrollment?.course.name ?? i.lines[0]?.description}</Td>
                    <Td className="tabular-nums">{inr(i.total)}</Td>
                    <Td className="tabular-nums">{inr(i.amountPaid)}</Td>
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
            )}
          </Card>
        )}

        <Card>
          <CardHeader title="Details" />
          <dl className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
            {[
              ["Date of birth", date(s.dateOfBirth)],
              ["Parent / guardian", s.guardianName ?? "—"],
              ["Parent mobile", s.guardianPhone ?? "—"],
              ["Parent email", s.guardianEmail ?? "—"],
              ["Address", s.address ?? "—"],
              ["Added", date(s.createdAt)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-slate-500">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit student" wide>
        <StudentForm initial={s} onDone={() => setEditing(false)} />
      </Dialog>
      <EnrollDialog open={enrolling} onClose={() => setEnrolling(false)} studentId={s.id} />
      {billing && <BillDialog open onClose={() => setBilling(null)} enrollment={{ id: billing.id, course: billing.course, fee: feeFor(billing.course.id) }} />}
      <Dialog open={!!cert} onClose={() => setCert(null)} title="Certificate">
        {cert &&
          (cert.status.certificateId ? (
            <Alert tone="green">
              A certificate has been issued. <Link href="/certificates" className="font-medium underline">View certificates</Link>
            </Alert>
          ) : cert.status.eligible ? (
            <div className="space-y-4">
              <Alert tone="green">Everything is in place.</Alert>
              <Button onClick={() => issueCert.mutate(cert.enrollmentId)} loading={issueCert.isPending}>
                Issue and email certificate
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">The certificate will be issued automatically once:</p>
              <ul className="list-disc pl-5 text-sm text-slate-700">
                {cert.status.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
      </Dialog>
    </>
  );
}

function EnrollDialog({ open, onClose, studentId }: { open: boolean; onClose: () => void; studentId: string }) {
  const batches = useApi<Page<Batch>>(open ? "/batches?when=current&pageSize=200" : null).data;
  const [batchId, setBatchId] = useState("");
  const enroll = useAction(() => api("/enrollments", { method: "POST", json: { studentId, batchId } }), { success: "Enrolled", invalidate: ["/students", "/batches"], onSuccess: onClose });
  return (
    <Dialog open={open} onClose={onClose} title="Enroll in a batch">
      <div className="space-y-4">
        <Field label="Batch">
          {(id) => (
            <Select id={id} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Choose…</option>
              {batches?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.course.name}: {b.name} ({b._count.enrollments}
                  {b.capacity ? `/${b.capacity}` : ""} students)
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end">
          <Button disabled={!batchId} onClick={() => enroll.mutate(undefined)} loading={enroll.isPending}>
            Enroll
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
