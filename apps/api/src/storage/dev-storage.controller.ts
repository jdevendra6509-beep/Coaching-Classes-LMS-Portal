import { BadRequestException, Controller, Get, HttpCode, Inject, Put, Query, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../auth/decorators.js";
import type { AppRequest } from "../common/request.js";
import { LocalStorageService } from "./local-storage.service.js";
import { StorageService } from "./storage.service.js";

/** Serves the signed URLs LocalStorageService hands out. Registered only with STORAGE_DRIVER=local. */
@Public()
@SkipThrottle()
@Controller("dev-storage")
export class DevStorageController {
  constructor(@Inject(StorageService) private readonly storage: LocalStorageService) {}

  @Put("upload")
  @HttpCode(200)
  async upload(@Query("t") token: string, @Req() req: AppRequest) {
    const g = await this.storage.verify(token, "put");
    // Same checks S3 applies to a presigned PUT: exact type and length.
    if (req.header("content-type") !== g.type) throw new BadRequestException("Content-Type doesn't match the signed upload");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > (g.len ?? 0)) throw new BadRequestException("Body is larger than the signed length");
      chunks.push(chunk);
    }
    if (size !== g.len) throw new BadRequestException("Body length doesn't match the signed upload");
    await this.storage.putObject(g.key, Buffer.concat(chunks), g.type!);
    return {};
  }

  @Get("file")
  async file(@Query("t") token: string, @Res() res: Response) {
    const g = await this.storage.verify(token, "get");
    const meta = await this.storage.head(g.key);
    if (!meta) return res.status(404).end();
    res.setHeader("Content-Type", meta.contentType ?? "application/octet-stream");
    if (g.disposition) res.setHeader("Content-Disposition", g.disposition);
    res.send(Buffer.from(await this.storage.getObject(g.key)));
  }
}
