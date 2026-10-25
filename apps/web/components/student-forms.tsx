"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Field, Input, Select, Table, Td, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useApi, type Page } from "@/lib/hooks";
import type { Batch, Student } from "@/lib/types";

const EMPTY = { name: "", email: "", phone: "", admissionNo: "", dateOfBirth: "", guardianName: "", guardianPhone: "", guardianEmail: "", address: "", batchId: "" };

export function StudentForm({ initial, onDone }: { initial?: Student; onDone: (s: Student) => void }) {
  const editing = !!initial;
  const [f, setF] = useState(
    initial
      ? {
          ...EMPTY,
          name: initial.membership.user.name,
          phone: initial.membership.user.phone ?? "",
          dateOfBirth: initial.dateOfBirth?.slice(0, 10) ?? "",
          guardianName: initial.guardianName ?? "",
          guardianPhone: initial.guardianPhone ?? "",
          guardianEmail: initial.guardianEmail ?? "",
          address: initial.address ?? "",
        }
      : EMPTY,
  );
  const batches = useApi<Page<Batch>>(editing ? null : "/batches?when=current&pageSize=200").data;
  const canRename = !initial || initial.membership.user.status === "INVITED";
  const save = useAction(
    () => {
      const body: Record<string, string | undefined> = { ...f };
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = undefined;
      if (editing) {
        delete body.email;
        delete body.batchId;
        delete body.admissionNo;
        if (!canRename) delete body.name;
        if (!canRename) delete body.phone;
      }
      return editing ? api<Student>(`/students/${initial!.id}`, { method: "PATCH", json: body }) : api<Student>("/students", { method: "POST", json: body });
    },
    { success: editing ? "Saved" : "Student added and invited by email", invalidate: ["/students", "/batches"], onSuccess: onDone },
  );
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" hint={!canRename ? "The student manages their own name now." : undefined}>
          {(id) => <Input id={id} required disabled={!canRename} value={f.name} onChange={set("name")} />}
        </Field>
        {!editing && <Field label="Email" hint="Login details are sent here.">{(id) => <Input id={id} type="email" required value={f.email} onChange={set("email")} />}</Field>}
        <Field label="Mobile">{(id) => <Input id={id} type="tel" disabled={!canRename} pattern="\+?[0-9]{10,13}" value={f.phone} onChange={set("phone")} />}</Field>
        {!editing && <Field label="Admission no." hint="Leave blank to number automatically.">{(id) => <Input id={id} value={f.admissionNo} onChange={set("admissionNo")} />}</Field>}
        <Field label="Date of birth">{(id) => <Input id={id} type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} />}</Field>
        <Field label="Parent / guardian name">{(id) => <Input id={id} value={f.guardianName} onChange={set("guardianName")} />}</Field>
        <Field label="Parent mobile">{(id) => <Input id={id} type="tel" pattern="\+?[0-9]{10,13}" value={f.guardianPhone} onChange={set("guardianPhone")} />}</Field>
        <Field label="Parent email" hint="Gets fee receipts and certificates too.">{(id) => <Input id={id} type="email" value={f.guardianEmail} onChange={set("guardianEmail")} />}</Field>
      </div>
      <Field label="Address">{(id) => <Textarea id={id} rows={2} value={f.address} onChange={set("address")} />}</Field>
      {!editing && (
        <Field label="Enroll in batch (optional)">
          {(id) => (
            <Select id={id} value={f.batchId} onChange={set("batchId")}>
              <option value="">Not now</option>
              {batches?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.course.name}: {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {editing ? "Save" : "Add student"}
        </Button>
      </div>
    </form>
  );
}

interface ImportResult {
  rows: number;
  imported: number;
  valid: boolean;
  errors: { row: number; field?: string; message: string }[];
}

const SAMPLE = "name,email,phone,admission no,dob,parent name,parent phone,parent email,batch\nAsha Rao,asha@example.com,9876543210,,2010-05-04,Ravi Rao,9876500000,ravi@example.com,JEE Morning A\n";

export function ImportStudents({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [check, setCheck] = useState<ImportResult | null>(null);
  const validate = useAction(() => api<ImportResult>("/students/import", { method: "POST", json: { csv, dryRun: true } }), { onSuccess: setCheck });
  const run = useAction(() => api<ImportResult>("/students/import", { method: "POST", json: { csv } }), {
    success: (r) => `Imported ${r.imported} students; invitations are on their way`,
    invalidate: ["/students", "/batches"],
    onSuccess: onDone,
  });

  async function readFile(file: File | undefined) {
    if (!file) return;
    setCsv(await file.text());
    setCheck(null);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Upload a CSV with a header row. <strong>name</strong> and <strong>email</strong> are required; you can also include phone, admission no, dob (YYYY-MM-DD), parent
        name/phone/email, address and batch (its exact name, to enroll).{" "}
        <a className="text-brand-700 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="students-template.csv">
          Download a template
        </a>
      </p>
      <Input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} aria-label="CSV file" />
      {csv && (
        <>
          <p className="text-sm text-slate-500">{csv.trim().split(/\r?\n/).length - 1} data rows</p>
          {check && check.valid && <Alert tone="green">All {check.rows} rows look good. Nothing has been imported yet.</Alert>}
          {check && !check.valid && (
            <>
              <Alert>Fix these {check.errors.length} problem(s) in your file and upload it again. Nothing was imported.</Alert>
              <Table head={["Line", "Column", "Problem"]}>
                {check.errors.map((e, i) => (
                  <tr key={i}>
                    <Td>{e.row || "—"}</Td>
                    <Td>{e.field ?? "—"}</Td>
                    <Td>{e.message}</Td>
                  </tr>
                ))}
              </Table>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => validate.mutate(undefined)} loading={validate.isPending}>
              Check file
            </Button>
            <Button onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={!check?.valid}>
              Import {check?.valid ? check.rows : ""} students
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
