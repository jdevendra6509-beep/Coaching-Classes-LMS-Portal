"use client";

import { Eye, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { cssFont, DATE_FORMATS, FIELD_LABELS, fieldText, FONTS, type TemplateField } from "@/components/certificate-fields";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api, openPdf } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAction, useApi } from "@/lib/hooks";

interface Template {
  id: string;
  name: string;
  backgroundMime: string;
  pageWidth: number;
  pageHeight: number;
  fields: TemplateField[];
}

const MAX_DISPLAY_WIDTH = 820;

/** Width available to the page preview, tracked as the window resizes. */
function useWidth() {
  // A callback ref, because the measured element only appears once the template has loaded.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/**
 * Drag-and-drop layout editor. The artwork is drawn in the browser (pdf.js for PDFs); fields are
 * positioned in PDF points from the top-left, exactly as the server renders them. The on-screen
 * fonts are close stand-ins; "Preview PDF" shows the real output.
 */
export default function TemplateEditor() {
  const { id } = useParams<{ id: string }>();
  const { data: tpl } = useApi<Template>(`/certificate-templates/${id}`);
  const [fields, setFields] = useState<TemplateField[] | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [boxRef, boxWidth] = useWidth();
  useEffect(() => {
    if (tpl && !fields) {
      setFields(tpl.fields);
      setName(tpl.name);
    }
  }, [tpl, fields]);

  const save = useAction(() => api(`/certificate-templates/${id}`, { method: "PATCH", json: { name, fields } }), { success: "Layout saved", invalidate: ["/certificate-templates"], onSuccess: () => setDirty(false) });

  if (!tpl || !fields) return <Spinner />;
  const scale = Math.min(boxWidth || MAX_DISPLAY_WIDTH, MAX_DISPLAY_WIDTH) / tpl.pageWidth;
  const update = (i: number, patch: Partial<TemplateField>) => {
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    setDirty(true);
  };
  const remove = (i: number) => {
    setFields(fields.filter((_, j) => j !== i));
    setSelected(0);
    setDirty(true);
  };
  const add = (f: TemplateField) => {
    setFields([...fields, f]);
    setSelected(fields.length);
    setDirty(true);
  };
  const sel = fields[selected];

  return (
    <>
      <PageHeader
        title={
          <Input aria-label="Design name" value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} className="h-10 w-80 text-xl font-semibold" />
        }
        description={
          <>
            Drag fields into place. Arrow keys nudge the selected field (Shift for 10 pt). <Link href="/certificates" className="text-brand-700 hover:underline">Back to certificates</Link>
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => (dirty ? save.mutateAsync(undefined) : Promise.resolve()).then(() => openPdf(`/certificate-templates/${id}/preview`))}>
              <Eye className="size-4" aria-hidden /> Preview PDF
            </Button>
            <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty}>
              Save layout
            </Button>
          </>
        }
      />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div ref={boxRef} className="min-w-0">
          {boxWidth > 0 && <Canvas template={tpl} scale={scale}>
            {fields.map((f, i) => (
              <Marker key={i} field={f} scale={scale} selected={i === selected} onSelect={() => setSelected(i)} onMove={(x, y) => update(i, { x, y })} page={tpl} />
            ))}
          </Canvas>}
          <p className="mt-2 text-xs text-slate-500">
            Page {Math.round(tpl.pageWidth)} × {Math.round(tpl.pageHeight)} pt. Sample values are shown; long names shrink to the field&apos;s max width in the real certificate.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
          <Card>
            <CardHeader title="Fields" />
            <ul className="divide-y divide-slate-100 text-sm">
              {fields.map((f, i) => (
                <li key={i}>
                  <button className={cn("flex w-full items-center justify-between px-4 py-2 text-left", i === selected ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50")} onClick={() => setSelected(i)}>
                    <span className="truncate">{f.key ? FIELD_LABELS[f.key] : `“${f.text}”`}</span>
                    <span className="text-xs text-slate-400">
                      {Math.round(f.x)}, {Math.round(f.y)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
              <Select aria-label="Add a value" className="h-8 w-48 py-0 text-xs" value="" onChange={(e) => e.target.value && add(e.target.value === "verificationQr" ? { key: "verificationQr", x: 40, y: 40, size: 80 } : { key: e.target.value, x: tpl.pageWidth / 2, y: tpl.pageHeight / 2, fontSize: 14, align: "center" })}>
                <option value="">+ Add a value…</option>
                {Object.entries(FIELD_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" onClick={() => add({ text: "Your text with {studentName}", x: tpl.pageWidth / 2, y: tpl.pageHeight / 2, fontSize: 14, align: "center" })}>
                <Plus className="size-3" aria-hidden /> Text
              </Button>
            </div>
          </Card>
          {sel && (
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{sel.key ? FIELD_LABELS[sel.key] : "Text"}</h3>
                <Button size="sm" variant="ghost" onClick={() => remove(selected)} aria-label="Remove field">
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              </div>
              {!sel.key && (
                <Field label="Text" hint="Use {studentName}, {courseName}, {completionDate}… to insert values.">
                  {(fid) => <Input id={fid} value={sel.text ?? ""} onChange={(e) => update(selected, { text: e.target.value })} />}
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="X (pt)">{(fid) => <Input id={fid} type="number" value={Math.round(sel.x)} onChange={(e) => update(selected, { x: Number(e.target.value) })} />}</Field>
                <Field label="Y (pt)">{(fid) => <Input id={fid} type="number" value={Math.round(sel.y)} onChange={(e) => update(selected, { y: Number(e.target.value) })} />}</Field>
              </div>
              {sel.key === "verificationQr" ? (
                <Field label="Size (pt)">{(fid) => <Input id={fid} type="number" min={30} max={400} value={sel.size ?? 80} onChange={(e) => update(selected, { size: Number(e.target.value) })} />}</Field>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Font">
                      {(fid) => (
                        <Select id={fid} value={sel.font ?? "Helvetica"} onChange={(e) => update(selected, { font: e.target.value })}>
                          {FONTS.map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Size">{(fid) => <Input id={fid} type="number" min={4} max={200} value={sel.fontSize ?? 16} onChange={(e) => update(selected, { fontSize: Number(e.target.value) })} />}</Field>
                    <Field label="Align">
                      {(fid) => (
                        <Select id={fid} value={sel.align ?? "left"} onChange={(e) => update(selected, { align: e.target.value as TemplateField["align"] })}>
                          <option value="left">Left of the point</option>
                          <option value="center">Centred on the point</option>
                          <option value="right">Right of the point</option>
                        </Select>
                      )}
                    </Field>
                    <Field label="Colour">{(fid) => <Input id={fid} type="color" value={sel.color ?? "#000000"} onChange={(e) => update(selected, { color: e.target.value })} className="p-1" />}</Field>
                  </div>
                  <Field label="Max width (pt)" hint="Shrinks long text to fit. Leave empty for none.">
                    {(fid) => <Input id={fid} type="number" min={10} value={sel.maxWidth ?? ""} onChange={(e) => update(selected, { maxWidth: e.target.value ? Number(e.target.value) : undefined })} />}
                  </Field>
                  {(sel.key?.endsWith("Date") || /\{\w*Date\}/.test(sel.text ?? "")) && (
                    <Field label="Date format">
                      {(fid) => (
                        <Select id={fid} value={sel.dateFormat ?? "D MMMM YYYY"} onChange={(e) => update(selected, { dateFormat: e.target.value })}>
                          {DATE_FORMATS.map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                </>
              )}
            </Card>
          )}
          {dirty && <Alert tone="amber">Unsaved changes.</Alert>}
        </div>
      </div>
    </>
  );
}

/** Draws the artwork: pdf.js for PDFs, an <img> for images. */
function Canvas({ template, scale, children }: { template: Template; scale: number; children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const width = template.pageWidth * scale;
  const height = template.pageHeight * scale;

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const blob = await api<Blob>(`/certificate-templates/${template.id}/background`);
        if (template.backgroundMime !== "application/pdf") {
          url = URL.createObjectURL(blob);
          if (!cancelled) setImg(url);
          return;
        }
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const page = await doc.getPage(1);
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [template.id, template.backgroundMime, scale]);

  return (
    <div className="relative select-none border border-slate-300 bg-white shadow-sm" style={{ width, height }}>
      {template.backgroundMime === "application/pdf" ? (
        <canvas ref={canvasRef} style={{ width, height }} className="absolute inset-0" aria-hidden />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        img && <img src={img} alt="" className="absolute inset-0 size-full" draggable={false} />
      )}
      {error && <div className="absolute inset-x-0 top-2 text-center text-xs text-red-600">Couldn&apos;t draw the artwork here; Preview PDF still shows the result.</div>}
      {children}
    </div>
  );
}

function Marker({
  field,
  scale,
  selected,
  onSelect,
  onMove,
  page,
}: {
  field: TemplateField;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  page: Template;
}) {
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));

  const down = (e: ReactPointerEvent) => {
    onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, x: field.x, y: field.y };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onMove(clamp(d.x + (e.clientX - d.startX) / scale, page.pageWidth), clamp(d.y + (e.clientY - d.startY) / scale, page.pageHeight));
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    onMove(clamp(field.x + delta[0], page.pageWidth), clamp(field.y + delta[1], page.pageHeight));
  };
  const ring = selected ? "ring-2 ring-brand-500" : "ring-1 ring-dashed ring-brand-500/50 hover:ring-brand-500";

  if (field.key === "verificationQr") {
    const size = (field.size ?? 80) * scale;
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Verification QR code"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={key}
        className={cn("absolute flex cursor-move items-center justify-center bg-slate-200/80 text-[10px] text-slate-600", ring)}
        style={{ left: field.x * scale, top: field.y * scale, width: size, height: size }}
      >
        QR
      </div>
    );
  }
  const size = (field.fontSize ?? 16) * scale;
  const shift = field.align === "center" ? "-50%" : field.align === "right" ? "-100%" : "0";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={field.key ? FIELD_LABELS[field.key] : field.text}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={key}
      className={cn("absolute cursor-move whitespace-nowrap px-0.5 leading-none", ring)}
      style={{
        left: field.x * scale,
        // y is the baseline; a cap height is roughly 0.8 em above it.
        top: field.y * scale - size * 0.8,
        transform: `translateX(${shift})`,
        fontSize: size,
        color: field.color ?? "#000",
        maxWidth: field.maxWidth ? field.maxWidth * scale : undefined,
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...cssFont(field.font),
      }}
    >
      {fieldText(field)}
    </div>
  );
}
