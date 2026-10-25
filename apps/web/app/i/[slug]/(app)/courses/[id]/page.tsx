"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BatchForm, CourseForm } from "@/components/course-batch-forms";
import { MaterialsManager } from "@/components/materials";
import { Alert, Button, Card, CardHeader, Dialog, Empty, Field, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr } from "@/lib/format";
import { useAction, useApi, useHasRole } from "@/lib/hooks";
import type { Course } from "@/lib/types";

interface CourseDetail extends Course {
  batches: { id: string; name: string; startDate: string; endDate: string | null; capacity: number | null; _count: { enrollments: number } }[];
}
interface Template {
  id: string;
  name: string;
  courses: { id: string }[];
}

function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  const requested = useSearchParams().get("tab") as "batches" | "content" | "certificate" | null;
  const [tab, setTab] = useState(requested ?? (isAdmin ? "batches" : "content"));
  const { data: c, isLoading } = useApi<CourseDetail>(`/courses/${id}`);
  const [editing, setEditing] = useState(false);
  const [newBatch, setNewBatch] = useState(false);
  if (isLoading || !c) return <Spinner />;
  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <>
            {c.code} · {inr(c.fee)}
            {c.durationWeeks ? ` · ${c.durationWeeks} weeks` : ""} · <StatusBadge status={c.status} />
          </>
        }
        actions={isAdmin && <Button variant="secondary" onClick={() => setEditing(true)}>Edit course</Button>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(isAdmin ? [{ value: "batches" as const, label: "Batches" }] : []),
          { value: "content" as const, label: "Course content" },
          ...(isAdmin ? [{ value: "certificate" as const, label: "Certificate" }] : []),
        ]}
      />
      {tab === "batches" && (
        <Card>
          <CardHeader title="Batches" actions={<Button size="sm" onClick={() => setNewBatch(true)}>New batch</Button>} />
          {!c.batches.length ? (
            <Empty title="No batches yet" />
          ) : (
            <Table head={["Batch", "Starts", "Ends", "Students"]}>
              {c.batches.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/batches/${b.id}`} className="font-medium text-brand-700 hover:underline">
                      {b.name}
                    </Link>
                  </Td>
                  <Td>{date(b.startDate)}</Td>
                  <Td>{date(b.endDate)}</Td>
                  <Td>
                    {b._count.enrollments}
                    {b.capacity ? ` / ${b.capacity}` : ""}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === "content" && <MaterialsManager courseId={c.id} />}
      {tab === "certificate" && <CertificateTab courseId={c.id} />}
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit course" wide>
        <CourseForm initial={c} onDone={() => setEditing(false)} />
      </Dialog>
      <Dialog open={newBatch} onClose={() => setNewBatch(false)} title="New batch" wide>
        <BatchForm courseId={c.id} onDone={(b) => router.push(`/batches/${b.id}`)} />
      </Dialog>
    </>
  );
}

function CertificateTab({ courseId }: { courseId: string }) {
  const templates = useApi<Template[]>("/certificate-templates").data;
  const current = templates?.find((t) => t.courses.some((c) => c.id === courseId));
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const assign = useAction((templateId: string | null) => api(`/courses/${courseId}/certificate-template`, { method: "PUT", json: { templateId } }), {
    success: "Saved",
    invalidate: ["/certificate-templates"],
  });
  if (!templates) return <Spinner />;
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-slate-600">
        Students get this certificate by email automatically once their teacher marks the course complete and their fees are fully paid.
      </p>
      {!templates.length ? (
        <Alert tone="blue">
          No certificate designs yet. <Link href="/certificates" className="font-medium underline">Create one</Link>.
        </Alert>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Certificate design" className="w-72">
            {(id) => (
              <Select id={id} value={choice ?? current?.id ?? ""} onChange={(e) => setChoice(e.target.value)}>
                <option value="">No certificate</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button disabled={choice === undefined || choice === (current?.id ?? "")} onClick={() => assign.mutate(choice || null)} loading={assign.isPending}>
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CoursePage />
    </Suspense>
  );
}
