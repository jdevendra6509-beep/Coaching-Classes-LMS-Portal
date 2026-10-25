"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, CardHeader, Empty, Input, Spinner, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { date, dateTime, today } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";

type Mark = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
interface Register {
  date: string;
  takenBy: string | null;
  takenAt: string | null;
  students: { studentId: string; admissionNo: string; name: string; status: Mark | null; remark: string | null }[];
}

const MARKS: { value: Mark; label: string; on: string }[] = [
  { value: "PRESENT", label: "P", on: "bg-green-600 text-white border-green-600" },
  { value: "ABSENT", label: "A", on: "bg-red-600 text-white border-red-600" },
  { value: "LATE", label: "L", on: "bg-amber-500 text-white border-amber-500" },
  { value: "EXCUSED", label: "E", on: "bg-slate-500 text-white border-slate-500" },
];

/** The day's register: everyone defaults to present, tap to change, save once. */
export function AttendanceRegister({ batchId, startDate, endDate }: { batchId: string; startDate: string; endDate: string | null }) {
  const [day, setDay] = useState(() => {
    const t = today();
    return endDate && t > endDate.slice(0, 10) ? endDate.slice(0, 10) : t;
  });
  const path = `/batches/${batchId}/attendance/${day}`;
  const { data, isLoading } = useApi<Register>(path);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    setMarks(Object.fromEntries(data.students.map((s) => [s.studentId, s.status ?? "PRESENT"])));
    setRemarks(Object.fromEntries(data.students.map((s) => [s.studentId, s.remark ?? ""])));
  }, [data]);
  const save = useAction(
    () => api(path, { method: "PUT", json: { records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status, remark: remarks[studentId] || undefined })) } }),
    { success: "Attendance saved", invalidate: [`/batches/${batchId}/attendance`, "/students"] },
  );
  const counts = MARKS.map((m) => [m.label, Object.values(marks).filter((x) => x === m.value).length] as const);

  return (
    <Card>
      <CardHeader
        title="Attendance register"
        description={data?.takenBy ? `Saved by ${data.takenBy}, ${dateTime(data.takenAt)}. Saving again replaces it.` : "Not taken yet for this day."}
        actions={<Input type="date" aria-label="Date" value={day} min={startDate.slice(0, 10)} max={endDate?.slice(0, 10) && endDate.slice(0, 10) < today() ? endDate.slice(0, 10) : today()} onChange={(e) => setDay(e.target.value)} className="w-44" />}
      />
      {isLoading || !data ? (
        <Spinner />
      ) : !data.students.length ? (
        <Empty title="No students in this batch" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 text-sm">
            <Button size="sm" variant="secondary" onClick={() => setMarks(Object.fromEntries(data.students.map((s) => [s.studentId, "PRESENT"])))}>
              Mark all present
            </Button>
            <span className="text-slate-500">{counts.map(([l, n]) => `${l}: ${n}`).join("  ·  ")}</span>
          </div>
          <Table head={["Student", "Mark", "Remark"]}>
            {data.students.map((s) => (
              <tr key={s.studentId}>
                <Td>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.admissionNo}</div>
                </Td>
                <Td>
                  <div role="radiogroup" aria-label={`Attendance for ${s.name}`} className="flex gap-1">
                    {MARKS.map((m) => (
                      <button
                        key={m.value}
                        role="radio"
                        aria-checked={marks[s.studentId] === m.value}
                        title={m.value.toLowerCase()}
                        onClick={() => setMarks((x) => ({ ...x, [s.studentId]: m.value }))}
                        className={cn("size-9 rounded-md border text-sm font-semibold", marks[s.studentId] === m.value ? m.on : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </Td>
                <Td>
                  <Input aria-label={`Remark for ${s.name}`} className="h-9" value={remarks[s.studentId] ?? ""} onChange={(e) => setRemarks((x) => ({ ...x, [s.studentId]: e.target.value }))} />
                </Td>
              </tr>
            ))}
          </Table>
          <div className="flex justify-end border-t border-slate-100 px-5 py-4">
            <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
              Save attendance for {date(day)}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

interface Session {
  id: string;
  date: string;
  records: { studentId: string; status: Mark }[];
}

export function AttendanceHistory({ batchId, students }: { batchId: string; students: { id: string; name: string }[] }) {
  const { data } = useApi<Session[]>(`/batches/${batchId}/attendance`);
  if (!data) return <Spinner />;
  if (!data.length) return <Alert tone="blue">No attendance in the last 31 days.</Alert>;
  const days = [...data].reverse();
  return (
    <Card>
      <CardHeader title="Last 31 days" />
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-slate-500">Student</th>
              {days.map((d) => (
                <th key={d.id} className="px-1 py-2 font-medium text-slate-500">
                  {new Date(`${d.date}T00:00:00Z`).getUTCDate()}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-slate-500">%</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const marks = days.map((d) => d.records.find((r) => r.studentId === s.id)?.status);
              const counted = marks.filter((m) => m && m !== "EXCUSED").length;
              const present = marks.filter((m) => m === "PRESENT" || m === "LATE").length;
              return (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="sticky left-0 whitespace-nowrap bg-white px-4 py-1.5">{s.name}</td>
                  {marks.map((m, i) => (
                    <td key={i} className="px-1 py-1.5 text-center">
                      <span className={cn("inline-block size-5 rounded text-[10px] leading-5 font-semibold", m === "PRESENT" && "bg-green-100 text-green-700", m === "ABSENT" && "bg-red-100 text-red-700", m === "LATE" && "bg-amber-100 text-amber-800", m === "EXCUSED" && "bg-slate-100 text-slate-600")}>
                        {m?.[0] ?? "·"}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{counted ? Math.round((present / counted) * 100) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

