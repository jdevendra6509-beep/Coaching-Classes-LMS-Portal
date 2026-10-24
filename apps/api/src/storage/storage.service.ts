import { Injectable } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

export interface StoredObject {
  size: number;
  contentType: string | undefined;
}

/**
 * Private object storage (S3 in production, MinIO locally). The bucket is never public:
 * browsers upload and download directly with short-lived presigned URLs that the API only
 * hands out after its own permission checks.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket = env().S3_BUCKET;

  constructor() {
    const e = env();
    this.s3 = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: e.S3_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY } : undefined,
    });
  }

  /**
   * URL for a single PUT of exactly `contentLength` bytes of `contentType`. Both headers are
   * part of the signature, so S3 rejects an upload of any other size or type.
   */
  presignUpload(key: string, contentType: string, contentLength: number, ttlSeconds = 15 * 60): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type", "content-length"]) },
    );
  }

  /** URL to read an object; the filename and inline/attachment choice are baked into the signature. */
  presignDownload(key: string, opts: { fileName?: string; inline?: boolean; ttlSeconds?: number } = {}): Promise<string> {
    const disposition = `${opts.inline ? "inline" : "attachment"}${opts.fileName ? `; filename*=UTF-8''${encodeURIComponent(opts.fileName)}` : ""}`;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition }), {
      expiresIn: opts.ttlSeconds ?? 5 * 60,
    });
  }

  /** Size and type of an uploaded object, or null if it isn't there. */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === "NotFound") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
