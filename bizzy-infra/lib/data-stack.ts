import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput } from "aws-cdk-lib";
import { DataTable } from "./common/data/table";
import type { Environment } from "../utils/environment.util";

interface DataStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
}

/**
 * Kept apart from the API so redeploying a Lambda can never touch the table.
 */
export class DataStack extends cdk.Stack {
  readonly data: DataTable;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;

    this.data = new DataTable(this, "Data", {
      projectName: projectName,
      environment: environment,
    });

    new CfnOutput(this, "TableName", {
      value: this.data.table.tableName,
    });
  }
}
