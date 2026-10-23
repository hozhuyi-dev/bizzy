import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { fetchAuthSession } from "aws-amplify/auth";
import type { ApiResponse, Remedy } from "./lambda.types";

/**
 * The API is one Lambda invoked directly with the signed-in user's
 * identity-pool credentials. Every call is an {action, payload} pair and every
 * reply is {data} or {error}; see bizzy-lambda/internal/platform/router.
 */

/** Where a call's error came from, for the developer: see errorDetails. */
export interface ErrorTrace {
  action?: string | undefined;
  /** The invocation's request id, as the Lambda's log shows it. */
  requestId?: string | undefined;
}

export class ApiError extends Error {
  readonly code: string;
  /** What would let a refused action through. */
  readonly remedies: Array<Remedy>;
  readonly trace: ErrorTrace;

  constructor(code: string, message: string, remedies: Array<Remedy> = [], trace: ErrorTrace = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.code = code;
    this.remedies = remedies;
    this.trace = trace;
  }
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

async function send(functionName: string, payload: unknown, action: string): Promise<{ text: string; trace: ErrorTrace }> {
  let result;
  try {
    result = await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: encoder.encode(JSON.stringify(payload)),
      }),
    );
  } catch (cause) {
    throw unreachable(cause, action);
  }
  const trace = { action, requestId: result.$metadata.requestId };

  // A crash or timeout inside the function, as opposed to an error it chose
  // to return.
  if (result.FunctionError) {
    throw new ApiError("internal", "Something went wrong. Please try again.", [], trace);
  }

  return { text: result.Payload ? decoder.decode(result.Payload) : "", trace };
}

/**
 * The call never reached the API, or Lambda turned it away: said plainly,
 * with what was thrown kept as the cause.
 */
function unreachable(cause: unknown, action: string): ApiError {
  if (cause instanceof ApiError) return cause;
  const requestId = (cause as { $metadata?: { requestId?: string } } | null)?.$metadata?.requestId;
  const trace = { action, requestId };
  if (cause instanceof Error && cause.name === "TooManyRequestsException") {
    return new ApiError("busy", "bizzy is busy. Try again in a moment.", [], trace, cause);
  }
  return new ApiError("unreachable", "Couldn't reach bizzy. Check the connection and try again.", [], trace, cause);
}

type QueryKey = ReadonlyArray<unknown>;

/**
 * Told the kinds of item each call changed (see onChanged), and the
 * queries kept as they are meanwhile (see keeping).
 */
export type ChangeListener = (changed: ReadonlyArray<string>, keep: ReadonlyArray<QueryKey>) => void;

let listener: ChangeListener = () => undefined;

/** Hears what every call changed, to read again only what shows it; one listener at a time. */
export function onChanged(next: ChangeListener): void {
  listener = next;
}

const kept = new Map<string, { key: QueryKey; calls: number }>();

/**
 * Keeps a query as it is while `call` runs, rather than read it again for
 * what any call changes meanwhile: a page whose forms would restart, which
 * the call's own result updates instead. No key keeps nothing.
 */
export async function keeping<T>(queryKey: QueryKey | undefined, call: () => Promise<T>): Promise<T> {
  if (!queryKey) return call();
  const id = JSON.stringify(queryKey);
  const entry = kept.get(id) ?? { key: queryKey, calls: 0 };
  entry.calls++;
  kept.set(id, entry);
  try {
    return await call();
  } finally {
    if (--entry.calls === 0) kept.delete(id);
  }
}

function unwrap<T>(text: string, trace: ErrorTrace): T {
  const body = JSON.parse(text) as ApiResponse<T>;
  // Before any error: a call refused halfway may have changed something.
  if (body.changed?.length) listener(body.changed, [...kept.values()].map(({ key }) => key));
  if (body.error) {
    throw new ApiError(body.error.code, body.error.message, body.error.remedies, trace);
  }

  // The API omits an empty result ("data" is omitempty); queries need null,
  // since TanStack Query rejects undefined data.
  return (body.data ?? null) as T;
}

/**
 * Development only, to watch loading and errors: the actions named in
 * VITE_SLOW_ACTIONS ("*" for every one) wait VITE_SLOW_MS first, and those
 * in VITE_FAIL_ACTIONS fail as if out of reach. Set in
 * .env.development.local; a production build has none of it.
 */
async function rehearse(action: string): Promise<void> {
  const named = (list: string | undefined) => (list ?? "").split(",").some((a) => a.trim() === "*" || a.trim() === action);
  const env = import.meta.env;
  if (named(env.VITE_SLOW_ACTIONS)) await new Promise((resolve) => setTimeout(resolve, Number(env.VITE_SLOW_MS ?? 1500)));
  if (named(env.VITE_FAIL_ACTIONS)) throw unreachable(new Error("Failed on purpose (VITE_FAIL_ACTIONS)"), action);
}

export async function invoke<T>(action: string, payload?: unknown): Promise<T> {
  if (import.meta.env.DEV) await rehearse(action);
  const { text, trace } = await send(import.meta.env.VITE_API_FUNCTION_NAME, { action, payload }, action);
  return unwrap<T>(text, trace);
}
