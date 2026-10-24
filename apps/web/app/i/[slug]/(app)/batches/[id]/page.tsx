"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AttendanceHistory, AttendanceRegister } from "@/components/attendance";
import { BatchForm } from "@/components/course-batch-forms";
import { Button, Card, CardHeader, Dialog, Empty, Input, PageHeader, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { type Page, useAction, useApi, useHasRole } from "@/lib/hooks";
import type { Batch, Student } from "@/lib/types";

interface RosterRow {
  id: string;
  status: string;
  enrolledAt: string;
  completedAt: string | null;
  student: { id: string; admissionNo: string; membership: { isActive: boolean; user: { name: string; email: string; phone: string | null } } };
}

function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  const requested = useSearchParams().get("tab") as "students" | "attendance" | "history" | null;
  const [tab, setTab] = useState(requested ?? "students");
  const { data: b } = useApi<Batch>(`/batches/${id}`);
  const roster = useApi<RosterRow[]>(`/batches/${id}/students`);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const complete = useAction((eid: string) => api<{ certificate: { eligible: boolean; reasons: string[] } | null }>(`/enrollments/${eid}/complete`, { method: "POST" }), {
    success: (r) => (r.certificate?.eligible ? "Marked complete: certificate issued and emailed" : `Marked complete. Certificate pending: ${r.certificate?.reasons.join("; ") ?? ""}`),
    invalidate: [`/batches/${id}`],
  });

  if (!b) return <Spinner />;
  const active = roster.data?.filter((r) => r.status !== "DROPPED") ?? [];
  return (
    <>
      <PageHeader
        title={b.name}
        description={
          <>
            <Link href={`/courses/${b.course.id}`} className="text-brand-700 hover:underline">
              {b.course.name}
            </Link>
            {b.schedule ? ` · ${b.schedule}` : ""} · {date(b.startDate)} – {b.endDate ? date(b.endDate) : "open"} · Teachers:{" "}
            {b.teachers.map((t) => t.teacher.membership.user.name).join(", ") || "none"}
          </>
        }
        actions={isAdmin && <Button variant="secondary" onClick={() => setEditing(true)}>Edit batch</Button>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "students", label: `Students (${active.length})` },
          { value: "attendance", label: "Take attendance" },
          { value: "history", label: "Attendance history" },
        ]}
      />
      {tab === "students" && (
        <Card>
          <CardHeader title="Students" actions={isAdmin && <Button size="sm" onClick={() => setAdding(true)}>Add students</Button>} />
          {roster.isLoading ? (
            <Spinner />
          ) : !roster.data?.length ? (
            <Empty title="No students yet" />
          ) : (
            <Table head={["Student", "Admission no.", "Enrolled", "Status", ""]}>
              {roster.data.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/students/${r.student.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.student.membership.user.name}
                    </Link>
                    <div className="text-xs text-slate-500">{r.student.membership.user.phone ?? r.student.membership.user.email}</div>
                  </Td>
                  <Td className="font-mono text-xs">{r.student.admissionNo}</Td>
                  <Td>{date(r.enrolledAt)}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td className="text-right">
                    {r.status === "ACTIVE" && (
                      <Button size="sm" variant="secondary" onClick={() => confirm(`Mark ${r.student.membership.user.name} as having completed ${b.course.name}?`) && complete.mutate(r.id)}>
                        Mark course complete
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === "attendance" && <AttendanceRegister batchId={b.id} startDate={b.startDate} endDate={b.endDate} />}
      {tab === "history" && <AttendanceHistory batchId={b.id} students={active.map((r) => ({ id: r.student.id, name: r.student.membership.user.name }))} />}

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit batch" wide>
        <BatchForm initial={b} onDone={() => setEditing(false)} />
      </Dialog>
      <AddStudents open={adding} onClose={() => setAdding(false)} batchId={b.id} existing={new Set(roster.data?.filter((r) => r.status !== "DROPPED").map((r) => r.student.id))} />
    </>
  );
}

function AddStudents({ open, onClose, batchId, existing }: { open: boolean; onClose: () => void; batchId: string; existing: Set<string> }) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const { data } = useApi<Page<Student>>(open ? `/students?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ""}` : null);
  const enroll = useAction(() => api<{ enrolled: number }>(`/batches/${batchId}/enrollments`, { method: "POST", json: { studentIds: picked } }), {
    success: (r) => `Enrolled ${r.enrolled} student(s)`,
    invalidate: [`/batches/${batchId}`, "/students"],
    onSuccess: () => (setPicked([]), onClose()),
  });
  const candidates = data?.items.filter((s) => !existing.has(s.id)) ?? [];
  return (
    <Dialog open={open} onClose={onClose} title="Add students to batch" wide>
      <div className="space-y-3">
        <Input placeholder="Search students" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {candidates.map((s) => (
            <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
              <span className="font-medium">{s.membership.user.name}</span>
              <span className="text-slate-500">{s.admissionNo}</span>
            </label>
          ))}
          {!candidates.length && <p className="p-4 text-sm text-slate-500">No students to add.</p>}
        </div>
        <div className="flex justify-end">
          <Button disabled={!picked.length} onClick={() => enroll.mutate(undefined)} loading={enroll.isPending}>
            Enroll {picked.length || ""} student{picked.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function Page() {
  return (
    <Suspense>
      <BatchPage />
    </Suspense>
  );
}
