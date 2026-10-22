import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput, Duration } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { type IRole, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { FunctionUrlAuthType, HttpMethod } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { GoFunction } from "./common/api/go-function";
import { FileBucket } from "./common/data/file-bucket";
import type { Environment } from "../utils/environment.util";

interface ApiStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
  table: ITable;
  /** Where attachments live; the API presigns the browser's uploads and downloads. */
  files: IBucket;
  /** The identity pool role the signed-in user's credentials carry. */
  authenticatedRole: IRole;
  /**
   * The Google OAuth client, also used by Cognito for sign-in. The Lambda
   * uses it to act as her in Google Calendar and Contacts.
   */
  googleClientId: string;
  googleClientSecret: string;
  /** Her IANA time zone, e.g. "Asia/Kuala_Lumpur", for dates and receipts. */
  syncTimeZone: string;
}

export class ApiStack extends cdk.Stack {
  readonly api: GoFunction;
  /** Serves share links to anyone who has one; see bizzy-lambda/cmd/public. */
  readonly public: GoFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      projectName,
      environment,
      table,
      files,
      authenticatedRole,
      googleClientId,
      googleClientSecret,
      syncTimeZone,
    } = props;

    // Her Google refresh token, written by the API when she connects Google
    // in Settings (CloudFormation can't create SecureStrings, so it isn't a
    // stack resource). The function acts as her with it.
    const tokenParam = `/${projectName}/${environment}/google-refresh-token`;
    const tokenParamArn = this.formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: tokenParam.slice(1),
    });

    // The client secret lands in the template, as it already does for the
    // Cognito identity provider (see common/auth/cognito.ts).
    this.api = new GoFunction(this, "Api", {
      projectName: projectName,
      environment: environment,
      command: "api",
      // A calendar sync reads and re-derives every session in its range.
      timeout: Duration.minutes(2),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: files.bucketName,
        TIME_ZONE: syncTimeZone,
        // Development and staging also serve data.reset.
        ENVIRONMENT: environment,
        // Production locks each issued PDF for as long as records are kept.
        ...(environment === "production"
          ? { RECORD_RETENTION_DAYS: String(FileBucket.RECORD_RETENTION_DAYS) }
          : {}),
        GOOGLE_CLIENT_ID: googleClientId,
        GOOGLE_CLIENT_SECRET: googleClientSecret,
        GOOGLE_TOKEN_PARAM: tokenParam,
      },
    });

    table.grantReadWriteData(this.api.function);

    // Presigned URLs act with the signer's permissions, so these are also
    // what the browser can do with one: only attachment keys. Tagging is how
    // an upload stays pending until confirmed; listing is for data.reset.
    const attachments = files.arnForObjects(`${FileBucket.ATTACHMENTS_PREFIX}*`);
    this.api.function.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "s3:PutObject",
          "s3:PutObjectTagging",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:DeleteObjectTagging",
        ],
        resources: [attachments],
      }),
    );
    this.api.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [files.bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": [`${FileBucket.ATTACHMENTS_PREFIX}*`, `${FileBucket.DOCUMENTS_PREFIX}*`],
          },
        },
      }),
    );
    // Issued PDFs: the API writes and locks each, and reads it back. It
    // deletes them only in data.reset, which production doesn't serve.
    const pdfs = files.arnForObjects(`${FileBucket.DOCUMENTS_PREFIX}*`);
    this.api.function.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:PutObjectRetention",
          ...(environment === "production" ? [] : ["s3:DeleteObject"]),
        ],
        resources: [pdfs],
      }),
    );

    // Connecting writes the token and disconnecting deletes it. The default
    // aws/ssm key's policy already lets SSM encrypt and decrypt for the
    // account, so no KMS grant is needed.
    this.api.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"],
        resources: [tokenParamArn],
      }),
    );

    // The browser invokes the function directly with identity-pool
    // credentials. A Policy owned by this stack, rather than
    // `grantInvoke(role)`, keeps the dependency one-way: grantInvoke would
    // write the statement into the auth stack's role and make the two stacks
    // reference each other.
    new Policy(this, "InvokeFunctions", {
      roles: [authenticatedRole],
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [this.api.function.functionArn],
        }),
      ],
    });

    // The upkeep that runs every quarter (see bizzy-lambda/cmd/job-quarterly):
    // for now, sweeping the attachment files no attachment links to. It reads
    // the table and lists and deletes attachment files, nothing else. A job
    // on another schedule gets its own function and rule (job-<interval>).
    const quarterly = new GoFunction(this, "JobQuarterly", {
      projectName: projectName,
      environment: environment,
      command: "job-quarterly",
      timeout: Duration.minutes(5),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: files.bucketName,
      },
    });
    table.grantReadData(quarterly.function);
    quarterly.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:DeleteObject"],
        resources: [attachments],
      }),
    );
    quarterly.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [files.bucketArn],
        conditions: { StringLike: { "s3:prefix": [`${FileBucket.ATTACHMENTS_PREFIX}*`] } },
      }),
    );
    new Rule(this, "JobQuarterlySchedule", {
      // 03:00 in Kuala Lumpur on the first of January, April, July and October.
      schedule: Schedule.cron({ minute: "0", hour: "19", day: "L", month: "3,6,9,12" }),
      targets: [new LambdaFunction(quarterly.function)],
    });

    // Brings the table to the schema the deployed code reads (see
    // bizzy-lambda/cmd/migrate). Deploys invoke it right after updating the
    // functions (scripts/migrate.mjs); production's table is backed up first.
    const migrate = new GoFunction(this, "Migrate", {
      projectName: projectName,
      environment: environment,
      command: "migrate",
      timeout: Duration.minutes(15),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        TIME_ZONE: syncTimeZone,
        BACKUP: String(environment === "production"),
      },
    });
    table.grantReadWriteData(migrate.function);
    migrate.function.addToRolePolicy(
      new PolicyStatement({ actions: ["dynamodb:CreateBackup"], resources: [table.tableArn] }),
    );
    // Backups older than point-in-time recovery's window are deleted after
    // each new one. ListBackups can't be scoped to a table.
    migrate.function.addToRolePolicy(
      new PolicyStatement({ actions: ["dynamodb:ListBackups"], resources: ["*"] }),
    );
    migrate.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:DeleteBackup"],
        resources: [`${table.tableArn}/backup/*`],
      }),
    );

    // The one thing reachable without signing in, so it is its own function
    // with its own role: it can read single items from the table and issued
    // PDFs, and nothing else, whatever its code does. Anyone can call it as often as they like
    // and every call is billed, so a call that is stuck (DynamoDB throttling,
    // retried with backoff) is cut short, and logs only what went wrong.
    this.public = new GoFunction(this, "Public", {
      projectName: projectName,
      environment: environment,
      command: "public",
      timeout: Duration.seconds(3),
      platformLogs: false,
      environmentVariables: { TABLE_NAME: table.tableName, BUCKET_NAME: files.bucketName },
    });
    table.grant(this.public.function, "dynamodb:GetItem");
    // The PDFs of the documents it opens, read only.
    this.public.function.addToRolePolicy(
      new PolicyStatement({ actions: ["s3:GetObject"], resources: [pdfs] }),
    );
    const publicUrl = this.public.function.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      // The app on any origin (localhost, each CloudFront domain) reads it;
      // the token in the path is the permission, so no credentials.
      cors: { allowedOrigins: ["*"], allowedMethods: [HttpMethod.GET] },
    });

    new CfnOutput(this, "ApiFunctionName", {
      value: this.api.function.functionName,
    });

    new CfnOutput(this, "PublicUrl", {
      value: publicUrl.url,
    });

    // The browser sends her to Google's consent screen with it.
    new CfnOutput(this, "GoogleClientId", {
      value: googleClientId,
    });
  }
}
