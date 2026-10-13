import { Amplify } from "aws-amplify";

/**
 * Redirects follow whichever origin the app is served from, so localhost and
 * each deployed environment work without per-environment config. Every origin
 * still has to be in the user pool's CALLBACK_URLS / LOGOUT_URLS.
 */
export function configureAmplify(): void {
  const { origin } = window.location;

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_AMPLIFY_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_AMPLIFY_USER_POOL_CLIENT_ID,
        identityPoolId: import.meta.env.VITE_AMPLIFY_IDENTITY_POOL_ID,
        loginWith: {
          oauth: {
            domain: import.meta.env.VITE_AMPLIFY_OAUTH_DOMAIN,
            redirectSignIn: [`${origin}/`],
            redirectSignOut: [`${origin}/`],
            responseType: "code",
            scopes: ["email", "openid", "profile"],
          },
        },
      },
    },
  });
}
