#!/usr/bin/env node
// Replays an environment's data in memory, reading it only (see
// bizzy-lambda/internal/simulation/replay_test.go): this checkout's
// migrations, every view, then random actions on it.
//
//   node scripts/replay.mjs <env> [go test flags]   e.g. production -rapid.checks=50
//
// The environment's table and bucket are read from its deployed api Lambda;
// see aws.mjs for the credentials.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [from, ...flags] = process.argv.slice(2);
if (!from) {
  console.error("Usage: pnpm data:replay <env>, e.g. pnpm data:replay production");
  process.exit(1);
}

// aws.mjs reads the region from an infra env file: every environment is in
// development's region, and production's file is only in CI.
process.env.ENVIRONMENT = "development";
const { aws, profile, projectName, region, root } = await import("./aws.mjs");

const config = aws(["lambda", "get-function-configuration", "--function-name", `${projectName}-${from}-api`]);
const { TABLE_NAME, BUCKET_NAME } = JSON.parse(config).Environment.Variables;

execFileSync(
  "go",
  ["test", "./internal/simulation", "-run", "TestReplay$", "-count=1", "-timeout=60m", "-rapid.checks=10", "-rapid.steps=50", ...flags],
  {
    cwd: join(root, "bizzy-lambda"),
    stdio: "inherit",
    env: { ...process.env, TABLE_NAME, BUCKET_NAME, AWS_REGION: region, ...(profile ? { AWS_PROFILE: profile } : {}) },
  },
);
