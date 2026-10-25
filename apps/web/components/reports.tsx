"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Card, CardHeader, Empty, Input, Spinner, Table, Td } from "@/components/ui";
import { qs } from "@/lib/api";
import { date, inr, today } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const monthStart = () => `${today().slice(0, 8)}01`;
interface Line {
  id: string | null;
  code: string | null;
  name: string;
  amount: string;
}

export function ProfitAndLoss() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { data } = useApi<{ income: Line[]; expenses: Line[]; totalIncome: string; totalExpenses: string; netProfit: string }>(`/reports/profit-and-loss${qs({ from, to })}`);
  return (
    <Card>
      <CardHeader title="Profit & loss" description="Income and expenses for the period." actions={<Range from={from} to={to} setFrom={setFrom} setTo={setTo} />} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <Section title="Income" lines={data.income} total={data.totalIncome} />
          <Section title="Expenses" lines={data.expenses} total={data.totalExpenses} />
          <div className="flex justify-between rounded-md bg-slate-50 px-4 py-3 font-semibold md:col-span-2">
            <span>{Number(data.netProfit) >= 0 ? "Net profit" : "Net loss"}</span>
            <span className={`tabular-nums ${Number(data.netProfit) < 0 ? "text-red-600" : ""}`}>{inr(data.netProfit)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

export function BalanceSheet() {
  const [asOf, setAsOf] = useState(today());
  const { data } = useApi<{ assets: Line[]; liabilities: Line[]; equity: Line[]; totalAssets: string; totalLiabilities: string; totalEquity: string; balanced: boolean }>(`/reports/balance-sheet${qs({ asOf })}`);
  return (
    <Card>
      <CardHeader title="Balance sheet" actions={<Input type="date" aria-label="As of" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-44" />} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <Section title="Assets" lines={data.assets} total={data.totalAssets} />
          <div className="space-y-6">
            <Section title="Liabilities" lines={data.liabilities} total={data.totalLiabilities} />
            <Section title="Equity" lines={data.equity} total={data.totalEquity} />
          </div>
          {!data.balanced && <div className="md:col-span-2"><Alert>The balance sheet doesn&apos;t balance. Please contact support.</Alert></div>}
        </div>
      )}
    </Card>
  );
}

export function TrialBalance({ onOpen }: { onOpen: (accountId: string) => void }) {
  const [asOf, setAsOf] = useState(today());
  const { data } = useApi<{ accounts: { id: string; code: string; name: string; debit: string; credit: string }[]; totalDebit: string; totalCredit: string }>(`/reports/trial-balance${qs({ asOf })}`);
  return (
    <Card>
      <CardHeader title="Trial balance" actions={<Input type="date" aria-label="As of" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-44" />} />
      {!data ? (
        <Spinner />
      ) : (
        <Table head={["Account", "Debit", "Credit"]}>
          {data.accounts.map((a) => (
            <tr key={a.id}>
              <Td>
                <button className="text-brand-700 hover:underline" onClick={() => onOpen(a.id)}>
                  {a.code} {a.name}
                </button>
              </Td>
              <Td className="text-right tabular-nums">{Number(a.debit) ? inr(a.debit, { symbol: false }) : ""}</Td>
              <Td className="text-right tabular-nums">{Number(a.credit) ? inr(a.credit, { symbol: false }) : ""}</Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td className="text-right tabular-nums">{inr(data.totalDebit)}</Td>
            <Td className="text-right tabular-nums">{inr(data.totalCredit)}</Td>
          </tr>
        </Table>
      )}
    </Card>
  );
}

interface AgeingRow {
  studentId?: string;
  vendorId?: string;
  name: string;
  phone?: string | null;
  admissionNo?: string;
  total: string;
  buckets: Record<string, string>;
}

export function Ageing({ kind }: { kind: "receivables" | "payables" }) {
  const { data } = useApi<{ buckets: string[]; rows: AgeingRow[]; totals: Record<string, string>; total: string }>(`/reports/${kind}-ageing`);
  if (!data) return <Spinner />;
  const label = (b: string) => (b === "current" ? "Not yet due" : `${b} days`);
  return (
    <Card>
      <CardHeader title={kind === "receivables" ? "Fees owed by students" : "Owed to vendors"} description="By how long each amount has been overdue." />
      {!data.rows.length ? (
        <Empty title="Nothing outstanding" />
      ) : (
        <Table head={[kind === "receivables" ? "Student" : "Vendor", ...data.buckets.map(label), "Total"]}>
          {data.rows.map((r) => (
            <tr key={r.studentId ?? r.vendorId}>
              <Td>
                {r.studentId ? (
                  <Link href={`/students/${r.studentId}`} className="text-brand-700 hover:underline">
                    {r.name}
                  </Link>
                ) : (
                  r.name
                )}
                {r.phone && <div className="text-xs text-slate-500">{r.phone}</div>}
              </Td>
              {data.buckets.map((b) => (
                <Td key={b} className={`text-right tabular-nums ${b !== "current" && Number(r.buckets[b]) > 0 ? "text-red-600" : ""}`}>
                  {Number(r.buckets[b]) ? inr(r.buckets[b], { symbol: false }) : "—"}
                </Td>
              ))}
              <Td className="text-right font-medium tabular-nums">{inr(r.total)}</Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Total</Td>
            {data.buckets.map((b) => (
              <Td key={b} className="text-right tabular-nums">
                {inr(data.totals[b], { symbol: false })}
              </Td>
            ))}
            <Td className="text-right tabular-nums">{inr(data.total)}</Td>
          </tr>
        </Table>
      )}
    </Card>
  );
}

export function AccountLedger({ accountId }: { accountId: string }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { data } = useApi<{ account: { code: string; name: string }; opening: string; closing: string; movements: { id: string; date: string; memo: string | null; debit: string; credit: string; balance: string }[] }>(
    accountId ? `/accounts/${accountId}/ledger${qs({ from, to })}` : null,
  );
  if (!accountId) return <Alert tone="blue">Choose an account above.</Alert>;
  if (!data) return <Spinner />;
  return (
    <Card>
      <CardHeader title={`${data.account.code} ${data.account.name}`} description={`Opening ${inr(data.opening)} · Closing ${inr(data.closing)}`} actions={<Range from={from} to={to} setFrom={setFrom} setTo={setTo} />} />
      <Table head={["Date", "Particulars", "Debit", "Credit", "Balance"]}>
        {data.movements.map((m, i) => (
          <tr key={`${m.id}-${i}`}>
            <Td className="whitespace-nowrap">{date(m.date)}</Td>
            <Td>{m.memo}</Td>
            <Td className="text-right tabular-nums">{Number(m.debit) ? inr(m.debit, { symbol: false }) : ""}</Td>
            <Td className="text-right tabular-nums">{Number(m.credit) ? inr(m.credit, { symbol: false }) : ""}</Td>
            <Td className="text-right tabular-nums">{inr(m.balance, { symbol: false })}</Td>
          </tr>
        ))}
      </Table>
      {!data.movements.length && <Empty title="No entries in this period" />}
    </Card>
  );
}

function Section({ title, lines, total }: { title: string; lines: Line[]; total: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="space-y-1 text-sm">
        {lines.map((l) => (
          <div key={`${l.code}-${l.name}`} className="flex justify-between">
            <dt>{l.name}</dt>
            <dd className="tabular-nums">{inr(l.amount, { symbol: false })}</dd>
          </div>
        ))}
        {!lines.length && <p className="text-slate-400">None</p>}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
          <dt>Total {title.toLowerCase()}</dt>
          <dd className="tabular-nums">{inr(total)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
      <span className="text-slate-400">to</span>
      <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
    </div>
  );
}
