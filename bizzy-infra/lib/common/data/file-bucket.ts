import { Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

export interface FileBucketProps {
  projectName: string;
  environment: Environment;
  /** App origins the browser uploads from and downloads to, e.g. "http://localhost:4200". */
  allowedOrigins: Array<string>;
}

/**
 * Where files she attaches live (photos, PDFs, receipts): one private bucket
 * per environment, outside the table, whose items are capped at 400 KB.
 *
 * The browser uploads and downloads directly with short-lived presigned URLs
 * from the API (see bizzy-lambda's platform/blobstore), so the bucket only
 * needs CORS for the app's origins, and the signed-in role gets no S3 access.
 *
 * Keys are `attachments/<ownerKind>/<ownerId>/<attachmentId>/original.<ext>`:
 * ids only, never names, since keys end up in logs and URLs.
 *
 * Kept cheap: S3 Standard (a practice's files are a few GB at most, where the
 * colder classes' minimum sizes and retrieval fees cost more than they save),
 * images shrunk in the browser before upload, and lifecycle rules that clean
 * up abandoned uploads. Only production is backed up, by versioning: a file
 * deleted or overwritten there can be restored for 35 days, the same window
 * as the table's point-in-time recovery.
 */
export class FileBucket extends Construct {
  /** Where every attachment key starts; what the API's role is scoped to. */
  static readonly ATTACHMENTS_PREFIX = "attachments/";
  /** How long an older version of a production file is kept. */
  static readonly VERSION_RETENTION_DAYS = 35;

  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: FileBucketProps) {
    super(scope, id);

    const { environment, allowedOrigins } = props;

    const retained = environment === "production";

    this.bucket = new Bucket(this, "Bucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      versioned: retained,
      removalPolicy: retained ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !retained,
      cors: [
        {
          allowedOrigins: allowedOrigins,
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.HEAD],
          // A presigned PUT carries the signed headers (content type, tags).
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: "abort-incomplete-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
        {
          // An upload is tagged pending until the app confirms it (see
          // blobstore); one never confirmed (a closed tab, a failed save)
          // goes after a day, with no cleanup code to run.
          id: "expire-unconfirmed-uploads",
          tagFilters: { pending: "true" },
          expiration: Duration.days(1),
        },
        ...(retained
          ? [
              {
                id: "expire-old-versions",
                noncurrentVersionExpiration: Duration.days(FileBucket.VERSION_RETENTION_DAYS),
                expiredObjectDeleteMarker: true,
              },
            ]
          : []),
      ],
    });
  }
}
