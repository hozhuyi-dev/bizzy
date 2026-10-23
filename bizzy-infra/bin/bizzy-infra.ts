#!/usr/bin/env node
import * as assert from "assert";
import * as cdk from "aws-cdk-lib/core";
import * as dotenv from "dotenv";
import { ApiStack } from "../lib/api-stack";
import { AuthStack } from "../lib/auth-stack";
import { DataStack } from "../lib/data-stack";
import { WebStack } from "../lib/web-stack";
import { appUrls } from "../utils/app-urls.util";
import { resolveEnvironment } from "../utils/environment.util";
import { parseEnvList } from "../utils/parsers.util";

const app = new cdk.App();

// Resolved before dotenv runs: it selects which .env.<environment> to load.
const environment = resolveEnvironment();
dotenv.config({ path: "./.env", quiet: true });
dotenv.config({ path: `./.env.${environment}`, quiet: true });

const projectName = process.env.PROJECT_NAME;
const awsAccountId = process.env.AWS_ACCOUNT_ID;
const awsRegion = process.env.AWS_REGION;
const callbackUrls = parseEnvList(process.env.CALLBACK_URLS);
const logoutUrls = parseEnvList(process.env.LOGOUT_URLS);
const allowedEmail = process.env.ALLOWED_EMAIL;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const syncTimeZone = process.env.SYNC_TIME_ZONE;

assert.ok(projectName, "PROJECT_NAME is required");
assert.ok(awsAccountId, "AWS_ACCOUNT_ID is required");
assert.ok(awsRegion, "AWS_REGION is required");
// Staging and production add their own site's URL; development has only these.
assert.ok(
  environment !== "development" || callbackUrls.length > 0,
  "CALLBACK_URLS are required",
);
assert.ok(allowedEmail, "ALLOWED_EMAIL is required");
assert.ok(googleClientId, "GOOGLE_CLIENT_ID is required");
assert.ok(googleClientSecret, "GOOGLE_CLIENT_SECRET is required");
assert.ok(syncTimeZone, "SYNC_TIME_ZONE is required");

const env = { account: awsAccountId, region: awsRegion };

// Development serves the app from localhost (`pnpm web:dev`), so it has no
// hosting. Elsewhere the site comes first: sign-in and the file bucket need
// its URL, which exists only once CloudFront has made it.
const webStack =
  environment === "development"
    ? undefined
    : new WebStack(app, `${projectName}-${environment}-web`, {
        env: env,
        projectName: projectName,
        environment: environment,
      });

const urls = appUrls(webStack?.siteOrigin, { callbackUrls, logoutUrls });

const authStack = new AuthStack(app, `${projectName}-${environment}-auth`, {
  env: env,
  projectName: projectName,
  environment: environment,
  callbackUrls: urls.callbackUrls,
  logoutUrls: urls.logoutUrls,
  googleClientId: googleClientId,
  googleClientSecret: googleClientSecret,
  allowedEmail: allowedEmail,
});

const dataStack = new DataStack(app, `${projectName}-${environment}-data`, {
  env: env,
  projectName: projectName,
  environment: environment,
  allowedOrigins: urls.origins,
});

const apiStack = new ApiStack(app, `${projectName}-${environment}-api`, {
  env: env,
  projectName: projectName,
  environment: environment,
  table: dataStack.data.table,
  files: dataStack.files.bucket,
  paySite: dataStack.paySite.bucket,
  payUrl: dataStack.paySite.url,
  authenticatedRole: authStack.auth.authenticatedRole,
  googleClientId: googleClientId,
  googleClientSecret: googleClientSecret,
  syncTimeZone: syncTimeZone,
});

for (const stack of [authStack, dataStack, apiStack, webStack]) {
  if (!stack) continue;
  cdk.Tags.of(stack).add("project", projectName);
  cdk.Tags.of(stack).add("environment", environment);
  cdk.Tags.of(stack).add("managed-by", "cdk");
}
