"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Empty, Input, PageHeader, Pager, Select, Spinner, StatusBadge, Table, Td } from "@/components/ui";
import { qs } from "@/lib/api";
import { date } from "@/lib/format";
import { type Page, useApi } from "@/lib/hooks";

interface Row {
  id: string;
  slug: string;
  name: string;
  email: string;
  city: string | null;
  status: string;
  createdAt: string;
  subscriptions: { status: string; currentPeriodEnd: string | null; plan: { name: string } }[];
  _count: { students: number; teachers: number };
}

export default function Institutes() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<Page<Row>>(`/platform/institutes${qs({ search, status, page, pageSize: 25 })}`);
  return (
    <>
      <PageHeader title="Institutes" description="Every coaching institute on the platform and its subscription." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input placeholder="Search name, address or email" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" aria-label="Search" />
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="max-w-48" aria-label="Status">
            <option value="">All statuses</option>
            {["ACTIVE", "PENDING_PAYMENT", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title="No institutes found" />
        ) : (
          <>
            <Table head={["Institute", "Plan", "Paid until", "Students", "Status", "Joined"]}>
              {data.items.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/admin/institutes/${i.id}`} className="font-medium text-brand-700 hover:underline">
                      {i.name}
                    </Link>
                    <div className="text-xs text-slate-500">{i.slug} · {i.email}</div>
                  </Td>
                  <Td>{i.subscriptions[0]?.plan.name ?? "—"}</Td>
                  <Td>{date(i.subscriptions[0]?.currentPeriodEnd)}</Td>
                  <Td className="tabular-nums">{i._count.students}</Td>
                  <Td>
                    <StatusBadge status={i.status} />
                  </Td>
                  <Td>{date(i.createdAt)}</Td>
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
