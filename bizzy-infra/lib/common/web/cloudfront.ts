import { RemovalPolicy } from "aws-cdk-lib";
import {
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

export interface WebHostingProps {
  projectName: string;
  environment: Environment;
}

export class WebHosting extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: WebHostingProps) {
    super(scope, id);

    const { projectName, environment } = props;

    const retained = environment === "production";

    this.bucket = new Bucket(this, "SiteBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: retained ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !retained,
    });

    // SPA fallback. This is deliberately a viewer-request rewrite rather than
    // a distribution-level `errorResponses` mapping of 403/404 to index.html:
    // `errorResponses` cannot be scoped to a path, so it would also answer
    // requests for missing *assets* with index.html and a 200. A stale lazy
    // chunk would then arrive as `text/html`, and the browser reports the
    // useless "failed to fetch dynamically imported module" instead of a 404.
    //
    // Only extensionless paths are client routes, so only those are rewritten.
    // Anything with a file extension falls through to the origin and is allowed
    // to fail honestly (S3 answers a missing key with 403, not 404, because
    // origin access control grants GetObject but not ListBucket).
    const spaRouting = new CloudFrontFunction(this, "SpaRouting", {
      comment: `${projectName}-${environment}-web spa routing`,
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
      `),
    });

    this.distribution = new Distribution(this, "Distribution", {
      comment: `${projectName}-${environment}-web`,
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: spaRouting,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
  }
}
