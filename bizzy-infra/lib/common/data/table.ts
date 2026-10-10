import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

export interface DataTableProps {
  projectName: string;
  environment: Environment;
}

/**
 * The single bizzy table. Each entity type lives in one partition
 * (PK = "CLIENT", "SESSION", ...) with SK ordering it; see bizzy-lambda's
 * platform/dynamo package.
 */
export class DataTable extends Construct {
  readonly table: Table;

  constructor(scope: Construct, id: string, props: DataTableProps) {
    super(scope, id);

    const { projectName, environment } = props;

    const retained = environment === "production";

    // Provisioned rather than on-demand to stay inside the always-free 25
    // RCU/WCU, which every table in the account shares: 5 each per
    // environment leaves plenty of headroom for a single user.
    this.table = new Table(this, "Table", {
      tableName: `${projectName}-${environment}`,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      deletionProtection: retained,
      // Invoices are business records. Point-in-time recovery is billed per
      // GB of table size, which for this data is a fraction of a cent.
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: retained,
      },
      removalPolicy: retained ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
  }
}
