"use client";

import { ArrowRight, BookOpen, CalendarCheck, GraduationCap, IndianRupee } from "lucide-react";
import Link from "next/link";
import { Alert, Badge, Card, CardHeader, Empty, PageHeader, Spinner, Stat, Table, Td } from "@/components/ui";
import { dateTime, inr, titleCase } from "@/lib/format";
import { type Page, useApi, useMe } from "@/lib/hooks";
import type { AttendanceSummary, Batch, FeeSummary } from "@/lib/types";

export default function Home() {
  const me = useMe().data!;
  const is = (r: string) => me.roles.includes(r as never);
  return (
    <>
      <PageHeader title={`Hello, ${me.user.name.split(" ")[0]}`} description={me.institute!.name} />
      <div className="space-y-8">
        {(is("INSTITUTE_ADMIN") || is("ACCOUNTANT")) && <OfficeHome showPeople={is("INSTITUTE_ADMIN")} />}
        {is("TEACHER") && <TeacherHome />}
        {is("STUDENT") && <StudentHome />}
      </div>
    </>
  );
}

interface Ageing {
  total: string;
  totals: Record<string, string>;
}
interface Collections {
  total: string;
  count: number;
}
interface PaymentRow {
  id: string;
  receiptNo: string;
  amount: string;
  method: string;
  receivedAt: string;
  reversedAt: string | null;
  student: { membership: { user: { name: string } } };
  invoice: { id: string; number: string };
}

function OfficeHome({ showPeople }: { showPeople: boolean }) {
  const students = useApi<Page<unknown>>(showPeople ? "/students?pageSize=1" : null).data;
  const courses = useApi<Page<unknown>>(showPeople ? "/courses?status=PUBLISHED&pageSize=1" : null).data;
  const collections = useApi<Collections>("/reports/collections").data;
  const ageing = useApi<Ageing>("/reports/receivables-ageing").data;
  const payments = useApi<Page<PaymentRow>>("/payments?pageSize=6");
  const overdue = ageing ? Number(ageing.total) - Number(ageing.totals.current) : null;

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {showPeople && <Stat label="Active students" value={students?.total ?? "…"} />}
        {showPeople && <Stat label="Published courses" value={courses?.total ?? "…"} />}
        <Stat label="Collected this month" value={collections ? inr(collections.total) : "…"} hint={collections && `${collections.count} receipts`} />
        <Stat label="Fees outstanding" value={ageing ? inr(ageing.total) : "…"} hint={overdue !== null && <span className={overdue > 0 ? "text-red-600" : ""}>{inr(overdue)} overdue</span>} />
      </div>
      <Card>
        <CardHeader
          title="Recent fee receipts"
          actions={
            <Link href="/fees" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              All fees <ArrowRight className="size-4" />
            </Link>
          }
        />
        {payments.isLoading ? (
          <Spinner />
        ) : !payments.data?.items.length ? (
          <Empty title="No payments recorded yet" />
        ) : (
          <Table head={["Receipt", "Student", "Amount", "Mode", "When"]}>
            {payments.data.items.map((p) => (
              <tr key={p.id}>
                <Td>
                  <Link href={`/fees/invoices/${p.invoice.id}`} className="text-brand-700 hover:underline">
                    {p.receiptNo}
                  </Link>
                  {p.reversedAt && <Badge tone="red">reversed</Badge>}
                </Td>
                <Td>{p.student.membership.user.name}</Td>
                <Td className="tabular-nums">{inr(p.amount)}</Td>
                <Td>{titleCase(p.method)}</Td>
                <Td>{dateTime(p.receivedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {showPeople && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { href: "/students", icon: GraduationCap, label: "Add or import students" },
            { href: "/courses", icon: BookOpen, label: "Set up courses and batches" },
            { href: "/fees", icon: IndianRupee, label: "Bill and collect fees" },
          ].map((q) => (
            <Link key={q.href} href={q.href} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm font-medium shadow-sm hover:border-brand-500">
              <q.icon className="size-5 text-brand-600" aria-hidden /> {q.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function TeacherHome() {
  const { data, isLoading } = useApi<Page<Batch>>("/batches?when=current");
  return (
    <Card>
      <CardHeader title="Your batches" description="Take today's attendance or manage course content." />
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Empty title="No batches assigned yet">Your institute admin assigns teachers to batches.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-medium">{b.name}</p>
                <p className="text-sm text-slate-500">
                  {b.course.name} · {b._count.enrollments} students{b.schedule ? ` · ${b.schedule}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/batches/${b.id}?tab=attendance`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
                  <CalendarCheck className="size-4" aria-hidden /> Attendance
                </Link>
                <Link href={`/courses/${b.course.id}?tab=content`} className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50">
                  Course content
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface MyEnrollment {
  id: string;
  status: string;
  enrolledAt: string;
  course: { id: string; code: string; name: string; description: string | null };
  batch: { id: string; name: string; schedule: string | null; startDate: string; teachers: { teacher: { membership: { user: { name: string } } } }[] };
}

function StudentHome() {
  const enrollments = useApi<MyEnrollment[]>("/me/enrollments");
  const attendance = useApi<AttendanceSummary[]>("/me/attendance").data;
  const fees = useApi<FeeSummary>("/me/fees").data;
  return (
    <section className="space-y-6">
      {fees && Number(fees.overdue) > 0 && (
        <Alert tone="amber">
          {inr(fees.overdue)} of your fees is overdue. <Link href="/my/fees" className="font-medium underline">See details</Link>
        </Alert>
      )}
      <h2 className="text-lg font-semibold">Your courses</h2>
      {enrollments.isLoading ? (
        <Spinner />
      ) : !enrollments.data?.length ? (
        <Card>
          <Empty title="You're not enrolled in any course yet" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {enrollments.data.map((e) => {
            const att = attendance?.find((a) => a.batchId === e.batch.id);
            return (
              <Link key={e.id} href={`/my/courses/${e.course.id}`} className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-500">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{e.course.name}</h3>
                  {e.status === "COMPLETED" && <Badge tone="blue">completed</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {e.batch.name}
                  {e.batch.schedule ? ` · ${e.batch.schedule}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-500">Teachers: {e.batch.teachers.map((t) => t.teacher.membership.user.name).join(", ") || "—"}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span>
                    Attendance: <strong>{att?.percentage != null ? `${att.percentage}%` : "—"}</strong>
                    {att && att.total > 0 && <span className="text-slate-500"> ({att.present + att.late}/{att.total - att.excused} classes)</span>}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-brand-700">
                    Study material <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {fees && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Fees billed" value={inr(fees.billed)} />
          <Stat label="Paid" value={inr(fees.paid)} />
          <Stat label="Outstanding" value={inr(fees.outstanding)} hint={<Link href="/my/fees" className="text-brand-700 hover:underline">Invoices and receipts</Link>} />
        </div>
      )}
    </section>
  );
}
