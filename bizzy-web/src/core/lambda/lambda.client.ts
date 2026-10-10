import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { fetchAuthSession } from "aws-amplify/auth";

/**
 * The API is one Lambda invoked directly with the signed-in user's
 * identity-pool credentials. Every call is an {action, payload} pair and every
 * reply is {data} or {error}; see bizzy-lambda/internal/router.
 */

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

const client = new LambdaClient({
  region: import.meta.env.VITE_AWS_REGION,
  // Resolved per request so Amplify can refresh expired credentials.
  credentials: async () => {
    const { credentials } = await fetchAuthSession();
    if (!credentials) {
      throw new ApiError("unauthenticated", "You're signed out.");
    }
    return credentials;
  },
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function invoke<T>(action: string, payload?: unknown): Promise<T> {
  const result = await client.send(
    new InvokeCommand({
      FunctionName: import.meta.env.VITE_API_FUNCTION_NAME,
      Payload: encoder.encode(JSON.stringify({ action, payload })),
    }),
  );

  const text = result.Payload ? decoder.decode(result.Payload) : "";

  // A crash or timeout inside the function, as opposed to an error it chose
  // to return.
  if (result.FunctionError) {
    throw new ApiError("internal", "Something went wrong. Please try again.");
  }

  const body = JSON.parse(text) as ApiResponse<T>;
  if (body.error) {
    throw new ApiError(body.error.code, body.error.message);
  }

  return body.data as T;
}
