import { useId } from "react";
import { useSelector } from "@tanstack/react-form";
import { useFieldContext, useFormContext } from "./form-context.hook";
import type { ComponentProps, ReactNode } from "react";
import type { AnyFieldApi } from "@tanstack/react-form";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { fieldErrors } from "~/core/utils/form.util";

/*
 * The app's form fields, each bound to the TanStack field it is rendered
 * in (form.AppField, or a component inside one). Every field lays out the
 * same way: label, control, description, then a hint (why it is locked)
 * and its error. An error shows once the field has been left or a submit
 * tried, never while it is first being typed.
 */

interface FieldFrameProps {
  label: ReactNode;
  /** "sr-only" (or "md:sr-only") where the row's layout already says what the field is. */
  labelClassName?: string | undefined;
  description?: ReactNode;
  /** Under the description: why it can't change now (a LockedHint), usually. */
  hint?: ReactNode;
  /** On the field's wrapper: its width in a row. */
  className?: string | undefined;
}

/** The field's errors to show now: once it has been left, or a submit tried. */
function useShownErrors(field: AnyFieldApi): Array<unknown> {
  const attempted = useSelector(field.form.store, (state) => state.submissionAttempts > 0);
  const { errors, isBlurred } = field.state.meta;
  return isBlurred || attempted ? errors : [];
}

function FieldFrame({
  label,
  labelClassName,
  labelFor,
  labelId,
  description,
  hint,
  className,
  errors,
  children,
}: FieldFrameProps & { labelFor?: string; labelId?: string; errors: Array<unknown>; children: ReactNode }) {
  return (
    <Field data-invalid={errors.length > 0} className={className}>
      <FieldLabel htmlFor={labelFor} id={labelId} className={labelClassName}>
        {label}
      </FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      {hint}
      <FieldError errors={fieldErrors(errors)} />
    </Field>
  );
}

/** Words beside the control, on its line: "from" before a date, "days ahead" after a number. */
function Affixed({ prefix, suffix, children }: { prefix?: ReactNode; suffix?: ReactNode; children: ReactNode }) {
  if (prefix === undefined && suffix === undefined) return children;
  return (
    <div className="flex items-center gap-2">
      {prefix !== undefined && <span className="text-sm text-muted-foreground">{prefix}</span>}
      {children}
      {suffix !== undefined && <span className="text-sm text-muted-foreground">{suffix}</span>}
    </div>
  );
}

type InputProps = Omit<ComponentProps<typeof Input>, "id" | "value" | "onChange" | "onBlur" | "className" | "prefix">;

