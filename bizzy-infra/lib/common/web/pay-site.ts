import { Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

export interface PaySiteProps {
  projectName: string;
  environment: Environment;
}

/**
 * The payment page a payment message links to: a few static files (the
 * page, its QR, the preview WhatsApp shows) that the API writes whenever the
 * settings are saved (see bizzy-lambda's settings/paypage.go). Its own
 * bucket and distribution, so the app's deploys never touch it, and opening
 * it costs no Lambda call and no read of the table.
 *
 * Kept as cheap as it gets: everything is rewritten from the settings, so
 * the bucket has no versions to keep and goes with its stack; the cheapest
 * price class; no logging; CloudFront caches what the API says (a minute),
 * ignoring query strings, so the page's `?v=` image links never multiply
 * what is cached or fetched.
 */
export class PaySite extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: PaySiteProps) {
    super(scope, id);

    const { projectName, environment } = props;

    this.bucket = new Bucket(this, "Bucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      // Saving the settings again rewrites it all, in every environment.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ id: "abort-incomplete-uploads", abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });

    // The page shows the business's bank details: kept out of other sites'
    // frames. Search engines are kept off by the page itself (its robots.txt
    // and robots meta tag), not an X-Robots-Tag header: that would ride on
    // every file, the preview image too, and link previews (WhatsApp's,
    // Facebook's) must be free to fetch it.
    const headers = new ResponseHeadersPolicy(this, "Headers", {
      comment: `${projectName}-${environment}-pay headers`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      },
    });

    this.distribution = new Distribution(this, "Distribution", {
      comment: `${projectName}-${environment}-pay`,
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
      },
    });
  }

  /** Where the page is served, e.g. "https://d1234.cloudfront.net". */
  get url(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }
}
