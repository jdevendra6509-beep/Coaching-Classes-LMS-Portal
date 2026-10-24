import { BadgeCheck, ShieldAlert, ShieldX } from "lucide-react";
import { date } from "@/lib/format";
import { publicGet } from "@/lib/server";

export const metadata = { title: "Verify certificate" };

interface Verification {
  valid: boolean;
  revoked: boolean;
  serialNo: string;
  studentName: string;
  courseName: string;
  instituteName: string;
  completionDate: string;
  issuedAt: string;
}

/** Where the QR code on every certificate points. */
export default async function Verify({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const v = await publicGet<Verification>(`/public/certificates/${encodeURIComponent(code)}`, 0);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        {!v ? (
          <>
            <ShieldX className="mx-auto size-12 text-red-600" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold">Certificate not found</h1>
            <p className="mt-2 text-sm text-slate-600">No certificate has the code {code}. Check it was typed exactly as printed.</p>
          </>
        ) : (
          <>
            {v.valid ? <BadgeCheck className="mx-auto size-12 text-green-600" aria-hidden /> : <ShieldAlert className="mx-auto size-12 text-red-600" aria-hidden />}
            <h1 className="mt-4 text-xl font-semibold">{v.valid ? "Genuine certificate" : "This certificate has been revoked"}</h1>
            <dl className="mt-6 space-y-3 text-left text-sm">
              {[
                ["Awarded to", v.studentName],
                ["Course", v.courseName],
                ["Institute", v.instituteName],
                ["Completed", date(v.completionDate)],
                ["Issued", date(v.issuedAt)],
                ["Serial no.", v.serialNo],
              ].map(([k, val]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
