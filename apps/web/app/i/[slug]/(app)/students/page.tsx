"use client";

import { Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImportStudents, StudentForm } from "@/components/student-forms";
import { Badge, Button, Card, Dialog, Empty, Input, PageHeader, Pager, Select, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { qs } from "@/lib/api";
import { type Page, useApi, useHasRole } from "@/lib/hooks";
import type { Batch, Student } from "@/lib/types";

export default function Students() {
  const router = useRouter();
  const isAdmin = useHasRole("INSTITUTE_ADMIN");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [batchId, setBatchId] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<"add" | "import" | null>(null);
  const batches = useApi<Page<Batch>>("/batches?pageSize=200").data;
  const { data, isLoading } = useApi<Page<Student>>(`/students${qs({ search, status, batchId, page, pageSize: 25 })}`);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));

  return (
    <>
      <PageHeader
        title="Students"
        actions={
          isAdmin && (
            <>
              <Button variant="secondary" onClick={() => setDialog("import")}>
                <Upload className="size-4" aria-hidden /> Import CSV
              </Button>
              <Button onClick={() => setDialog("add")}>
                <UserPlus className="size-4" aria-hidden /> Add student
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input placeholder="Search name, email, phone, admission no." value={search} onChange={(e) => reset(setSearch)(e.target.value)} className="max-w-sm" aria-label="Search students" />
          <Select value={batchId} onChange={(e) => reset(setBatchId)(e.target.value)} className="max-w-60" aria-label="Batch">
            <option value="">All batches</option>
            {batches?.items.map((b) => (
              <option key={b.id} value={b.id}>
                {b.course.code}: {b.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className="max-w-40" aria-label="Status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title={search ? "No students match" : "No students yet"}>{isAdmin && !search && "Add students one by one or import a CSV."}</Empty>
        ) : (
          <>
            <Table head={["Student", "Admission no.", "Courses", "Parent", "Account"]}>
              {data.items.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/students/${s.id}`)}>
                  <Td>
                    <Link href={`/students/${s.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {s.membership.user.name}
                    </Link>
                    <div className="text-xs text-slate-500">{s.membership.user.email}</div>
                  </Td>
                  <Td className="font-mono text-xs">{s.admissionNo}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {s.enrollments.filter((e) => e.status !== "DROPPED").map((e) => (
                        <Badge key={e.id} tone={e.status === "COMPLETED" ? "blue" : "slate"}>
                          {e.course.code}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {s.guardianName ?? "—"}
                    {s.guardianPhone && <div className="text-xs text-slate-500">{s.guardianPhone}</div>}
                  </Td>
                  <Td>{s.membership.isActive ? <StatusBadge status={s.membership.user.status} /> : <Badge tone="red">deactivated</Badge>}</Td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Dialog open={dialog === "add"} onClose={() => setDialog(null)} title="Add student" wide>
        <StudentForm onDone={(s) => (setDialog(null), router.push(`/students/${s.id}`))} />
      </Dialog>
      <Dialog open={dialog === "import"} onClose={() => setDialog(null)} title="Import students" wide>
        <ImportStudents onDone={() => setDialog(null)} />
      </Dialog>
    </>
  );
}
