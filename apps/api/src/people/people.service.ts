import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role, UserStatus } from "@lms/db";
import { InvitesService } from "../auth/invites.service.js";
import type { MailMessage } from "../mail/mail.service.js";
import type { Tx } from "../prisma/prisma.service.js";
import type { PeopleQuery } from "./dto.js";

const ROLE_LABEL: Record<Role, string> = {
  INSTITUTE_ADMIN: "an admin",
  ACCOUNTANT: "an accountant",
  TEACHER: "a teacher",
  STUDENT: "a student",
};

export const USER_PUBLIC = { id: true, name: true, email: true, phone: true, status: true, lastLoginAt: true } as const;

/** Shared lifecycle for anyone an institute adds: account, membership, welcome email, (de)activation. */
@Injectable()
export class PeopleService {
  constructor(private readonly invites: InvitesService) {}

  /**
   * Finds or creates the global user for this email and gives them `role` here.
   * An existing account is reused untouched: its name and password belong to its owner.
   */
  async addMember(tx: Tx, instituteId: string, person: { name: string; email: string; phone?: string }, role: Role) {
    const user =
      (await tx.user.findUnique({ where: { email: person.email } })) ??
      (await tx.user.create({ data: { email: person.email, name: person.name, phone: person.phone } }));
    if (user.status === UserStatus.DISABLED) throw new BadRequestException(`${person.email}: this account is disabled`);
    if (await tx.membership.findFirst({ where: { userId: user.id, role } })) {
      throw new ConflictException(`${person.email} is already ${ROLE_LABEL[role]} here`);
    }
    const membership = await tx.membership.create({ data: { instituteId, userId: user.id, role } });
    return { user, membership };
  }

  async welcome(tx: Tx, instituteId: string, user: { id: string; email: string; name: string; status: UserStatus }): Promise<MailMessage> {
    const institute = await tx.institute.findUniqueOrThrow({ where: { id: instituteId }, select: { slug: true, name: true } });
    return this.invites.welcomeMessage(tx, institute, user);
  }

  sendAll(messages: MailMessage[]) {
    return this.invites.sendAll(messages);
  }

  /** Name and phone are editable by the institute only until the person activates their account. */
  async updateUserDetails(tx: Tx, userId: string, data: { name?: string; phone?: string }) {
    if (data.name === undefined && data.phone === undefined) return;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== UserStatus.INVITED) {
      throw new ForbiddenException("This person has activated their account; only they can change their name and phone");
    }
    await tx.user.update({ where: { id: userId }, data: { name: data.name, phone: data.phone } });
  }

  /** Deactivating also signs the person out of this institute immediately. */
  async setActive(tx: Tx, membershipId: string, isActive: boolean) {
    const m = await tx.membership.update({ where: { id: membershipId }, data: { isActive } });
    if (!isActive) {
      // Under RLS this only touches sessions belonging to this institute.
      await tx.authSession.updateMany({ where: { userId: m.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return m;
  }

  async resendInvite(tx: Tx, instituteId: string, membershipId: string): Promise<MailMessage> {
    const m = await tx.membership.findUnique({ where: { id: membershipId }, include: { user: true } });
    if (!m) throw new NotFoundException();
    if (!m.isActive) throw new BadRequestException("Reactivate this person first");
    return this.welcome(tx, instituteId, m.user);
  }

  /** Throws when adding `adding` more active students would exceed the institute's plan. */
  async assertStudentCapacity(tx: Tx, adding: number) {
    const sub = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" }, include: { plan: true } });
    if (!sub) return;
    const current = await tx.membership.count({ where: { role: Role.STUDENT, isActive: true } });
    if (current + adding > sub.plan.maxStudents) {
      throw new ForbiddenException({
        message: `Your ${sub.plan.name} plan allows ${sub.plan.maxStudents} active students (currently ${current}). Upgrade the plan to add more.`,
        code: "PLAN_LIMIT",
      });
    }
  }

  /** Role and active/inactive filter; text search is applied separately with userSearch(). */
  membershipFilter(q: PeopleQuery, role: Role): Prisma.MembershipWhereInput {
    return { role, ...(q.status !== "all" && { isActive: q.status === "active" }) };
  }
}

export function userSearch(search: string): Prisma.UserWhereInput {
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ],
  };
}

export const toDate = (v?: string) => (v ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : undefined);
