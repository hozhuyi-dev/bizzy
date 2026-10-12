import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput, Duration, TimeZone } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { type IRole, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { GoFunction } from "./common/api/go-function";
import type { Environment } from "../utils/environment.util";

interface ApiStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
  table: ITable;
  /** The identity pool role the signed-in user's credentials carry. */
  authenticatedRole: IRole;
  /**
   * The Google OAuth client, also used by Cognito for sign-in. The Lambdas
   * use it to act as her in Google Calendar and Contacts.
   */
  googleClientId: string;
  googleClientSecret: string;
  /** IANA zone the daily sync runs in, e.g. "Asia/Kuala_Lumpur". */
  syncTimeZone: string;
}

export class ApiStack extends cdk.Stack {
  readonly api: GoFunction;
  readonly calendarSync: GoFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      projectName,
      environment,
      table,
      authenticatedRole,
      googleClientId,
      googleClientSecret,
      syncTimeZone,
    } = props;

    // Her Google refresh token, written by the API when she connects Google
    // in Settings (CloudFormation can't create SecureStrings, so it isn't a
    // stack resource). Both functions act as her with it.
    const tokenParam = `/${projectName}/${environment}/google-refresh-token`;
    const tokenParamArn = this.formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: tokenParam.slice(1),
    });

    // The client secret lands in the template, as it already does for the
    // Cognito identity provider (see common/auth/cognito.ts).
    const googleEnvironment = {
      GOOGLE_CLIENT_ID: googleClientId,
      GOOGLE_CLIENT_SECRET: googleClientSecret,
      GOOGLE_TOKEN_PARAM: tokenParam,
    };

    this.api = new GoFunction(this, "Api", {
      projectName: projectName,
      environment: environment,
      command: "api",
      // Saving a client or a setting re-derives the sessions it affects.
      timeout: Duration.seconds(30),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        TIME_ZONE: syncTimeZone,
        // Development and staging also serve data.reset.
        ENVIRONMENT: environment,
        ...googleEnvironment,
      },
    });

    table.grantReadWriteData(this.api.function);

    // Connecting writes the token and disconnecting deletes it. The default
    // aws/ssm key's policy already lets SSM encrypt and decrypt for the
    // account, so no KMS grant is needed.
    this.api.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"],
        resources: [tokenParamArn],
      }),
    );

    this.calendarSync = new GoFunction(this, "CalendarSync", {
      projectName: projectName,
      environment: environment,
      command: "calendar-sync",
      timeout: Duration.minutes(2),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        SYNC_WINDOW_DAYS: "30",
        TIME_ZONE: syncTimeZone,
        ...googleEnvironment,
      },
    });

    table.grantReadWriteData(this.calendarSync.function);

    this.calendarSync.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [tokenParamArn],
      }),
    );

    // The browser invokes both functions directly with identity-pool
    // credentials (the sync for "Sync now"). A Policy owned by this stack,
    // rather than `grantInvoke(role)`, keeps the dependency one-way:
    // grantInvoke would write the statement into the auth stack's role and
    // make the two stacks reference each other.
    new Policy(this, "InvokeFunctions", {
      roles: [authenticatedRole],
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [
            this.api.function.functionArn,
            this.calendarSync.function.functionArn,
          ],
        }),
      ],
    });

    new Schedule(this, "DailyCalendarSync", {
      description: `${projectName}-${environment} daily calendar sync`,
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "21",
        timeZone: TimeZone.of(syncTimeZone),
      }),
      target: new LambdaInvoke(this.calendarSync.function),
    });

    new CfnOutput(this, "ApiFunctionName", {
      value: this.api.function.functionName,
    });

    new CfnOutput(this, "CalendarSyncFunctionName", {
      value: this.calendarSync.function.functionName,
    });

    // The browser sends her to Google's consent screen with it.
    new CfnOutput(this, "GoogleClientId", {
      value: googleClientId,
    });
  }
}
