"use client";

import { Award } from "lucide-react";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { date } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Certificate } from "@/lib/types";

export default function MyCertificates() {
  const { data } = useApi<Certificate[]>("/me/certificates");
  const toast = useToast();
  const download = (c: Certificate) =>
    api<{ url: string }>(`/me/certificates/${c.id}/download`)
      .then((r) => window.open(r.url, "_blank", "noopener"))
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "Couldn't download"));
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader title="My certificates" description="Issued when your teacher marks the course complete and your fees are fully paid." />
      {!data.length ? (
        <Card>
          <Empty title="No certificates yet" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start gap-3">
                <Award className="size-8 shrink-0 text-brand-600" aria-hidden />
                <div className="flex-1">
                  <h2 className="font-semibold">{c.data.courseName}</h2>
                  <p className="text-sm text-slate-500">
                    {c.serialNo} · completed {date(c.data.completionDate)}
                  </p>
                  {c.revokedAt && <Badge tone="red">revoked</Badge>}
                  {!c.revokedAt && (
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" onClick={() => download(c)}>
                        Download / print
                      </Button>
                      <a href={c.data.verificationUrl} target="_blank" rel="noopener" className="inline-flex h-8 items-center px-3 text-sm text-brand-700 hover:underline">
                        Verification page
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
