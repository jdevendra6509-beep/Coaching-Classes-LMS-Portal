import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthTokenType, InstituteStatus, type Institute, type Role, type User, UserStatus } from "@lms/db";
import { AuditService } from "../audit/audit.service.js";
import { decrypt, encrypt, randomToken, sha256 } from "../common/crypto.js";
import { env, instituteUrl } from "../config/env.js";
import { passwordResetEmail } from "../mail/templates.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService, type Tx } from "../prisma/prisma.service.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password.js";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp.js";

/** Institutes whose users may sign in. PAST_DUE keeps access during the grace period. */
const LOGIN_ALLOWED: InstituteStatus[] = [InstituteStatus.ACTIVE, InstituteStatus.PAST_DUE];

const INVALID = "Invalid email or password";

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string; mfaEnabled: boolean };
  institute: { id: string; slug: string; name: string; status: InstituteStatus } | null;
  roles: Role[];
  isPlatformAdmin: boolean;
}

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.platform;
  }

  /**
   * With a tenant slug: signs in to that institute, using the user's memberships there.
   * Without one: platform-admin sign-in.
   */
  async login(
    input: { email: string; password: string; otp?: string },
    slug: string | undefined,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await burnPasswordCheck(input.password);
      throw new UnauthorizedException(INVALID);
    }
    if (!(await verifyPassword(user.passwordHash, input.password)) || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(INVALID);
    }

    let institute: Institute | null = null;
    let roles: Role[] = [];
    if (slug) {
      ({ institute, roles } = await this.resolveInstituteAccess(user.id, slug));
    } else if (!user.isPlatformAdmin) {
      throw new UnauthorizedException(INVALID);
    }

    if (user.mfaEnabled) {
      if (!input.otp) throw new UnauthorizedException({ message: "Authenticator code required", code: "MFA_REQUIRED" });
      if (!verifyTotp(decrypt(user.mfaSecret!), input.otp)) throw new UnauthorizedException("Invalid authenticator code");
    }

    const session = await this.startSession(user, institute, roles, client);
    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      instituteId: institute?.id,
      actorUserId: user.id,
      ip: client.ip,
    });
    return session;
  }

  /** Rotates the refresh token: the presented one stops working immediately. */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException();
    const session = await this.db.authSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException();
    }

    let institute: Institute | null = null;
    let roles: Role[] = [];
    if (session.instituteId) {
      const found = await this.db.institute.findUnique({ where: { id: session.instituteId } });
      if (!found) throw new UnauthorizedException();
      // Re-checked on every refresh so a suspension or removed membership takes effect within one access-token lifetime.
      ({ institute, roles } = await this.resolveInstituteAccess(session.userId, found.slug));
    } else if (!session.user.isPlatformAdmin) {
      throw new UnauthorizedException();
    }

    const newRefresh = randomToken();
    const updated = await this.db.authSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
      data: { tokenHash: sha256(newRefresh), ip: client.ip, userAgent: client.userAgent },
    });
    if (updated.count !== 1) throw new UnauthorizedException(); // lost a race with another refresh
    return this.buildSession(session.user, institute, roles, session.id, newRefresh);
  }

  async logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
    const where = refreshToken ? { tokenHash: sha256(refreshToken) } : sessionId ? { id: sessionId } : null;
    if (!where) return;
    await this.db.authSession.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async acceptInvite(token: string, password: string): Promise<void> {
    await this.consumeEmailToken(token, AuthTokenType.INVITE, async (tx, userId) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(password), status: UserStatus.ACTIVE },
      });
    });
  }

  /** Always succeeds from the caller's point of view, so it can't be used to probe for accounts. */
  async forgotPassword(email: string, slug: string | undefined): Promise<void> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status === UserStatus.DISABLED) return;
    if (slug) {
      const institute = await this.db.institute.findUnique({ where: { slug } });
      const member = institute && (await this.db.membership.count({ where: { instituteId: institute.id, userId: user.id } }));
      if (!member) return;
    } else if (!user.isPlatformAdmin) {
      return;
    }

    const token = await this.db.$transaction(async (tx) => {
      await tx.authToken.updateMany({
        where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET, usedAt: null },
        data: { usedAt: new Date() },
      });
      return this.issueEmailToken(tx, user.id, AuthTokenType.PASSWORD_RESET, 60 * 60);
    });
    const path = `/reset-password?token=${token}`;
    const link = slug ? instituteUrl(slug, path) : env().PLATFORM_URL + path;
    await this.mail.send(passwordResetEmail(user.email, user.name, link));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.consumeEmailToken(token, AuthTokenType.PASSWORD_RESET, async (tx, userId) => {
      await tx.user.update({
        where: { id: userId },
        // An invited user who resets instead of accepting the invite ends up active as well.
        data: { passwordHash: await hashPassword(password), status: UserStatus.ACTIVE },
      });
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  }

  async me(userId: string, instituteId: string | null) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, mfaEnabled: true, isPlatformAdmin: true },
    });
    const institute = instituteId
      ? await this.db.institute.findUnique({
          where: { id: instituteId },
          select: { id: true, slug: true, name: true, status: true, logoKey: true },
        })
      : null;
    return { user, institute };
  }

  /** Step 1 of enabling MFA: stores a new (not yet active) secret and returns it for the authenticator app. */
  async setupMfa(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new ForbiddenException("MFA is already enabled");
    const secret = generateTotpSecret();
    await this.db.user.update({ where: { id: userId }, data: { mfaSecret: encrypt(secret) } });
    return { secret, otpauthUri: totpUri(secret, user.email) };
  }

  /** Step 2: proves the app is set up correctly before MFA is enforced at login. */
  async enableMfa(userId: string, code: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret || !verifyTotp(decrypt(user.mfaSecret), code)) {
      throw new UnauthorizedException("Invalid authenticator code");
    }
    await this.db.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.audit.record({ action: "auth.mfa_enabled", entityType: "User", entityId: userId, actorUserId: userId });
  }

  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !verifyTotp(decrypt(user.mfaSecret!), code)) {
      throw new UnauthorizedException("Invalid authenticator code");
    }
    await this.db.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
    await this.audit.record({ action: "auth.mfa_disabled", entityType: "User", entityId: userId, actorUserId: userId });
  }

  /** Creates a single-use email token and returns the raw value to put in a link. */
  async issueEmailToken(tx: Tx, userId: string, type: AuthTokenType, ttlSeconds: number): Promise<string> {
    const token = randomToken();
    await tx.authToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
    });
    return token;
  }

  private async consumeEmailToken(token: string, type: AuthTokenType, fn: (tx: Tx, userId: string) => Promise<void>) {
    await this.db.$transaction(async (tx) => {
      // The usedAt: null condition makes consumption atomic: a token can't be redeemed twice in parallel.
      const claimed = await tx.authToken.updateMany({
        where: { tokenHash: sha256(token), type, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new UnauthorizedException("This link is invalid or has expired");
      const row = await tx.authToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
      await fn(tx, row.userId);
    });
  }

  private async resolveInstituteAccess(userId: string, slug: string): Promise<{ institute: Institute; roles: Role[] }> {
    const institute = await this.db.institute.findUnique({ where: { slug } });
    if (!institute) throw new UnauthorizedException(INVALID);
    const memberships = await this.prisma.tenant(institute.id, (tx) =>
      tx.membership.findMany({ where: { userId, isActive: true }, select: { role: true } }),
    );
    if (!memberships.length) throw new UnauthorizedException(INVALID);
    if (!LOGIN_ALLOWED.includes(institute.status)) {
      throw new ForbiddenException({ message: "This institute's account is not active", code: "INSTITUTE_INACTIVE" });
    }
    return { institute, roles: memberships.map((m) => m.role) };
  }

  private async startSession(user: User, institute: Institute | null, roles: Role[], client: ClientInfo) {
    const refreshToken = randomToken();
    const session = await this.db.authSession.create({
      data: {
        userId: user.id,
        instituteId: institute?.id ?? null,
        tokenHash: sha256(refreshToken),
        ip: client.ip,
        userAgent: client.userAgent,
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return this.buildSession(user, institute, roles, session.id, refreshToken);
  }

  private async buildSession(
    user: User,
    institute: Institute | null,
    roles: Role[],
    sessionId: string,
    refreshToken: string,
  ): Promise<IssuedSession> {
    const isPlatformAdmin = !institute && user.isPlatformAdmin;
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: sessionId,
      pa: isPlatformAdmin,
      iid: institute?.id ?? null,
      slug: institute?.slug ?? null,
      roles,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: env().ACCESS_TOKEN_TTL_SECONDS,
      user: { id: user.id, name: user.name, email: user.email, mfaEnabled: user.mfaEnabled },
      institute: institute && { id: institute.id, slug: institute.slug, name: institute.name, status: institute.status },
      roles,
      isPlatformAdmin,
    };
  }
}
