import { Injectable } from "@nestjs/common";
import type { Prisma } from "@lms/db";
import type { Tx } from "../prisma/prisma.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface AuditEntry {
  action: string; // "institute.suspend", "auth.password_reset"
  entityType: string;
  entityId?: string;
  instituteId?: string | null;
  actorUserId?: string | null;
  ip?: string;
  metadata?: Prisma.InputJsonValue;
}

/** Append-only audit trail. Pass `tx` to record inside the same transaction as the change. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma.platform).auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        instituteId: entry.instituteId ?? null,
        actorUserId: entry.actorUserId ?? null,
        ip: entry.ip,
        metadata: entry.metadata,
      },
    });
  }
}
