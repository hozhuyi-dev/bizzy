/** Every reply from the API: the data, or an error it chose to return. */
export interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

/** One page of a list; mirrors dynamo.Page. */
export interface Page<T> {
  items: Array<T>;
  /** Reads the next page; absent on the last. */
  next?: string;
}
