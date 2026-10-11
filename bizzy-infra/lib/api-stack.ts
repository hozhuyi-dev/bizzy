import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput, Duration, TimeZone } from "aws-cdk-lib";
import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import { type IRole, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { GoFunction } from "./common/api/go-function";
import type { Environment } from "../utils/environment.util";

interface ApiStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
  table: ITable;
  /** The identity pool role the signed-in user's credentials carry. */
  authenticatedRole: IRole;
  googleCalendarId: string;
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
      googleCalendarId,
      syncTimeZone,
    } = props;

    this.api = new GoFunction(this, "Api", {
      projectName: projectName,
      environment: environment,
      command: "api",
      // Saving a client or a setting re-derives the sessions it affects.
      timeout: Duration.seconds(30),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        TIME_ZONE: syncTimeZone,
      },
    });

    table.grantReadWriteData(this.api.function);

    // Written by the deploy workflow from a GitHub secret before `cdk deploy`;
    // SecureStrings can't be created by CloudFormation.
    const serviceAccountParam = `/${projectName}/${environment}/google-service-account`;

    this.calendarSync = new GoFunction(this, "CalendarSync", {
      projectName: projectName,
      environment: environment,
      command: "calendar-sync",
      timeout: Duration.minutes(2),
      environmentVariables: {
        TABLE_NAME: table.tableName,
        GOOGLE_CALENDAR_ID: googleCalendarId,
        GOOGLE_SERVICE_ACCOUNT_PARAM: serviceAccountParam,
        SYNC_WINDOW_DAYS: "30",
        TIME_ZONE: syncTimeZone,
      },
    });

    table.grantReadWriteData(this.calendarSync.function);

    StringParameter.fromSecureStringParameterAttributes(
      this,
      "GoogleServiceAccount",
      { parameterName: serviceAccountParam },
    ).grantRead(this.calendarSync.function);

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
  }
}
