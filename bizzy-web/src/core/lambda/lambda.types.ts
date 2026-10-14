/** Every reply from the API: the data, or an error it chose to return. */
export interface ApiResponse<T> {
  data?: T;
  error?: ApiErrorBody;
}

/** An error the API chose to return; mirrors router.ErrorBody. */
export interface ApiErrorBody {
  code: string;
  message: string;
  /** The guard that refused the action, when one did. */
  guard?: string;
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
  label: string;
}

/**
 * What a guard says about an action now: allowed, or why not and what
 * would let it through; mirrors statemodel.Verdict. Entities carry one per
 * action (`can`), so the app shows or explains an action without knowing
 * the rule behind it.
 */
export interface Verdict {
  ok: boolean;
  why?: string;
  guard?: string;
  remedies?: Array<Remedy>;
}

/** One page of a list; mirrors dynamo.Page. */
export interface Page<T> {
  items: Array<T>;
  /** Reads the next page; absent on the last. */
  next?: string;
}
