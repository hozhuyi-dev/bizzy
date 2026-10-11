import * as cdk from "aws-cdk-lib/core";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { ApiStack } from "../lib/api-stack";
import { AuthStack } from "../lib/auth-stack";
import { DataStack } from "../lib/data-stack";
import type { Environment } from "../utils/environment.util";

const env = { account: "123456789012", region: "ap-southeast-5" };

function synth(environment: Environment) {
  // Templates are all these tests read, so skip compiling the Go assets.
  const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });

  const auth = new AuthStack(app, "auth", {
    env,
    projectName: "bizzy",
    environment,
    callbackUrls: ["http://localhost:4200/"],
    logoutUrls: ["http://localhost:4200/"],
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    allowedEmail: "owner@example.com",
  });

  const data = new DataStack(app, "data", {
    env,
    projectName: "bizzy",
    environment,
  });

  const api = new ApiStack(app, "api", {
    env,
    projectName: "bizzy",
    environment,
    table: data.data.table,
    authenticatedRole: auth.auth.authenticatedRole,
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    syncTimeZone: "Asia/Kuala_Lumpur",
  });

  return {
    auth: Template.fromStack(auth),
    data: Template.fromStack(data),
    api: Template.fromStack(api),
  };
}

describe("auth", () => {
  const { auth } = synth("staging");

  test("disables self sign-up", () => {
    auth.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  test("offers Google as the only provider", () => {
    auth.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      SupportedIdentityProviders: ["Google"],
    });
  });

  test("grants credentials only to the allowed email", () => {
    auth.hasResourceProperties("AWS::Cognito::IdentityPoolRoleAttachment", {
      RoleMappings: Match.objectLike({
        "cognito-user-pool": {
          Type: "Rules",
          AmbiguousRoleResolution: "Deny",
          IdentityProvider: Match.anyValue(),
          RulesConfiguration: {
            Rules: [
              Match.objectLike({
                Claim: "email",
                MatchType: "Equals",
                Value: "owner@example.com",
              }),
            ],
          },
        },
      }),
    });
  });
});

describe("data", () => {
  test("stays on free-tier provisioned capacity", () => {
    synth("staging").data.hasResourceProperties("AWS::DynamoDB::Table", {
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    });
  });

  test("creates all five local indexes up front", () => {
    synth("staging").data.hasResourceProperties("AWS::DynamoDB::Table", {
      LocalSecondaryIndexes: ["LSI1", "LSI2", "LSI3", "LSI4", "LSI5"].map(
        (name) =>
          Match.objectLike({
            IndexName: name,
            KeySchema: [
              { AttributeName: "PK", KeyType: "HASH" },
              { AttributeName: `${name}SK`, KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          }),
      ),
    });
  });

  test("retains the production table", () => {
    synth("production").data.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({ DeletionProtectionEnabled: true }),
    });
  });
});

describe("api", () => {
  const { api } = synth("staging");

  test("lets the signed-in role invoke only the api and sync functions", () => {
    const policies = api.findResources("AWS::IAM::Policy", {
      Properties: { PolicyName: Match.stringLikeRegexp("InvokeFunctions") },
    });
    const [policy] = Object.values(policies) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Resource: Array<unknown> }> } };
    }>;
    expect(policy?.Properties.PolicyDocument.Statement).toHaveLength(1);
    expect(policy?.Properties.PolicyDocument.Statement[0]?.Resource).toHaveLength(2);
  });

  test("lets only the api write her Google token", () => {
    type Policy = {
      Properties: {
        PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> };
      };
    };
    const statements = Object.values(api.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => (policy as Policy).Properties.PolicyDocument.Statement,
    );
    const ssm = statements.filter((s) => JSON.stringify(s.Action).includes("ssm:"));

    expect(ssm.map((s) => s.Action)).toEqual(
      expect.arrayContaining([
        ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"],
        "ssm:GetParameter",
      ]),
    );
    for (const s of ssm) {
      expect(JSON.stringify(s.Resource)).toContain(
        "parameter/bizzy/staging/google-refresh-token",
      );
    }
  });

  test("runs the calendar sync daily in her time zone", () => {
    api.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 21 * * ? *)",
      ScheduleExpressionTimezone: "Asia/Kuala_Lumpur",
    });
  });
});
