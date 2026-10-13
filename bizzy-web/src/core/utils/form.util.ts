/** A field's validation messages in the shape the form's Field shows. */
export function fieldErrors(errors: ReadonlyArray<string | undefined>): Array<{ message: string }> {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}
