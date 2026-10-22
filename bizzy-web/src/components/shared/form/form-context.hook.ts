import { createFormHookContexts } from "@tanstack/react-form";

/**
 * The form and field a field component is inside, so it reads its own
 * value, errors and handlers. Apart from form.hook so the field components
 * can use them without importing the hook that lists them.
 */
export const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();
