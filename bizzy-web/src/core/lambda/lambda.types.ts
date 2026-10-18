/** Every reply from the API: the data, or an error it chose to return. */
export interface ApiResponse<T> {
  data?: T;
  error?: ApiErrorBody;
}

/**
 * An error the API chose to return; mirrors router.ErrorBody. A rule saying
 * no has code "refused" and carries its remedies.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  remedies?: Array<Remedy>;
}

/**
 * An action that clears a refusal, offered as a button beside its message;
 * mirrors apperr.Remedy.
 */
export interface Remedy {
  /** The API action to call, e.g. "documents.cancel". */
  action: string;
  /** What to call it on, e.g. a document's id. */
  target?: string;
  /** The action's request as far as the remedy knows it, e.g. {"name": "Jane"}. */
  request?: Record<string, unknown>;
  /** What the user fills in before the request is sent ("fee"): taken right there once it is. */
  ask?: string;
  label: string;
}

/**
 * What an action would say now: allowed, or why not and what would let it
 * through; mirrors apperr.Verdict. Views carry one per action they offer
 * (`can`), so the app shows or explains an action without knowing the rule
 * behind it.
 */
export interface Verdict {
  ok: boolean;
  why?: string;
  remedies?: Array<Remedy>;
}
