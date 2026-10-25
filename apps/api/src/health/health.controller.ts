import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../auth/decorators.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. */
  @Get()
  live() {
    return { status: "ok" };
  }

  /** Readiness: the database answers. Used by the load balancer. */
  @Get("ready")
  async ready() {
    try {
      await this.prisma.platform.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable" });
    }
  }
}
