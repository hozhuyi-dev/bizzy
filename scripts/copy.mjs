#!/usr/bin/env node
// Replaces a test environment's data with another's, to try the app on real
// data (see bizzy-lambda/cmd/copy):
//
//   node scripts/copy.mjs <from> <to>   e.g. production staging
//
// <to> must be development or staging, and its deployed code this checkout's.
// COPY_PHONE and COPY_EMAIL override the business's own phone and email,
// which stand in for every client's. Each environment's table, buckets and
// Google settings are read from its deployed api Lambda; see aws.mjs for the
// region and credentials.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error("Usage: pnpm data:copy <from> <to>, e.g. pnpm data:copy production staging");
  process.exit(1);
}
if (to !== "development" && to !== "staging") {
  console.error(`Only development or staging can be copied into, not ${to}.`);
  process.exit(1);
}

// aws.mjs reads the region from the target's infra env.
process.env.ENVIRONMENT = to;
const { aws, profile, projectName, region, root } = await import("./aws.mjs");

function variables(environment) {
  const config = aws(["lambda", "get-function-configuration", "--function-name", `${projectName}-${environment}-api`]);
  return JSON.parse(config).Environment.Variables;
}

const source = variables(from);
const target = variables(to);

execFileSync("go", ["run", "./cmd/copy"], {
  cwd: join(root, "bizzy-lambda"),
  stdio: "inherit",
  env: {
    ...process.env,
    ...target,
    FROM_TABLE_NAME: source.TABLE_NAME,
    FROM_BUCKET_NAME: source.BUCKET_NAME,
    AWS_REGION: region,
    ...(profile ? { AWS_PROFILE: profile } : {}),
  },
});