interface TextFieldProps extends FieldFrameProps, InputProps {
  inputClassName?: string | undefined;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

/** A line of text: a name, an amount, a date or time (by `type`). */
export function TextField({
  label,
  labelClassName,
  description,
  hint,
  className,
  inputClassName,
  prefix,
  suffix,
  ...input
}: TextFieldProps) {
  const field = useFieldContext<string>();
  const id = useId();
  const errors = useShownErrors(field);
  return (
    <FieldFrame {...{ label, labelClassName, description, hint, className, errors }} labelFor={id}>
      <Affixed prefix={prefix} suffix={suffix}>
        <Input
          id={id}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
          aria-invalid={errors.length > 0 || undefined}
          className={inputClassName}
          {...input}
        />
      </Affixed>
    </FieldFrame>
  );
}

type TextareaProps = Omit<ComponentProps<typeof Textarea>, "id" | "value" | "onChange" | "onBlur" | "className">;

/** Text over several lines: notes, an address, a message. */
export function TextareaField({
  label,
  labelClassName,
  description,
  hint,
  className,
  textareaClassName,
  ...textarea
}: FieldFrameProps & TextareaProps & { textareaClassName?: string | undefined }) {
  const field = useFieldContext<string>();
  const id = useId();
  const errors = useShownErrors(field);
  return (
    <FieldFrame {...{ label, labelClassName, description, hint, className, errors }} labelFor={id}>
      <Textarea
        id={id}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={errors.length > 0 || undefined}
        className={textareaClassName}
        {...textarea}
      />
    </FieldFrame>
  );
}

/** A number kept as one (NaN while the box is empty, for its validator to ask for one). */
export function NumberField({
  label,
  labelClassName,
  description,
  hint,
  className,
  inputClassName,
  prefix,
  suffix,
  ...input
}: TextFieldProps) {
  const field = useFieldContext<number>();
  const id = useId();
  const errors = useShownErrors(field);
  return (
    <FieldFrame {...{ label, labelClassName, description, hint, className, errors }} labelFor={id}>
      <Affixed prefix={prefix} suffix={suffix}>
        <Input
          id={id}
          type="number"
          value={Number.isNaN(field.state.value) ? "" : field.state.value}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.valueAsNumber)}
          aria-invalid={errors.length > 0 || undefined}
          className={inputClassName}
          {...input}
        />
      </Affixed>
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends FieldFrameProps {
  /** Every value it may hold, to name the one chosen. */
  items: ReadonlyArray<SelectOption>;
  /** What can be picked now, when fewer than `items` (an archived one stays named, not offered). */
  options?: ReadonlyArray<SelectOption> | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** The trigger's accessible name, for one whose label is a blank. */
  "aria-label"?: string | undefined;
}

/** One of a list. Picking one, or closing the list without, counts as leaving the field. */
export function SelectField({
  label,
  labelClassName,
  description,
  hint,
  className,
  items,
  options = items,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: SelectFieldProps) {
  const field = useFieldContext<string>();
  const id = useId();
  const errors = useShownErrors(field);
  return (
    <FieldFrame {...{ label, labelClassName, description, hint, className, errors }} labelFor={id}>
      <Select
        items={items}
        value={field.state.value}
        disabled={disabled}
        onValueChange={(value) => {
          field.handleChange(value ?? "");
          field.handleBlur();
        }}
        onOpenChange={(open) => {
          if (!open) field.handleBlur();
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-label={ariaLabel} aria-invalid={errors.length > 0 || undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldFrame>
  );
}

/** On or off, its label beside it. */
export function CheckboxField({
  label,
  description,
  hint,
  className,
  disabled,
}: Omit<FieldFrameProps, "labelClassName"> & { disabled?: boolean | undefined }) {
  const field = useFieldContext<boolean>();
  const id = useId();
  const errors = useShownErrors(field);
  return (
    <Field orientation="horizontal" data-invalid={errors.length > 0} className={className}>
      <Checkbox
        id={id}
        checked={field.state.value}
        disabled={disabled}
        aria-invalid={errors.length > 0 || undefined}
        onCheckedChange={(checked) => {
          field.handleChange(checked);
          field.handleBlur();
        }}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
        {hint}
        <FieldError errors={fieldErrors(errors)} />
      </FieldContent>
    </Field>
  );
}

export interface ChoiceOption {
  value: string;
  /** On its button: short ("Cash", "DuitNow"). */
  label: string;
  /** In full, on hover. */
  title?: string | undefined;
}

/** One of a few, as a row of buttons to tap: how it was paid. */
export function ChoiceField({
  label,
  labelClassName,
  description,
  hint,
  className,
  options,
}: FieldFrameProps & { options: ReadonlyArray<ChoiceOption> }) {
  const field = useFieldContext<string>();
  const id = useId();
  const errors = useShownErrors(field);
  return (
    <FieldFrame {...{ label, labelClassName, description, hint, className, errors }} labelId={id}>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = field.state.value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              variant={checked ? "default" : "outline"}
              size="sm"
              title={option.title}
              onClick={() => {
                field.handleChange(option.value);
                field.handleBlur();
              }}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </FieldFrame>
  );
}

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type" | "children"> & {
  label: ReactNode;
  /** While it saves. */
  pendingLabel?: ReactNode;
};

/**
 * The form's submit. Only off while it saves: one with problems still
 * submits, which shows every error and takes the cursor to the first.
 */
export function SubmitButton({ label, pendingLabel = "Saving…", disabled, ...button }: SubmitButtonProps) {
  const form = useFormContext();
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  return (
    <Button type="submit" disabled={isSubmitting || disabled} {...button}>
      {isSubmitting ? pendingLabel : label}
    </Button>
  );
}
