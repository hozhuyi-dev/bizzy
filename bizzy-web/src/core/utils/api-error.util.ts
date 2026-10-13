import { ApiError } from "~/core/lambda/lambda.client";

/** An error the API chose to return, with one of these codes. */
export function isApiError(error: unknown, ...codes: ReadonlyArray<string>): error is ApiError {
  return error instanceof ApiError && codes.includes(error.code);
}

/**
 * The record changed since she looked (or is gone). The API has stored the
 * latest, so the app reloads to show it before she tries again.
 */
export function isStaleEdit(error: unknown): error is ApiError {
  return isApiError(error, "conflict", "not_found");
}
