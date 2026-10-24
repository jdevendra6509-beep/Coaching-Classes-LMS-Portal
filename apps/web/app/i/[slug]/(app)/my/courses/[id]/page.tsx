"use client";

import { Download, ExternalLink, FileText, Film, Image as ImageIcon, Link2, Presentation } from "lucide-react";
import { useParams } from "next/navigation";
import { openMaterial } from "@/components/materials";
import { useToast } from "@/components/toast";
import { Card, CardHeader, Empty, PageHeader, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Material, Outline } from "@/lib/types";

const ICONS: Record<string, typeof FileText> = { PDF: FileText, DOCUMENT: FileText, PRESENTATION: Presentation, IMAGE: ImageIcon, VIDEO: Film, LINK: Link2 };

export default function MyCourse() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data, isLoading, error } = useApi<Outline & { course: { name: string; code: string; description: string | null } }>(`/me/courses/${id}/materials`);
  if (isLoading) return <Spinner />;
  if (error || !data) return <Empty title="This course isn't available to you" />;

  const open = (m: Material, inline: boolean) =>
    openMaterial(`/me/materials/${m.id}/download${inline ? "?inline=true" : ""}`).catch((e) => toast.error(e instanceof ApiError ? e.message : "Couldn't open the file"));

  const list = (items: Material[]) => (
    <ul className="divide-y divide-slate-100">
      {items.map((m) => {
        const Icon = ICONS[m.type] ?? FileText;
        const external = m.type === "LINK" || (m.type === "VIDEO" && !m.fileName);
        return (
          <li key={m.id} className="flex items-center gap-3 px-5 py-3">
            <Icon className="size-5 shrink-0 text-brand-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <button className="truncate text-left font-medium hover:text-brand-700 hover:underline" onClick={() => open(m, true)}>
                {m.title}
              </button>
              {m.description && <p className="text-sm text-slate-500">{m.description}</p>}
              <p className="text-xs text-slate-400">
                {m.type.toLowerCase()}
                {m.sizeBytes ? ` · ${bytes(m.sizeBytes)}` : ""}
              </p>
            </div>
            {external ? (
              <ExternalLink className="size-4 text-slate-400" aria-hidden />
            ) : (
              <button className="rounded p-2 text-slate-500 hover:bg-slate-100" onClick={() => open(m, false)} aria-label={`Download ${m.title}`}>
                <Download className="size-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  const empty = !data.modules.length && !data.ungrouped.length;
  return (
    <>
      <PageHeader title={data.course.name} description={data.course.description ?? data.course.code} />
      {empty ? (
        <Card>
          <Empty title="No material yet">Your teachers will add notes and videos here.</Empty>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.modules.map((mod) => (
            <Card key={mod.id}>
              <CardHeader title={mod.title} />
              {list(mod.materials)}
            </Card>
          ))}
          {data.ungrouped.length > 0 && (
            <Card>
              <CardHeader title={data.modules.length ? "More" : "Study material"} />
              {list(data.ungrouped)}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
