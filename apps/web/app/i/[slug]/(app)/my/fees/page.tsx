"use client";

import { FileDown } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Spinner, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { openPdf } from "@/lib/api";
import { date, inr, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { FeeSummary } from "@/lib/types";

export default function MyFees() {
  const { data } = useApi<FeeSummary>("/me/fees");
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader title="My fees" description="Pay at the institute office; your receipt is emailed and appears here." />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Billed" value={inr(data.billed)} />
        <Stat label="Paid" value={inr(data.paid)} />
        <Stat label="Outstanding" value={inr(data.outstanding)} />
        <Stat label="Overdue" value={<span className={Number(data.overdue) > 0 ? "text-red-600" : ""}>{inr(data.overdue)}</span>} />
      </div>
      {!data.invoices.length ? (
        <Card>
          <Empty title="No invoices yet" />
        </Card>
      ) : (
        <div className="space-y-6">
          {data.invoices.map((inv) => (
            <Card key={inv.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {inv.number} <StatusBadge status={inv.status} />
                  </span>
                }
                description={`${inv.enrollment?.course.name ?? inv.lines[0]?.description} · issued ${date(inv.issueDate)}`}
                actions={
                  <Button size="sm" variant="secondary" onClick={() => openPdf(`/me/invoices/${inv.id}/pdf`)}>
                    <FileDown className="size-4" aria-hidden /> Invoice PDF
                  </Button>
                }
              />
              <div className="grid gap-6 p-5 md:grid-cols-2">
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt>Total</dt><dd className="tabular-nums">{inr(inv.total)}</dd></div>
                  <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">{inr(inv.amountPaid)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>Balance</dt><dd className="tabular-nums">{inr(inv.outstanding)}</dd></div>
                  {Number(inv.overdue) > 0 && <div className="flex justify-between text-red-600"><dt>Overdue</dt><dd className="tabular-nums">{inr(inv.overdue)}</dd></div>}
                </dl>
                {inv.installments.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {inv.installments.map((s, i) => (
                      <li key={i} className="flex justify-between">
                        <span>Instalment {i + 1} due {date(s.dueDate)}</span>
                        <span className="tabular-nums">{inr(s.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {inv.payments.length > 0 && (
                <Table head={["Receipt", "Date", "Amount", "Mode", ""]}>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        {p.receiptNo} {p.reversedAt && <Badge tone="red">reversed</Badge>}
                      </Td>
                      <Td>{date(p.receivedAt)}</Td>
                      <Td className="tabular-nums">{inr(p.amount)}</Td>
                      <Td>{titleCase(p.method)}</Td>
                      <Td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openPdf(`/me/payments/${p.id}/receipt.pdf`)}>
                          Receipt
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
