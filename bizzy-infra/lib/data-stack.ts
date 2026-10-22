import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput } from "aws-cdk-lib";
import { DataTable } from "./common/data/table";
import { FileBucket } from "./common/data/file-bucket";
import { PaySite } from "./common/web/pay-site";
import type { Environment } from "../utils/environment.util";

interface DataStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
  /** App origins, which upload and download attachments directly. */
  allowedOrigins: Array<string>;
}

/**
 * Kept apart from the API so redeploying a Lambda can never touch the table
 * or the files.
 */
export class DataStack extends cdk.Stack {
  readonly data: DataTable;
  readonly files: FileBucket;
  readonly paySite: PaySite;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { projectName, environment, allowedOrigins } = props;

    this.data = new DataTable(this, "Data", {
      projectName: projectName,
      environment: environment,
    });

    this.files = new FileBucket(this, "Files", {
      projectName: projectName,
      environment: environment,
      allowedOrigins: allowedOrigins,
    });

    this.paySite = new PaySite(this, "PaySite", {
      projectName: projectName,
      environment: environment,
    });

    new CfnOutput(this, "TableName", {
      value: this.data.table.tableName,
    });

    new CfnOutput(this, "FilesBucketName", {
      value: this.files.bucket.bucketName,
    });

    // The payment message links to it; scripts/web-env.mjs gives it to the app.
    new CfnOutput(this, "PayUrl", {
      value: this.paySite.url,
    });
  }
}
