"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BatchForm } from "@/components/course-batch-forms";
import { Button, Card, Dialog, Empty, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { date } from "@/lib/format";
import { type Page, useApi, useHasRole } from "@/lib/hooks";
import type { Batch } from "@/lib/types";

export default function Batches() {
  const router = useRouter();
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  const [when, setWhen] = useState("current");
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApi<Page<Batch>>(`/batches?when=${when}&pageSize=200`);
  return (
    <>
      <PageHeader title="Batches & attendance" description={isAdmin ? undefined : "The batches you teach."} actions={isAdmin && <Button onClick={() => setOpen(true)}>New batch</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select value={when} onChange={(e) => setWhen(e.target.value)} className="max-w-48" aria-label="Show">
            <option value="current">Running and upcoming</option>
            <option value="ended">Ended</option>
            <option value="all">All</option>
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title="No batches" />
        ) : (
          <Table head={["Batch", "Course", "Schedule", "Dates", "Teachers", "Students", ""]}>
            {data.items.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/batches/${b.id}`} className="font-medium text-brand-700 hover:underline">
                    {b.name}
                  </Link>
                </Td>
                <Td>{b.course.name}</Td>
                <Td>{b.schedule ?? "—"}</Td>
                <Td className="whitespace-nowrap">
                  {date(b.startDate)} – {b.endDate ? date(b.endDate) : "open"}
                </Td>
                <Td>{b.teachers.map((t) => t.teacher.membership.user.name).join(", ") || "—"}</Td>
                <Td>
                  {b._count.enrollments}
                  {b.capacity ? ` / ${b.capacity}` : ""}
                </Td>
                <Td>
                  <Link href={`/batches/${b.id}?tab=attendance`} className="text-sm font-medium text-brand-700 hover:underline">
                    Attendance
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title="New batch" wide>
        <BatchForm onDone={(b) => router.push(`/batches/${b.id}`)} />
      </Dialog>
    </>
  );
}
