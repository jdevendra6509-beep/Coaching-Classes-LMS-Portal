import { MaterialType } from "@lms/db";
import { env } from "../config/env.js";

/**
 * What institutes may upload. The material type is derived from this list on the server; the
 * client never chooses it. Executables, HTML and SVG are deliberately absent: they could run
 * script if someone opened them from the bucket's domain.
 */
const ALLOWED: Record<string, { type: MaterialType; ext: string[]; maxMb?: number }> = {
  "application/pdf": { type: MaterialType.PDF, ext: ["pdf"] },
  "application/msword": { type: MaterialType.DOCUMENT, ext: ["doc"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { type: MaterialType.DOCUMENT, ext: ["docx"] },
  "application/vnd.ms-excel": { type: MaterialType.DOCUMENT, ext: ["xls"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { type: MaterialType.DOCUMENT, ext: ["xlsx"] },
  "text/plain": { type: MaterialType.DOCUMENT, ext: ["txt"] },
  "text/csv": { type: MaterialType.DOCUMENT, ext: ["csv"] },
  "application/vnd.ms-powerpoint": { type: MaterialType.PRESENTATION, ext: ["ppt"] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { type: MaterialType.PRESENTATION, ext: ["pptx"] },
  "image/png": { type: MaterialType.IMAGE, ext: ["png"], maxMb: 20 },
  "image/jpeg": { type: MaterialType.IMAGE, ext: ["jpg", "jpeg"], maxMb: 20 },
  "image/webp": { type: MaterialType.IMAGE, ext: ["webp"], maxMb: 20 },
  "video/mp4": { type: MaterialType.VIDEO, ext: ["mp4"] },
  "video/webm": { type: MaterialType.VIDEO, ext: ["webm"] },
  "audio/mpeg": { type: MaterialType.DOCUMENT, ext: ["mp3"] },
};

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export interface FileCheck {
  type: MaterialType;
  maxBytes: number;
}

/** Validates a declared upload; returns null with a reason when it isn't allowed. */
export function checkFile(fileName: string, mimeType: string, sizeBytes: number): FileCheck | { error: string } {
  const rule = ALLOWED[mimeType];
  if (!rule) return { error: `Files of type ${mimeType} can't be uploaded` };
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!rule.ext.includes(ext)) return { error: `A ${mimeType} file should end in .${rule.ext.join(" or .")}` };
  const maxBytes = Math.min(rule.maxMb ?? Infinity, env().MAX_UPLOAD_MB) * 1024 * 1024;
  if (sizeBytes > maxBytes) return { error: `This file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit` };
  if (sizeBytes <= 0) return { error: "The file is empty" };
  return { type: rule.type, maxBytes };
}

/** Keeps a readable filename for downloads: no paths, control characters or quotes. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim().slice(0, 200) || "file";
}
