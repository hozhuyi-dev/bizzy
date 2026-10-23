import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput } from "aws-cdk-lib";
import { WebHosting } from "./common/web/cloudfront";
import type { Environment } from "../utils/environment.util";

interface WebStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
}

export class WebStack extends cdk.Stack {
  readonly hosting: WebHosting;
  /** "https://d123.cloudfront.net", which sign-in and the file bucket's CORS take. */
  readonly siteOrigin: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;

    this.hosting = new WebHosting(this, "WebHosting", {
      projectName: projectName,
      environment: environment,
    });

    this.siteOrigin = `https://${this.hosting.distribution.distributionDomainName}`;

    new CfnOutput(this, "SiteUrl", {
      value: this.siteOrigin,
    });

    new CfnOutput(this, "DistributionId", {
      value: this.hosting.distribution.distributionId,
    });

    new CfnOutput(this, "SiteBucketName", {
      value: this.hosting.bucket.bucketName,
    });
  }
}
