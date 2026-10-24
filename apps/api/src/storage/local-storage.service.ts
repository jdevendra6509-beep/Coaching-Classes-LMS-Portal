import { BadRequestException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { env } from "../config/env.js";
import type { StoredObject } from "./storage.service.js";

interface Grant {
  typ: "dev-storage";
  op: "put" | "get";
  key: string;
  type?: string;
  len?: number;
  disposition?: string;
}

/**
 * Development-only stand-in for S3: files on local disk, reached through short-lived signed
 * URLs served by the API (DevStorageController) with the same rules as S3 presigned URLs.
 * URLs are relative ("/api/dev-storage/…") so the browser goes through the web app's pass-through.
 */
@Injectable()
export class LocalStorageService {
  private readonly root = resolve(env().LOCAL_STORAGE_DIR);

  constructor(private readonly jwt: JwtService) {
    if (env().NODE_ENV === "production") throw new Error("STORAGE_DRIVER=local is for development only");
  }

  private get secret() {
    return `${env().JWT_SECRET}:dev-storage`;
  }

  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new BadRequestException("Bad key");
    return p;
  }

  private async sign(grant: Omit<Grant, "typ">, ttlSeconds: number) {
    const t = await this.jwt.signAsync({ typ: "dev-storage", ...grant }, { secret: this.secret, expiresIn: ttlSeconds });
    return `/api/dev-storage/${grant.op === "put" ? "upload" : "file"}?t=${t}`;
  }

  async verify(token: string, op: Grant["op"]): Promise<Grant> {
    try {
      const g = await this.jwt.verifyAsync<Grant>(token, { secret: this.secret });
      if (g.typ !== "dev-storage" || g.op !== op) throw new Error();
      return g;
    } catch {
      throw new BadRequestException("This link has expired or is invalid");
    }
  }

  presignUpload(key: string, contentType: string, contentLength: number, ttlSeconds = 15 * 60) {
    return this.sign({ op: "put", key, type: contentType, len: contentLength }, ttlSeconds);
  }

  presignDownload(key: string, opts: { fileName?: string; inline?: boolean; ttlSeconds?: number } = {}) {
    const disposition = `${opts.inline ? "inline" : "attachment"}${opts.fileName ? `; filename*=UTF-8''${encodeURIComponent(opts.fileName)}` : ""}`;
    return this.sign({ op: "get", key, disposition }, opts.ttlSeconds ?? 5 * 60);
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.path(key));
      const meta = JSON.parse(await readFile(`${this.path(key)}.meta.json`, "utf8")) as { contentType?: string };
      return { size: s.size, contentType: meta.contentType };
    } catch {
      return null;
    }
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(`${p}.meta.json`, JSON.stringify({ contentType }));
  }

  async getObject(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.meta.json`, { force: true });
  }
}
