import { BadRequestException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { env } from "../config/env.js";

/** What the API agreed to accept when it issued the upload URL. */
export interface UploadTicket {
  key: string;
  mimeType: string;
  size: number;
  fileName: string;
  /** What the upload is for, e.g. "course:<id>" or "logo". Checked on confirm. */
  scope: string;
  instituteId: string;
}

/**
 * Signs the upload's parameters so the confirm step can trust them without storing pending
 * uploads. Uses its own key (not the access-token key), and carries typ "upload".
 */
@Injectable()
export class UploadTicketService {
  constructor(private readonly jwt: JwtService) {}

  private get secret() {
    return `${env().JWT_SECRET}:upload-ticket`;
  }

  issue(ticket: UploadTicket): Promise<string> {
    return this.jwt.signAsync({ typ: "upload", ...ticket }, { secret: this.secret, expiresIn: 60 * 60 });
  }

  async verify(token: string, expect: { scope: string; instituteId: string }): Promise<UploadTicket> {
    let t: UploadTicket & { typ: string };
    try {
      t = await this.jwt.verifyAsync(token, { secret: this.secret });
    } catch {
      throw new BadRequestException("The upload has expired or is invalid; please upload the file again");
    }
    if (t.typ !== "upload" || t.scope !== expect.scope || t.instituteId !== expect.instituteId) {
      throw new BadRequestException("This upload belongs to something else");
    }
    return t;
  }
}
