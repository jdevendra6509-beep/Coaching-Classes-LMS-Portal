import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { Prisma } from "@lms/db";

/**
 * Turns database constraint errors into proper HTTP answers instead of 500s. A foreign-key
 * failure usually means an id from another institute (blocked by the composite keys) or one
 * that doesn't exist; both are reported as 404 so ids from other tenants reveal nothing.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, [number, string]> = {
      P2002: [HttpStatus.CONFLICT, "A record with these details already exists"],
      P2025: [HttpStatus.NOT_FOUND, "Not found"],
      P2003: [HttpStatus.NOT_FOUND, "A referenced record was not found"],
    };
    const [status, message] = map[err.code] ?? [HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error"];
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) throw err; // let Nest log it
    res.status(status).json({ statusCode: status, message });
  }
}
