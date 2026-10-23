import { Aws, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import {
  type IOpenIdConnectProvider,
  OpenIdConnectPrincipal,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

export interface GitHubDeployRoleProps {
  projectName: string;
  environment: Environment;
  /** "owner/repo" whose deploy workflow assumes the role. */
  repository: string;
  /** The account's GitHub Actions OIDC provider. */
  provider: IOpenIdConnectProvider;
}

/**
 * The role .github/workflows/deploy.yml assumes to deploy one environment.
 *
 * Only a job running in that environment's GitHub environment gets it: both
 * deploy jobs set `environment:`, so GitHub's token says
 * `repo:<owner>/<repo>:environment:<env>`, not the branch. Which branches
 * may deploy is the GitHub environment's rule.
 *
 * Its own permissions are only what the workflow calls outside CloudFormation,
 * on its environment's resources. `cdk deploy` itself goes through the
 * bootstrap roles, which are the account's, not an environment's: this
 * scoping keeps a staging job from touching production's table or site by
 * mistake, and isolates nothing from someone who can edit the workflow.
 */
export class GitHubDeployRole extends Construct {
  readonly role: Role;

  constructor(scope: Construct, id: string, props: GitHubDeployRoleProps) {
    super(scope, id);

    const { projectName, environment, repository, provider } = props;

    const prefix = `${projectName}-${environment}`;
    const stack = Stack.of(this);
    const qualifier =
      stack.node.tryGetContext("@aws-cdk/core:bootstrapQualifier") ??
      DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    const arn = (service: string, resource: string, region: string = Aws.REGION) =>
      `arn:${Aws.PARTITION}:${service}:${region}:${Aws.ACCOUNT_ID}:${resource}`;
    const table = arn("dynamodb", `table/${prefix}`);

    this.role = new Role(this, "Role", {
      roleName: `${prefix}-github`,
      description: `${repository} deploys ${prefix}`,
      assumedBy: new OpenIdConnectPrincipal(provider, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${repository}:environment:${environment}`,
        },
      }),
    });

    const statements = [
      // cdk deploy: the deploy, file-publishing and lookup roles.
      new PolicyStatement({
        actions: ["sts:AssumeRole", "sts:TagSession"],
        resources: [
          `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-${qualifier}-*-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
        ],
      }),
      // scripts/migrate.mjs: the dry run reads the function's settings, then
      // the deploy invokes it.
      new PolicyStatement({
        actions: ["lambda:GetFunctionConfiguration", "lambda:InvokeFunction"],
        resources: [arn("lambda", `function:${prefix}-migrate`)],
      }),
      // The dry run reads the whole table, raising its capacity for that
      // and setting it back (bizzy-lambda's dynamo/capacity.go).
      new PolicyStatement({
        actions: [
          "dynamodb:DescribeTable",
          "dynamodb:UpdateTable",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ],
        resources: [table, `${table}/index/*`],
      }),
      // scripts/web-env.mjs and the upload read the stacks' outputs.
      new PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [arn("cloudformation", `stack/${prefix}-*/*`)],
      }),
      // The site upload. The bucket's name is CloudFormation's, which
      // starts with its stack's.
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [`arn:${Aws.PARTITION}:s3:::${prefix}-web-*`],
      }),
      new PolicyStatement({
        actions: ["s3:PutObject", "s3:DeleteObject"],
        resources: [`arn:${Aws.PARTITION}:s3:::${prefix}-web-*/*`],
      }),
      // Its id is only known once deployed; an invalidation only empties a cache.
      new PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [arn("cloudfront", "distribution/*", "")],
      }),
      // cdk gc, with these credentials rather than a bootstrap role: it reads
      // every stack's template (any of them may still use a build), then tags
      // and deletes the builds none uses.
      new PolicyStatement({
        actions: ["cloudformation:ListStacks"],
        resources: ["*"],
      }),
      new PolicyStatement({
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:GetTemplateSummary",
        ],
        resources: [arn("cloudformation", "stack/*/*")],
      }),
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [
          `arn:${Aws.PARTITION}:s3:::cdk-${qualifier}-assets-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
        ],
      }),
      new PolicyStatement({
        actions: [
          "s3:GetObjectTagging",
          "s3:PutObjectTagging",
          "s3:DeleteObjectTagging",
          "s3:DeleteObject",
        ],
        resources: [
          `arn:${Aws.PARTITION}:s3:::cdk-${qualifier}-assets-${Aws.ACCOUNT_ID}-${Aws.REGION}/*`,
        ],
      }),
    ];
    for (const statement of statements) this.role.addToPolicy(statement);
  }
}
