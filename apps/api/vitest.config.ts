import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

const testEnv = parseEnv(readFileSync(new URL("./.env.test", import.meta.url), "utf8")) as Record<string, string>;

export default defineConfig({
  // SWC emits the decorator metadata Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    globals: true,
    env: testEnv,
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false, // e2e suites share one database
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
