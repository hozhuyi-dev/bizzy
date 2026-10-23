#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { CiStack } from "../lib/ci-stack";

// Deployed by hand with `pnpm ci:deploy`, into the account and region of the
// profile it runs with; see lib/ci-stack.ts.
const app = new cdk.App();

const projectName = process.env.PROJECT_NAME?.trim() || "bizzy";

const stack = new CiStack(app, `${projectName}-ci`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  projectName: projectName,
  repository: "hozhuyi-dev/bizzy",
  environments: ["staging", "production"],
});

cdk.Tags.of(stack).add("project", projectName);
cdk.Tags.of(stack).add("managed-by", "cdk");
