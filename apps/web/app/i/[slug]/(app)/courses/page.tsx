"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CourseForm } from "@/components/course-batch-forms";
import { Button, Card, Dialog, Empty, Input, PageHeader, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { inr } from "@/lib/format";
import { type Page, useApi, useHasRole } from "@/lib/hooks";
import type { Course } from "@/lib/types";

export default function Courses() {
  const router = useRouter();
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApi<Page<Course>>(`/courses?pageSize=200${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  return (
    <>
      <PageHeader title="Courses" actions={isAdmin && <Button onClick={() => setOpen(true)}>New course</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Input placeholder="Search courses" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" aria-label="Search courses" />
        </div>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title="No courses yet" />
        ) : (
          <Table head={["Course", "Fee", "Duration", "Batches", "Students", "Status"]}>
            {data.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/courses/${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs text-slate-500">{c.code}</div>
                </Td>
                <Td className="tabular-nums">{inr(c.fee)}</Td>
                <Td>{c.durationWeeks ? `${c.durationWeeks} weeks` : "—"}</Td>
                <Td>{c._count.batches}</Td>
                <Td>{c._count.enrollments}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title="New course" wide>
        <CourseForm onDone={(c) => router.push(`/courses/${c.id}`)} />
      </Dialog>
    </>
  );
}
