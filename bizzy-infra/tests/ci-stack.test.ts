import * as cdk from "aws-cdk-lib/core";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { CiStack } from "../lib/ci-stack";

const env = { account: "123456789012", region: "ap-southeast-5" };

function synth() {
  const app = new cdk.App();
  const stack = new CiStack(app, "ci", {
    env,
    projectName: "bizzy",
    repository: "owner/bizzy",
    environments: ["staging", "production"],
  });
  return Template.fromStack(stack);
}

type Statement = { Action: string | Array<string>; Resource: unknown };
type Policy = { Properties: { Roles: Array<{ Ref: string }>; PolicyDocument: { Statement: Array<Statement> } } };

/** The statements of the role named `roleName`, its resources as JSON. */
function statementsOf(template: Template, roleName: string) {
  const roles = template.findResources("AWS::IAM::Role", {
    Properties: { RoleName: roleName },
  });
  const [roleId] = Object.keys(roles);
  expect(roleId).toBeDefined();
  return Object.values(template.findResources("AWS::IAM::Policy") as Record<string, Policy>)
    .filter((policy) => policy.Properties.Roles.some((role) => role.Ref === roleId))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
}

describe("ci", () => {
  const template = synth();

  test("uses the account's GitHub provider rather than making one", () => {
    template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
  });

  test.each(["staging", "production"])("lets only %s's GitHub environment assume its role", (environment) => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: `bizzy-${environment}-github`,
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Principal: {
              Federated: {
                "Fn::Join": [
                  "",
                  Match.arrayWith([":oidc-provider/token.actions.githubusercontent.com"]),
                ],
              },
            },
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": `repo:owner/bizzy:environment:${environment}`,
              },
            },
          }),
        ],
      },
    });
  });

  test("scopes each role's own resources to its environment", () => {
    const staging = JSON.stringify(statementsOf(template, "bizzy-staging-github"));
    expect(staging).toContain("function:bizzy-staging-migrate");
    expect(staging).toContain("table/bizzy-staging");
    expect(staging).toContain("stack/bizzy-staging-*/*");
    expect(staging).toContain("bizzy-staging-web-*");
    expect(staging).not.toContain("production");
  });

  test("grants nothing account-wide but reading stacks and invalidating caches", () => {
    const wide = statementsOf(template, "bizzy-staging-github").filter((s) =>
      JSON.stringify(s.Resource).match(/"\*"|stack\/\*\/\*|distribution\/\*/),
    );
    expect(wide.flatMap((s) => s.Action).sort()).toEqual([
      "cloudformation:DescribeStacks",
      "cloudformation:GetTemplate",
      "cloudformation:GetTemplateSummary",
      "cloudformation:ListStacks",
      "cloudfront:CreateInvalidation",
    ]);
  });
});
