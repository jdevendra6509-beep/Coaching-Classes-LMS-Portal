import { type INestApplication, ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { env, isProd } from "./config/env.js";

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set("trust proxy", 1); // behind the AWS load balancer: req.ip is the client, not the ALB
  express.disable("x-powered-by");
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const origins = env().CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    credentials: true,
    // Allow the platform origin plus any institute subdomain of PLATFORM_HOST.
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        cb(null, origins.includes(origin) || host === env().PLATFORM_HOST || host.endsWith(`.${env().PLATFORM_HOST}`));
      } catch {
        cb(null, false);
      }
    },
  });
  if (!isProd()) {
    const doc = new DocumentBuilder().setTitle("Coaching LMS API").setVersion("0.1").addBearerAuth().build();
    SwaggerModule.setup("docs", app, () => SwaggerModule.createDocument(app, doc));
  }
  return app;
}
