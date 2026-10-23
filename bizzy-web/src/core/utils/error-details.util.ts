import { ApiError } from "~/core/lambda/lambda.client";

/** How many lines of a stack to keep: where it broke, not the whole way there. */
const STACK_LINES = 6;

/**
 * What the developer needs to find an error, as text to copy and send:
 * what it said, which call and request (the Lambda's log has the rest),
 * the page, and when. A crash in the app has its stack instead.
 */
export function errorDetails(error: unknown, page: string, at: Date): string {
  const lines: Array<string> = [`Error: ${messageOf(error)}`];
  if (error instanceof ApiError) {
    lines.push(`Code: ${error.code}`);
    if (error.trace.action) lines.push(`Call: ${error.trace.action}`);
    if (error.trace.requestId) lines.push(`Request: ${error.trace.requestId}`);
  }
  lines.push(`Page: ${page}`, `Time: ${at.toISOString()}`);
  if (error instanceof Error && error.cause !== undefined) lines.push(`Cause: ${messageOf(error.cause)}`);
  if (error instanceof Error && !(error instanceof ApiError) && error.stack) {
    lines.push("", ...error.stack.split("\n").slice(0, STACK_LINES));
  }
  return lines.join("\n");
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message;
  return String(error);
}
