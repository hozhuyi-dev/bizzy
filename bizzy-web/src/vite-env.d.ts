/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AWS_REGION: string;
  readonly VITE_API_FUNCTION_NAME: string;
  readonly VITE_AMPLIFY_USER_POOL_ID: string;
  readonly VITE_AMPLIFY_USER_POOL_CLIENT_ID: string;
  readonly VITE_AMPLIFY_IDENTITY_POOL_ID: string;
  readonly VITE_AMPLIFY_OAUTH_DOMAIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
