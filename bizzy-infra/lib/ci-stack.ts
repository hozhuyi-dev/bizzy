import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { Aws, CfnOutput } from "aws-cdk-lib";
import { OpenIdConnectProvider } from "aws-cdk-lib/aws-iam";
import { GitHubDeployRole } from "./common/ci/github-deploy-role";
import type { Environment } from "../utils/environment.util";

interface CiStackProps extends cdk.StackProps {
  projectName: string;
  /** "owner@<owner id>/repo@<repo id>"; see GitHubDeployRole. */
  repository: string;
  /** The environments GitHub Actions deploys. */
  environments: ReadonlyArray<Environment>;
}

/**
 * The roles GitHub Actions deploys with, one per environment. Its own app
 * (bin/bizzy-ci.ts), deployed by hand (`pnpm ci:deploy`), so a deploy can
 * never change what deploys are allowed to do.
 */
export class CiStack extends cdk.Stack {
  readonly roles: Partial<Record<Environment, GitHubDeployRole>> = {};

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const { projectName, repository, environments } = props;

    // An account has one provider per URL, which other projects share; it
    // was made by hand, so it is only looked up here, never owned.
    const provider = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHub",
      `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com`,
    );

    for (const environment of environments) {
      const deployRole = new GitHubDeployRole(this, `${environment}Deploy`, {
        projectName: projectName,
        environment: environment,
        repository: repository,
        provider: provider,
      });
      this.roles[environment] = deployRole;

      // The GitHub environment's AWS_ROLE_ARN variable.
      new CfnOutput(this, `${environment}RoleArn`, {
        value: deployRole.role.roleArn,
      });
    }
  }
}
