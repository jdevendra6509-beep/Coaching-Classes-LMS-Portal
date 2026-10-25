"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, FileText, Film, Image as ImageIcon, Link2, Plus, Presentation, Trash2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, Dialog, Empty, Field, Input, Select, Spinner } from "@/components/ui";
import { api, ApiError, uploadDirect } from "@/lib/api";
import { bytes, date } from "@/lib/format";
import { useAction, useApi } from "@/lib/hooks";
import { useToast } from "./toast";
import type { Material, Outline } from "@/lib/types";

const ICONS: Record<string, typeof FileText> = { PDF: FileText, DOCUMENT: FileText, PRESENTATION: Presentation, IMAGE: ImageIcon, VIDEO: Film, LINK: Link2 };

/** Opens a material through the API's short-lived link (or the saved external link). */
export async function openMaterial(path: string) {
  const r = await api<{ url: string }>(path);
  window.open(r.url, "_blank", "noopener");
}

/** Staff view of a course's content: upload, links, modules, publish, order. */
export function MaterialsManager({ courseId }: { courseId: string }) {
  const path = `/courses/${courseId}/materials`;
  const { data, isLoading } = useApi<Outline>(path);
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ title: "", externalUrl: "", linkType: "LINK", moduleId: "" });
  const [targetModule, setTargetModule] = useState("");
  const inv = { invalidate: [path] };

  const addModule = useAction((title: string) => api(`/courses/${courseId}/modules`, { method: "POST", json: { title } }), { ...inv, success: "Module added" });
  const renameModule = useAction(({ id, title }: { id: string; title: string }) => api(`/modules/${id}`, { method: "PATCH", json: { title } }), inv);
  const deleteModule = useAction((id: string) => api(`/modules/${id}`, { method: "DELETE" }), { ...inv, success: "Module removed; its files are kept below" });
  const update = useAction(({ id, ...body }: { id: string; isPublished?: boolean; moduleId?: string | null }) => api(`/materials/${id}`, { method: "PATCH", json: body }), inv);
  const remove = useAction((id: string) => api(`/materials/${id}`, { method: "DELETE" }), { ...inv, success: "Deleted" });
  const order = useAction(({ moduleId, materialIds }: { moduleId: string | null; materialIds: string[] }) => api(`${path}/order`, { method: "PUT", json: { moduleId, materialIds } }), inv);
  const addLink = useAction(
    () => api(path, { method: "POST", json: { title: link.title, externalUrl: link.externalUrl, linkType: link.linkType, moduleId: link.moduleId || undefined, isPublished: true } }),
    { ...inv, success: "Link added", onSuccess: () => (setLinkOpen(false), setLink({ title: "", externalUrl: "", linkType: "LINK", moduleId: "" })) },
  );

  async function upload(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      setUploading(file.name);
      try {
        const ask = await api<{ uploadUrl: string; headers: Record<string, string>; uploadToken: string }>(`${path}/upload-url`, {
          method: "POST",
          json: { fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size },
        });
        const uploadToken = await uploadDirect(ask, file);
        await api(path, { method: "POST", json: { title: file.name.replace(/\.[^.]+$/, ""), uploadToken, moduleId: targetModule || undefined } });
        toast.success(`Uploaded ${file.name} (unpublished until you publish it)`);
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof ApiError ? err.message : "upload failed"}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    await qc.invalidateQueries({ queryKey: [path] });
  }

  if (isLoading || !data) return <Spinner />;
  const modules = data.modules;
  const move = (list: Material[], i: number, dir: -1 | 1, moduleId: string | null) => {
    const ids = list.map((m) => m.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    order.mutate({ moduleId, materialIds: ids });
  };

  const renderList = (list: Material[], moduleId: string | null) =>
    !list.length ? (
      <p className="px-5 py-4 text-sm text-slate-500">Nothing here yet.</p>
    ) : (
      <ul className="divide-y divide-slate-100">
        {list.map((m, i) => {
          const Icon = ICONS[m.type] ?? FileText;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Icon className="size-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <button className="truncate text-left font-medium text-brand-700 hover:underline" onClick={() => openMaterial(`/materials/${m.id}/download?inline=true`)}>
                  {m.title}
                </button>
                <p className="text-xs text-slate-500">
                  {m.type.toLowerCase()}
                  {m.sizeBytes ? ` · ${bytes(m.sizeBytes)}` : ""} · {m.uploadedBy} · {date(m.createdAt)}
                </p>
              </div>
              {!m.isPublished && <Badge tone="amber">hidden from students</Badge>}
              <div className="flex items-center gap-1">
                <Select aria-label="Module" className="h-8 w-40 py-0 text-xs" value={m.moduleId ?? ""} onChange={(e) => update.mutate({ id: m.id, moduleId: e.target.value || null })}>
                  <option value="">No module</option>
                  {modules.map((mod) => (
                    <option key={mod.id} value={mod.id}>
                      {mod.title}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(list, i, -1, moduleId)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(list, i, 1, moduleId)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={m.isPublished ? "Hide from students" : "Publish"} title={m.isPublished ? "Hide from students" : "Publish"} onClick={() => update.mutate({ id: m.id, isPublished: !m.isPublished })}>
                  {m.isPublished ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => confirm(`Delete "${m.title}"?`) && remove.mutate(m.id)}>
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Add to module" className="w-56">
            {(id) => (
              <Select id={id} value={targetModule} onChange={(e) => setTargetModule(e.target.value)}>
                <option value="">No module</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <input ref={fileRef} type="file" multiple className="sr-only" id="material-upload" onChange={(e) => upload(e.target.files)} />
          <Button onClick={() => fileRef.current?.click()} loading={!!uploading}>
            <Upload className="size-4" aria-hidden /> {uploading ? `Uploading ${uploading}…` : "Upload files"}
          </Button>
          <Button variant="secondary" onClick={() => (setLink((l) => ({ ...l, moduleId: targetModule })), setLinkOpen(true))}>
            <Link2 className="size-4" aria-hidden /> Add link or video
          </Button>
          <Button variant="secondary" onClick={() => { const t = prompt("Module name, e.g. Unit 1: Kinematics"); if (t) addModule.mutate(t); }}>
            <Plus className="size-4" aria-hidden /> New module
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">PDF, Word, PowerPoint, Excel, images, MP4/WebM videos. New uploads stay hidden from students until you publish them (eye icon).</p>
      </Card>
      {modules.map((mod) => (
        <Card key={mod.id}>
          <CardHeader
            title={mod.title}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => { const t = prompt("Rename module", mod.title); if (t) renameModule.mutate({ id: mod.id, title: t }); }}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Remove module "${mod.title}"? Its files are kept.`) && deleteModule.mutate(mod.id)}>
                  Remove
                </Button>
              </>
            }
          />
          {renderList(mod.materials, mod.id)}
        </Card>
      ))}
      <Card>
        <CardHeader title={modules.length ? "Not in a module" : "Course content"} />
        {!modules.length && !data.ungrouped.length ? <Empty title="No content yet">Upload notes, assignments or videos for this course.</Empty> : renderList(data.ungrouped, null)}
      </Card>
      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} title="Add a link or video">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            addLink.mutate(undefined);
          }}
        >
          <Field label="Title">{(id) => <Input id={id} required value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} />}</Field>
          <Field label="Link" hint="https only, e.g. an unlisted YouTube or Vimeo video, or a Google Drive file.">
            {(id) => <Input id={id} type="url" pattern="https://.*" required value={link.externalUrl} onChange={(e) => setLink({ ...link, externalUrl: e.target.value })} />}
          </Field>
          <Field label="Kind">
            {(id) => (
              <Select id={id} value={link.linkType} onChange={(e) => setLink({ ...link, linkType: e.target.value })}>
                <option value="LINK">Link</option>
                <option value="VIDEO">Video</option>
              </Select>
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={addLink.isPending}>
              Add (published)
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
