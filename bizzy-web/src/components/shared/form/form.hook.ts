import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "./form-context.hook";
import {
  AutocompleteField,
  CheckboxField,
  ChoiceField,
  NumberField,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
} from "./form-fields.component";
import { focusFirstInvalid } from "~/core/utils/form.util";

const { useAppForm: useBaseForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, AutocompleteField, TextareaField, NumberField, SelectField, CheckboxField, ChoiceField },
  formComponents: { SubmitButton },
});

/**
 * Every form in the app: TanStack's useForm with the app's fields
 * (`<form.AppField name="…">{(field) => <field.TextField label="…" />}`)
 * and SubmitButton. Every submit checks every field, even one never
 * touched (TanStack otherwise stops at the first submit of a form already
 * known to be invalid, leaving untouched fields unchecked), and one that
 * doesn't pass takes the cursor to the first field with an error.
 */
export const useAppForm: typeof useBaseForm = (options) =>
  useBaseForm({ canSubmitWhenInvalid: true, onSubmitInvalid: focusFirstInvalid, ...options });

export { withForm };
