/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AWS_REGION: string;
  readonly VITE_API_FUNCTION_NAME: string;
  /** The public function's URL, which serves share links. */
  readonly VITE_PUBLIC_URL: string;
  /** The payment page's site, which the payment message links to; unset until `pnpm web:env` writes it. */
  readonly VITE_PAY_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_AMPLIFY_USER_POOL_ID: string;
  readonly VITE_AMPLIFY_USER_POOL_CLIENT_ID: string;
  readonly VITE_AMPLIFY_IDENTITY_POOL_ID: string;
  readonly VITE_AMPLIFY_OAUTH_DOMAIN: string;
  /** Development only: actions to slow down ("*" for all), and by how much; see rehearse in lambda.client. */
  readonly VITE_SLOW_ACTIONS?: string;
  readonly VITE_SLOW_MS?: string;
  /** Development only: actions to fail, to see their error state. */
  readonly VITE_FAIL_ACTIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
