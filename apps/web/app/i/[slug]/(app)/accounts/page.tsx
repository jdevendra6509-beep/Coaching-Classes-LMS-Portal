"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Bills, ChartOfAccounts, Journals } from "@/components/payables";
import { AccountLedger, Ageing, BalanceSheet, ProfitAndLoss, TrialBalance } from "@/components/reports";
import { PageHeader, Select, Tabs } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { Account } from "@/lib/types";

type Tab = "pl" | "bs" | "tb" | "ar" | "bills" | "ap" | "journal" | "ledger" | "chart";

function AccountsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "pl");
  const [accountId, setAccountId] = useState(params.get("account") ?? "");
  const accounts = useApi<Account[]>(tab === "ledger" ? "/accounts" : null).data;
  return (
    <>
      <PageHeader title="Accounts" />
      <div className="overflow-x-auto">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "pl", label: "Profit & loss" },
            { value: "bs", label: "Balance sheet" },
            { value: "ar", label: "Fees owed" },
            { value: "bills", label: "Bills" },
            { value: "ap", label: "Owed to vendors" },
            { value: "journal", label: "Day book" },
            { value: "ledger", label: "Account ledger" },
            { value: "tb", label: "Trial balance" },
            { value: "chart", label: "Chart of accounts" },
          ]}
        />
      </div>
      {tab === "pl" && <ProfitAndLoss />}
      {tab === "bs" && <BalanceSheet />}
      {tab === "tb" && <TrialBalance onOpen={(id) => (setAccountId(id), setTab("ledger"))} />}
      {tab === "ar" && <Ageing kind="receivables" />}
      {tab === "ap" && <Ageing kind="payables" />}
      {tab === "bills" && <Bills />}
      {tab === "journal" && <Journals />}
      {tab === "chart" && <ChartOfAccounts onOpen={(id) => (setAccountId(id), setTab("ledger"))} />}
      {tab === "ledger" && (
        <div className="space-y-4">
          <Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="max-w-sm">
            <option value="">Choose an account…</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
          <AccountLedger accountId={accountId} />
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AccountsPage />
    </Suspense>
  );
}
