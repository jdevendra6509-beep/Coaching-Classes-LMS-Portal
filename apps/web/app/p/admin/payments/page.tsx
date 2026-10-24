"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Empty, PageHeader, Pager, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { qs } from "@/lib/api";
import { date, inr } from "@/lib/format";
import { type Page, useApi } from "@/lib/hooks";

interface Payment {
  id: string;
  amount: string;
  gstAmount: string;
  status: string;
  paidAt: string | null;
  periodStart: string;
  periodEnd: string;
  razorpayPaymentId: string | null;
  institute: { id: string; slug: string; name: string };
}

export default function Payments() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<Page<Payment>>(`/platform/payments${qs({ page })}`);
  return (
    <>
      <PageHeader title="Subscription payments" description="Captured via Razorpay. Reconcile against Razorpay settlements for fees and GST." />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title="No payments yet" />
        ) : (
          <>
            <Table head={["Paid", "Institute", "Period", "Amount", "GST", "Status"]}>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <Td>{date(p.paidAt)}</Td>
                  <Td>
                    <Link href={`/admin/institutes/${p.institute.id}`} className="text-brand-700 hover:underline">
                      {p.institute.name}
                    </Link>
                  </Td>
                  <Td>
                    {date(p.periodStart)} – {date(p.periodEnd)}
                  </Td>
                  <Td className="tabular-nums">{inr(p.amount)}</Td>
                  <Td className="tabular-nums">{inr(p.gstAmount)}</Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
