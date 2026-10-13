/** Every reply from the API: the data, or an error it chose to return. */
export interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

/**
 * What a guard says about an action now: allowed, or why not; mirrors
 * statemodel.Verdict. Entities carry one per action (`can`), so the app
 * shows or explains an action without knowing the rule behind it.
 */
export interface Verdict {
  ok: boolean;
  why?: string;
}

/** One page of a list; mirrors dynamo.Page. */
export interface Page<T> {
  items: Array<T>;
  /** Reads the next page; absent on the last. */
  next?: string;
}
