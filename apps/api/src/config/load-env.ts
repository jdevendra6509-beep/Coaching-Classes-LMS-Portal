import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Local development convenience: read the repo's .env (or apps/api/.env). In production the
// environment comes from the platform (ECS task definition / Secrets Manager) and no file exists.
// Variables already set in the environment win.
for (const file of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
