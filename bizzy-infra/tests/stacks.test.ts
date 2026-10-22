import * as cdk from "aws-cdk-lib/core";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { ApiStack } from "../lib/api-stack";
import { AuthStack } from "../lib/auth-stack";
import { DataStack } from "../lib/data-stack";
import { WebStack } from "../lib/web-stack";
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
    paySite: data.paySite.bucket,
    payUrl: data.paySite.url,
    authenticatedRole: auth.auth.authenticatedRole,
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    syncTimeZone: "Asia/Kuala_Lumpur",
  });

  const web = new WebStack(app, "web", { env, projectName: "bizzy", environment });

  return {
    auth: Template.fromStack(auth),
    data: Template.fromStack(data),
    api: Template.fromStack(api),
    web: Template.fromStack(web),
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

  test("lets only production lock files", () => {
    expect(JSON.stringify(synth("staging").data.findResources("AWS::S3::Bucket"))).not.toContain(
      "ObjectLockEnabled",
    );
    synth("production").data.hasResourceProperties("AWS::S3::Bucket", { ObjectLockEnabled: true });
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

  type Statement = { Action: unknown; Resource: unknown };
  type Policy = { Properties: { PolicyDocument: { Statement: Array<Statement> } } };
  const s3Statements = (template: Template) =>
    Object.values(template.findResources("AWS::IAM::Policy"))
      .flatMap((policy) => (policy as Policy).Properties.PolicyDocument.Statement)
      .filter((s) => JSON.stringify(s.Action).includes("s3:"));

  test("scopes S3 access to attachment keys, issued PDFs and the payment page", () => {
    const s3 = s3Statements(api);
    // The api's four, the public function's one, the quarterly job's two.
    expect(s3).toHaveLength(7);
    for (const s of s3) {
      expect(JSON.stringify(s)).toMatch(/attachments\/\*|documents\/\*|PaySiteBucket/);
    }
  });

  test("lets the api only write and delete the payment page's files", () => {
    const pay = s3Statements(api).filter((s) => JSON.stringify(s.Resource).includes("PaySiteBucket"));
    expect(pay.map((s) => s.Action)).toEqual([["s3:PutObject", "s3:DeleteObject"]]);
    api.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "bizzy-staging-api",
      Environment: {
        Variables: Match.objectLike({ PAY_BUCKET_NAME: Match.anyValue(), PAY_URL: Match.anyValue() }),
      },
    });
  });

  test("locks issued PDFs, and deletes them, only where it should", () => {
    const pdfActions = (template: Template) =>
      s3Statements(template)
        .filter((s) => JSON.stringify(s.Resource).includes("documents/*") && JSON.stringify(s.Action).includes("PutObject"))
        .flatMap((s) => s.Action as Array<string>);
    expect(pdfActions(api)).toContain("s3:DeleteObject");

    const production = synth("production").api;
    expect(pdfActions(production)).toEqual(["s3:PutObject", "s3:GetObject", "s3:PutObjectRetention"]);
    production.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: Match.stringLikeRegexp("-api$"),
      Environment: { Variables: Match.objectLike({ RECORD_RETENTION_DAYS: "2557" }) },
    });
    expect(() =>
      api.hasResourceProperties("AWS::Lambda::Function", {
        Environment: { Variables: Match.objectLike({ RECORD_RETENTION_DAYS: Match.anyValue() }) },
      }),
    ).toThrow();
  });

  test("has the api, public, quarterly job and migrate functions; the app runs the sync, a rule the job", () => {
    api.resourceCountIs("AWS::Lambda::Function", 4);
    api.resourceCountIs("AWS::Scheduler::Schedule", 0);
    api.resourceCountIs("AWS::Events::Rule", 1);
    // 03:00 in Kuala Lumpur on the first day of each quarter.
    api.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0 19 L 3,6,9,12 ? *)",
    });
  });

  test("backs the table up before migrating only in production", () => {
    const backup = (template: Template) =>
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: Match.stringLikeRegexp("-migrate$"),
        Environment: { Variables: Match.objectLike({ BACKUP: "true" }) },
      });
    expect(() => backup(api)).toThrow();
    backup(synth("production").api);
  });

  test("lets migrate delete only its own table's backups", () => {
    api.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "dynamodb:DeleteBackup",
            Resource: {
              "Fn::Join": ["", [Match.objectLike({ "Fn::ImportValue": Match.anyValue() }), "/backup/*"]],
            },
          }),
        ]),
      },
    });
  });

  test("serves share links publicly, GET only", () => {
    api.resourceCountIs("AWS::Lambda::Url", 1);
    api.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "NONE",
      Cors: Match.objectLike({ AllowMethods: ["GET"] }),
    });
  });

  test("lets the public function only get items and issued PDFs", () => {
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
    expect(statements.map((s) => s.Action)).toEqual(["dynamodb:GetItem", "s3:GetObject"]);
    expect(JSON.stringify(statements[1])).toContain("documents/*");
  });
});

// CloudFront's managed CachingOptimized policy: honours what the origin says,
// and leaves query strings, headers and cookies out of the cache key.
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";

type Resources = Record<string, { DeletionPolicy?: string; Properties: Record<string, unknown> }>;

describe("payment page", () => {
  const paySite = (environment: Environment) => {
    const { data } = synth(environment);
    const buckets = data.findResources("AWS::S3::Bucket") as Resources;
    const id = Object.keys(buckets).find((key) => key.startsWith("PaySiteBucket"));
    return { data, bucket: id ? buckets[id] : undefined };
  };

  test("keeps no old versions, even in production, where it goes with its stack", () => {
    const { bucket } = paySite("production");
    expect(bucket).toBeDefined();
    expect(bucket?.Properties.VersioningConfiguration).toBeUndefined();
    expect(bucket?.Properties.ObjectLockEnabled).toBeUndefined();
    expect(bucket?.DeletionPolicy).toBe("Delete");
  });

  test("is served privately through the cheapest CloudFront, without logs", () => {
    const { data } = paySite("staging");
    data.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Comment: "bizzy-staging-pay",
        DefaultRootObject: "index.html",
        PriceClass: "PriceClass_100",
        Logging: Match.absent(),
        DefaultCacheBehavior: Match.objectLike({
          CachePolicyId: CACHING_OPTIMIZED,
          ViewerProtocolPolicy: "redirect-to-https",
          Compress: true,
        }),
      }),
    });
    data.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  });

  test("asks not to be indexed", () => {
    paySite("staging").data.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CustomHeadersConfig: {
          Items: [{ Header: "X-Robots-Tag", Value: "noindex, nofollow", Override: true }],
        },
      }),
    });
  });
});

describe("web", () => {
  test("keeps no old builds: the bucket isn't versioned, and abandoned uploads go", () => {
    for (const environment of ["staging", "production"] as const) {
      const buckets = Object.values(synth(environment).web.findResources("AWS::S3::Bucket") as Resources);
      expect(buckets).toHaveLength(1);
      expect(buckets[0]?.Properties.VersioningConfiguration).toBeUndefined();
    }
    synth("staging").web.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({ Id: "abort-incomplete-uploads", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
        ],
      },
    });
  });

  test("serves at the cheapest price class, without logs", () => {
    synth("staging").web.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({ PriceClass: "PriceClass_100", Logging: Match.absent() }),
    });
  });
});
