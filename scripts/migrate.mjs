#!/usr/bin/env node
// Runs the migrations of an environment's table (see bizzy-lambda/cmd/migrate).
//
//   node scripts/migrate.mjs            invoke the deployed migrate Lambda: what
//                                       every deploy does once the functions are
//                                       updated, as they refuse the table until then
//   node scripts/migrate.mjs --dry-run  run this checkout's migrations on a copy of
//                                       the deployed table in memory, writing nothing:
//                                       what the next deploy would do
//
// See aws.mjs for where the environment and credentials come from.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aws, environment, profile, projectName, region, root } from "./aws.mjs";

const functionName = `${projectName}-${environment}-migrate`;

if (process.argv.includes("--dry-run")) {
  dryRun();
} else {
  migrate();
}

function migrate() {
  const out = join(tmpdir(), `${functionName}-${Date.now()}.json`);
  const result = JSON.parse(
    aws([
      "lambda",
      "invoke",
      "--function-name",
      functionName,
      "--cli-binary-format",
      "raw-in-base64-out",
      "--payload",
      "{}",
      // A migration can take as long as the function's 15 minutes.
      "--cli-read-timeout",
      "0",
      out,
    ]),
  );
  const payload = readFileSync(out, "utf8");
  if (result.FunctionError) {
    console.error(`${functionName} failed; the app refuses the table until it runs:\n${payload}`);
    process.exit(1);
  }
  console.log(`${functionName}: ${payload}`);
}

function dryRun() {
  let variables;
  try {
    const config = aws(["lambda", "get-function-configuration", "--function-name", functionName]);
    variables = JSON.parse(config).Environment.Variables;
  } catch (error) {
    if (!error.message.includes("ResourceNotFoundException")) throw error;
    // The first deploy of an environment: no table to migrate yet.
    console.log(`${functionName} isn't deployed yet: nothing to dry-run.`);
    return;
  }
  execFileSync("go", ["run", "./cmd/migrate", "-dry-run"], {
    cwd: join(root, "bizzy-lambda"),
    stdio: "inherit",
    env: {
      ...process.env,
      TABLE_NAME: variables.TABLE_NAME,
      TIME_ZONE: variables.TIME_ZONE,
      AWS_REGION: region,
      ...(profile ? { AWS_PROFILE: profile } : {}),
    },
  });
}
