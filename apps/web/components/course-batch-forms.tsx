"use client";

import { type FormEvent, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { today } from "@/lib/format";
import { type Page, useAction, useApi } from "@/lib/hooks";
import type { Batch, Course, Teacher } from "@/lib/types";

export function CourseForm({ initial, onDone }: { initial?: Course; onDone: (c: Course) => void }) {
  const [f, setF] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    durationWeeks: initial?.durationWeeks ? String(initial.durationWeeks) : "",
    fee: initial ? String(Number(initial.fee)) : "",
    status: initial?.status ?? "PUBLISHED",
  });
  const save = useAction(
    () => {
      const body = { ...f, fee: Number(f.fee), durationWeeks: f.durationWeeks ? Number(f.durationWeeks) : undefined, description: f.description || undefined };
      return initial ? api<Course>(`/courses/${initial.id}`, { method: "PATCH", json: body }) : api<Course>("/courses", { method: "POST", json: body });
    },
    { success: "Saved", invalidate: ["/courses"], onSuccess: onDone },
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" hint="e.g. JEE27">{(id) => <Input id={id} required value={f.code} onChange={set("code")} />}</Field>
        <Field label="Name" className="sm:col-span-2">{(id) => <Input id={id} required value={f.name} onChange={set("name")} />}</Field>
        <Field label="Total fee (₹)">{(id) => <Input id={id} type="number" min="0" step="0.01" required value={f.fee} onChange={set("fee")} />}</Field>
        <Field label="Duration (weeks)">{(id) => <Input id={id} type="number" min="1" value={f.durationWeeks} onChange={set("durationWeeks")} />}</Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={f.status} onChange={set("status")}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description">{(id) => <Textarea id={id} rows={3} value={f.description} onChange={set("description")} />}</Field>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {initial ? "Save" : "Create course"}
        </Button>
      </div>
    </form>
  );
}

export function BatchForm({ initial, courseId, onDone }: { initial?: Batch; courseId?: string; onDone: (b: Batch) => void }) {
  const courses = useApi<Page<Course>>(initial ? null : "/courses?pageSize=200").data;
  const teachers = useApi<Page<Teacher>>("/teachers?pageSize=200").data;
  const [f, setF] = useState({
    courseId: initial?.course.id ?? courseId ?? "",
    name: initial?.name ?? "",
    startDate: initial?.startDate.slice(0, 10) ?? today(),
    endDate: initial?.endDate?.slice(0, 10) ?? "",
    schedule: initial?.schedule ?? "",
    capacity: initial?.capacity ? String(initial.capacity) : "",
  });
  const [teacherIds, setTeacherIds] = useState<string[]>(initial?.teachers.map((t) => t.teacher.id) ?? []);
  const save = useAction(
    async () => {
      const body = { name: f.name, startDate: f.startDate, endDate: f.endDate || undefined, schedule: f.schedule || undefined, capacity: f.capacity ? Number(f.capacity) : undefined };
      if (!initial) return api<Batch>("/batches", { method: "POST", json: { ...body, courseId: f.courseId, teacherIds } });
      await api(`/batches/${initial.id}`, { method: "PATCH", json: body });
      return api<Batch>(`/batches/${initial.id}/teachers`, { method: "PUT", json: { teacherIds } });
    },
    { success: "Saved", invalidate: ["/batches", "/courses"], onSuccess: onDone },
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      {!initial && (
        <Field label="Course">
          {(id) => (
            <Select id={id} required value={f.courseId} onChange={set("courseId")} disabled={!!courseId}>
              <option value="">Choose…</option>
              {courses?.items.filter((c) => c.status !== "ARCHIVED").map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}: {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Batch name" hint="e.g. Morning A">{(id) => <Input id={id} required value={f.name} onChange={set("name")} />}</Field>
        <Field label="Schedule" hint="e.g. Mon–Fri 5–7 pm">{(id) => <Input id={id} value={f.schedule} onChange={set("schedule")} />}</Field>
        <Field label="Starts">{(id) => <Input id={id} type="date" required value={f.startDate} onChange={set("startDate")} />}</Field>
        <Field label="Ends">{(id) => <Input id={id} type="date" min={f.startDate} value={f.endDate} onChange={set("endDate")} />}</Field>
        <Field label="Seats">{(id) => <Input id={id} type="number" min="1" value={f.capacity} onChange={set("capacity")} />}</Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Teachers</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {teachers?.items.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={teacherIds.includes(t.id)} onChange={(e) => setTeacherIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))} />
              {t.membership.user.name}
            </label>
          ))}
          {!teachers?.items.length && <p className="text-sm text-slate-500">Add teachers first.</p>}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {initial ? "Save" : "Create batch"}
        </Button>
      </div>
    </form>
  );
}
