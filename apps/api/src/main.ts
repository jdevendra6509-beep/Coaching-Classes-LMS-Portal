import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { env } from "./config/env.js";
import { configureApp } from "./setup.js";

async function bootstrap() {
  env(); // fail fast on bad configuration
  // rawBody: Razorpay webhook signatures are computed over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env().PORT);
  Logger.log(`API listening on :${env().PORT} (docs at /docs outside production)`, "Bootstrap");
}

void bootstrap();
