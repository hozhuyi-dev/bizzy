import { ApiError } from "~/core/lambda/lambda.client";

/** An error the API chose to return, with one of these codes. */
export function isApiError(error: unknown, ...codes: ReadonlyArray<string>): error is ApiError {
  return error instanceof ApiError && codes.includes(error.code);
}

/**
 * Something else changed it at the same moment, or it is gone. The app
 * reloads to show the latest before the user tries again.
 */
export function isStaleEdit(error: unknown): error is ApiError {
  return isApiError(error, "conflict", "not_found");
}
