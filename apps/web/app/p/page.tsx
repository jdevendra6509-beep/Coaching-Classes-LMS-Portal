import { Award, BookOpen, CalendarCheck, IndianRupee } from "lucide-react";
import Link from "next/link";
import { inr } from "@/lib/format";
import { publicGet } from "@/lib/server";

interface Plan {
  code: string;
  name: string;
  pricePerMonth: string;
  maxStudents: number;
  maxStorageMb: number;
  gstRate: number;
}

const FEATURES = [
  { icon: BookOpen, title: "Courses & study material", text: "Batches, teachers and course files students can open only while enrolled." },
  { icon: CalendarCheck, title: "Attendance", text: "Teachers mark the day's register in seconds; students and parents see their percentage." },
  { icon: IndianRupee, title: "Fees & full accounts", text: "Invoices with GST, instalments, discounts, receipts, vendor bills, P&L and balance sheet." },
  { icon: Award, title: "Certificates", text: "Your own design, issued automatically once the course is complete and fees are paid." },
];

export default async function Landing() {
  const plans = (await publicGet<Plan[]>("/plans")) ?? [];
  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold">Coaching LMS</span>
        <div className="flex gap-3 text-sm">
          <Link href="/login" className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">
            Platform sign in
          </Link>
          <Link href="/signup" className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
            Start your institute
          </Link>
        </div>
      </header>
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Run your coaching institute in one place</h1>
        <p className="mt-4 text-lg text-slate-600">
          Students, teachers, course material, attendance, fees and certificates, each institute on its own secure address.
        </p>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-slate-200 p-5">
            <f.icon className="size-6 text-brand-600" aria-hidden />
            <h2 className="mt-3 font-medium">{f.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{f.text}</p>
          </div>
        ))}
      </section>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-2xl font-semibold">Plans</h2>
        <p className="mt-1 text-center text-sm text-slate-500">Billed monthly in advance. Prices exclude GST.</p>
        {plans.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500">Plans will appear here once they are published.</p>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <div key={p.code} className="flex flex-col rounded-lg border border-slate-200 p-6">
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-2 text-3xl font-semibold">
                  {inr(p.pricePerMonth)}
                  <span className="text-sm font-normal text-slate-500"> / month + {p.gstRate}% GST</span>
                </p>
                <ul className="mt-4 flex-1 space-y-1 text-sm text-slate-600">
                  <li>Up to {p.maxStudents.toLocaleString("en-IN")} active students</li>
                  <li>{p.maxStorageMb >= 1024 ? `${Math.round(p.maxStorageMb / 1024)} GB` : `${p.maxStorageMb} MB`} of course files</li>
                  <li>Unlimited teachers and courses</li>
                </ul>
                <Link href={`/signup?plan=${p.code}`} className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-700">
                  Choose {p.name}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
