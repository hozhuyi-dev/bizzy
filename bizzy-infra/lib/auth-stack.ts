import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { CfnOutput } from "aws-cdk-lib";
import { Auth } from "./common/auth/cognito";
import type { Environment } from "../utils/environment.util";

interface AuthStackProps extends cdk.StackProps {
  projectName: string;
  environment: Environment;
  callbackUrls: Array<string>;
  logoutUrls: Array<string>;
  googleClientId: string;
  googleClientSecret: string;
  allowedEmail: string;
}

export class AuthStack extends cdk.Stack {
  readonly auth: Auth;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const {
      projectName,
      environment,
      callbackUrls,
      logoutUrls,
      googleClientId,
      googleClientSecret,
      allowedEmail,
    } = props;

    this.auth = new Auth(this, "Auth", {
      projectName: projectName,
      environment: environment,
      callbackUrls: callbackUrls,
      logoutUrls: logoutUrls,
      googleClientId: googleClientId,
      googleClientSecret: googleClientSecret,
      allowedEmail: allowedEmail,
    });

    new CfnOutput(this, "UserPoolId", {
      value: this.auth.userPool.userPoolId,
    });

    new CfnOutput(this, "UserPoolClientId", {
      value: this.auth.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, "IdentityPoolId", {
      value: this.auth.identityPool.identityPoolId,
    });

    new CfnOutput(this, "OAuthDomain", {
      value: this.auth.userPoolDomain.domainName,
    });
  }
}
