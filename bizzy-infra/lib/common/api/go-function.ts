import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { DockerImage, Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  LoggingFormat,
  Runtime,
  SystemLogLevel,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

const LAMBDA_ROOT = path.join(__dirname, "../../../../bizzy-lambda");

export interface GoFunctionProps {
  projectName: string;
  environment: Environment;
  /** The command under bizzy-lambda/cmd to build, e.g. "api". */
  command: string;
  environmentVariables?: Record<string, string>;
  timeout?: Duration;
  /**
   * False drops Lambda's own START/END/REPORT lines, which are logged (and
   * billed) once per invocation; the function's own logs stay.
   */
  platformLogs?: boolean;
}

/**
 * A Lambda built from bizzy-lambda/cmd/<command> at synth time.
 *
 * Builds with the local Go toolchain (cross-compiled for arm64 Linux) so
 * synth needs no Docker; the Docker image is only a fallback CDK reaches for
 * if local bundling reports it could not run.
 */
export class GoFunction extends Construct {
  readonly function: LambdaFunction;

  constructor(scope: Construct, id: string, props: GoFunctionProps) {
    super(scope, id);

    const {
      projectName,
      environment,
      command,
      environmentVariables,
      timeout,
      platformLogs = true,
    } = props;

    const functionName = `${projectName}-${environment}-${command}`;

    const logGroup = new LogGroup(this, "Logs", {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.function = new LambdaFunction(this, "Function", {
      functionName: functionName,
      runtime: Runtime.PROVIDED_AL2023,
      architecture: Architecture.ARM_64,
      handler: "bootstrap",
      memorySize: 256,
      timeout: timeout ?? Duration.seconds(10),
      logGroup: logGroup,
      // Log levels need the JSON format; the platform lines are INFO.
      ...(platformLogs
        ? {}
        : { loggingFormat: LoggingFormat.JSON, systemLogLevelV2: SystemLogLevel.WARN }),
      environment: environmentVariables ?? {},
      code: Code.fromAsset(LAMBDA_ROOT, {
        bundling: {
          image: DockerImage.fromRegistry("golang:1.26"),
          environment: { GOOS: "linux", GOARCH: "arm64", CGO_ENABLED: "0" },
          command: [
            "bash",
            "-c",
            `go build -trimpath -ldflags="-s -w" -o /asset-output/bootstrap ./cmd/${command}`,
          ],
          local: {
            tryBundle(outputDir: string) {
              execFileSync(
                "go",
                [
                  "build",
                  "-trimpath",
                  "-ldflags=-s -w",
                  "-o",
                  path.join(outputDir, "bootstrap"),
                  `./cmd/${command}`,
                ],
                {
                  cwd: LAMBDA_ROOT,
                  stdio: "inherit",
                  env: {
                    ...process.env,
                    GOOS: "linux",
                    GOARCH: "arm64",
                    CGO_ENABLED: "0",
                  },
                },
              );
              return true;
            },
          },
        },
      }),
    });
  }
}
