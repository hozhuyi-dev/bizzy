import { Duration, Lazy, SecretValue } from "aws-cdk-lib";
import { FederatedPrincipal, Role } from "aws-cdk-lib/aws-iam";
import {
  CfnManagedLoginBranding,
  ManagedLoginVersion,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolDomain,
  UserPoolIdentityProviderGoogle,
} from "aws-cdk-lib/aws-cognito";
import {
  IdentityPool,
  IdentityPoolProviderUrl,
  UserPoolAuthenticationProvider,
} from "aws-cdk-lib/aws-cognito-identitypool";
import { Construct } from "constructs";
import type { Environment } from "../../../utils/environment.util";

export interface AuthProps {
  projectName: string;
  environment: Environment;
  callbackUrls: Array<string>;
  logoutUrls: Array<string>;
  googleClientId: string;
  googleClientSecret: string;
  /** The only Google account that is granted AWS credentials. */
  allowedEmail: string;
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly userPoolDomain: UserPoolDomain;
  readonly identityPool: IdentityPool;
  readonly authenticatedRole: Role;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    const {
      projectName,
      environment,
      callbackUrls,
      logoutUrls,
      googleClientId,
      googleClientSecret,
      allowedEmail,
    } = props;

    // No self sign-up and Google as the client's only provider: nobody can
    // register a password account under her email address.
    this.userPool = new UserPool(this, "UserPool", {
      userPoolName: `${projectName}-${environment}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
    });

    // The client secret lands in the synthesized template. Cognito identity
    // providers don't accept SSM SecureString references, and a Secrets
    // Manager secret is not free; the template stays inside this account.
    const google = new UserPoolIdentityProviderGoogle(this, "Google", {
      userPool: this.userPool,
      clientId: googleClientId,
      clientSecretValue: SecretValue.unsafePlainText(googleClientSecret),
      scopes: ["openid", "email", "profile"],
      attributeMapping: {
        email: ProviderAttribute.GOOGLE_EMAIL,
        emailVerified: ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
        fullname: ProviderAttribute.GOOGLE_NAME,
      },
    });

    this.userPoolClient = this.userPool.addClient("UserPoolClient", {
      userPoolClientName: `${projectName}-${environment}`,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE],
      oAuth: {
        callbackUrls: callbackUrls,
        defaultRedirectUri: callbackUrls[0],
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        logoutUrls: logoutUrls,
      },
      refreshTokenValidity: Duration.days(30),
    });
    this.userPoolClient.node.addDependency(google);

    this.userPoolDomain = this.userPool.addDomain("UserPoolDomain", {
      cognitoDomain: { domainPrefix: `${projectName}-${environment}` },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    new CfnManagedLoginBranding(this, "ManagedLoginBranding", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    // Created here rather than by IdentityPool because the role mapping below
    // has to name it. The trust policy resolves the pool id lazily.
    this.authenticatedRole = new Role(this, "AuthenticatedRole", {
      description: `${projectName}-${environment} signed-in user`,
      assumedBy: new FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": Lazy.string({
              produce: () => this.identityPool.identityPoolId,
            }),
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });

    // Anyone with a Google account can complete the login, but only the
    // allowed email is mapped to a role. Everyone else is denied credentials
    // (resolveAmbiguousRoles defaults to false), so they can't call the API.
    this.identityPool = new IdentityPool(this, "IdentityPool", {
      identityPoolName: `${projectName}-${environment}`,
      allowUnauthenticatedIdentities: false,
      authenticatedRole: this.authenticatedRole,
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool: this.userPool,
            userPoolClient: this.userPoolClient,
          }),
        ],
      },
      roleMappings: [
        {
          providerUrl: IdentityPoolProviderUrl.userPool(
            this.userPool,
            this.userPoolClient,
          ),
          // Only a label in the RoleMappings map; required because the
          // provider URL is a deploy-time token.
          mappingKey: "cognito-user-pool",
          useToken: false,
          rules: [
            {
              claim: "email",
              claimValue: allowedEmail,
              mappedRole: this.authenticatedRole,
            },
          ],
        },
      ],
    });
  }
}
