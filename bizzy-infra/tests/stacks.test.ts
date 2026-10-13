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
    allowedOrigins: ["http://localhost:4200"],
  });

  const api = new ApiStack(app, "api", {
    env,
    projectName: "bizzy",
    environment,
    table: data.data.table,
    files: data.files.bucket,
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

describe("files", () => {
  test("keeps files private, encrypted and reachable only over TLS", () => {
    const { data } = synth("staging");
    data.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      }),
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedOrigins: ["http://localhost:4200"] })],
      },
    });
    data.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } }),
        ]),
      }),
    });
  });

  test("cleans up unconfirmed uploads in every environment", () => {
    synth("staging").data.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: "expire-unconfirmed-uploads",
            TagFilters: [{ Key: "pending", Value: "true" }],
            ExpirationInDays: 1,
          }),
        ]),
      },
    });
  });

  test("versions only production, keeping old versions for 35 days", () => {
    const staging = synth("staging").data;
    expect(
      JSON.stringify(staging.findResources("AWS::S3::Bucket")),
    ).not.toContain("VersioningConfiguration");

    synth("production").data.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        VersioningConfiguration: { Status: "Enabled" },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: "expire-old-versions",
              NoncurrentVersionExpiration: { NoncurrentDays: 35 },
              ExpiredObjectDeleteMarker: true,
            }),
          ]),
        },
      }),
    });
  });
});

describe("api", () => {
  const { api } = synth("staging");

  test("lets the signed-in role invoke only the api function", () => {
    const policies = api.findResources("AWS::IAM::Policy", {
      Properties: { PolicyName: Match.stringLikeRegexp("InvokeFunctions") },
    });
    const [policy] = Object.values(policies) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Resource: unknown }> } };
    }>;
    const [functionId] = Object.keys(
      api.findResources("AWS::Lambda::Function", {
        Properties: { FunctionName: "bizzy-staging-api" },
      }),
    );
    expect(policy?.Properties.PolicyDocument.Statement).toHaveLength(1);
    expect(policy?.Properties.PolicyDocument.Statement[0]?.Resource).toEqual({
      "Fn::GetAtt": [functionId, "Arn"],
    });
  });

  test("scopes the api's SSM access to her Google token", () => {
    type Policy = {
      Properties: {
        PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> };
      };
    };
    const statements = Object.values(api.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => (policy as Policy).Properties.PolicyDocument.Statement,
    );
    const ssm = statements.filter((s) => JSON.stringify(s.Action).includes("ssm:"));

    expect(ssm.map((s) => s.Action)).toEqual([
      ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"],
    ]);
    for (const s of ssm) {
      expect(JSON.stringify(s.Resource)).toContain(
        "parameter/bizzy/staging/google-refresh-token",
      );
    }
  });

  test("scopes the api's S3 access to attachment keys", () => {
    type Policy = {
      Properties: {
        PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> };
      };
    };
    const statements = Object.values(api.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => (policy as Policy).Properties.PolicyDocument.Statement,
    );
    const s3 = statements.filter((s) => JSON.stringify(s.Action).includes("s3:"));

    expect(s3).toHaveLength(2);
    for (const s of s3) {
      expect(JSON.stringify(s)).toContain("attachments/*");
    }
  });

  test("has the api and public functions and no schedule; the app runs the sync", () => {
    api.resourceCountIs("AWS::Lambda::Function", 2);
    api.resourceCountIs("AWS::Scheduler::Schedule", 0);
  });

  test("serves share links publicly, GET only", () => {
    api.resourceCountIs("AWS::Lambda::Url", 1);
    api.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "NONE",
      Cors: Match.objectLike({ AllowMethods: ["GET"] }),
    });
  });

  test("lets the public function only get items", () => {
    const publicRole = Object.keys(api.findResources("AWS::IAM::Role")).find((id) =>
      id.startsWith("Public"),
    );
    type Policy = {
      Properties: {
        Roles: Array<{ Ref: string }>;
        PolicyDocument: { Statement: Array<{ Action: unknown }> };
      };
    };
    const statements = Object.values(api.findResources("AWS::IAM::Policy"))
      .filter((policy) => (policy as Policy).Properties.Roles.some((role) => role.Ref === publicRole))
      .flatMap((policy) => (policy as Policy).Properties.PolicyDocument.Statement);

    expect(publicRole).toBeDefined();
    expect(statements.map((s) => s.Action)).toEqual(["dynamodb:GetItem"]);
  });
});
