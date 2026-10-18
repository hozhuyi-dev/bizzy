import { EyeIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { DOCUMENT_TYPES } from "../../documents.constant";
import type { DocumentEditorState } from "./document-editor.hook";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { PAYMENT_METHODS } from "~/features/payments/payments.constant";

// The methods she takes; she can still type something else.
const PAID_BY_SUGGESTIONS = PAYMENT_METHODS.map((method) => method.label);

/** Issue: what the page is for, so it stays in view on a phone. */
export function documentIssueAction(editor: DocumentEditorState): Action {
  const { doc, nextRevision, invalid, busy } = editor;
  return {
    type: "button",
    label: editor.issuing
      ? "Issuing…"
      : nextRevision
        ? `Issue Rev ${String(nextRevision).padStart(2, "0")}`
        : `Issue ${DOCUMENT_TYPES[doc.type].title.toLowerCase()}`,
    style: "primary",
    disabled: busy || invalid !== undefined,
    onClick: () => void editor.issue(),
  };
}

/** The editor's other actions: beside Issue on wider screens, behind ⋯ on a phone. */
export function documentEditorActions(editor: DocumentEditorState): Array<Action> {
  const { doc, invalid, busy } = editor;
  return [
    {
      type: "button",
      label: "Preview PDF",
      icon: EyeIcon,
      disabled: invalid !== undefined,
      onClick: () => void editor.preview(),
    },
    {
      type: "button",
      label: editor.saving && !editor.issuing ? "Saving…" : "Save draft",
      icon: SaveIcon,
      disabled: busy || invalid !== undefined,
      onClick: () => void editor.save(),
    },
    {
      type: "button",
      label: doc.number ? "Discard revision" : "Discard draft",
      icon: Trash2Icon,
      style: "destructive",
      disabled: busy,
      onClick: editor.discard,
    },
  ];
}

/**
 * The editor's fields as page sections. The page wraps them in a form (Enter
 * saves the draft) and adds its own sections around them.
 */
export function documentEditorSections(editor: DocumentEditorState): Array<PageSection> {
  const { form, values, doc } = editor;
  const spec = DOCUMENT_TYPES[doc.type];
  const title = spec.title.toLowerCase();
  const total = values.lines.reduce((sum, line) => sum + (parseCents(line.amount) ?? 0), 0);

  return [
    {
      id: "details",
      title: "Details",
      content: (
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="date">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>{spec.title} date</FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          {spec.paid && (
            <form.Field name="paidBy">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Paid by</FieldLabel>
                  <Input
                    id={field.name}
                    list="paid-by-suggestions"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <datalist id="paid-by-suggestions">
                    {PAID_BY_SUGGESTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </Field>
              )}
            </form.Field>
          )}
        </div>
      ),
    },
    {
      id: "recipient",
      title: spec.recipientLabel,
      content: (
        <FieldGroup>
          <form.Field name="recipient.name">{(field) => <TextInput field={field} label="Name" />}</form.Field>
          <form.Field name="recipient.address">
            {(field) => <TextInput field={field} label="Address" multiline />}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="recipient.phone">{(field) => <TextInput field={field} label="Phone" />}</form.Field>
            <form.Field name="recipient.email">{(field) => <TextInput field={field} label="Email" />}</form.Field>
          </div>
        </FieldGroup>
      ),
    },
    {
      id: "lines",
      title: "Lines",
      content: (
        <form.Field name="lines" mode="array">
          {(linesField) => (
            <div className="flex flex-col gap-3">
              {linesField.state.value.map((line, i) => (
                <div key={i} className="flex flex-col gap-1 border-b pb-3">
                  <div className="grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_11rem_8rem_auto]">
                    <form.Field name={`lines[${i}].description`}>
                      {(field) => <TextInput field={field} label="Description" />}
                    </form.Field>
                    <form.Field name={`lines[${i}].date`}>
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor={field.name}>Date</FieldLabel>
                          <Input
                            id={field.name}
                            type="date"
                            readOnly={line.source !== undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name={`lines[${i}].amount`}>
                      {(field) => (
                        <Field data-invalid={parseCents(field.state.value) === null}>
                          <FieldLabel htmlFor={field.name}>Amount</FieldLabel>
                          <Input
                            id={field.name}
                            inputMode="decimal"
                            className="text-right"
                            readOnly={line.source !== undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        </Field>
                      )}
                    </form.Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove line"
                      disabled={linesField.state.value.length === 1}
                      onClick={() => linesField.removeValue(i)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  {line.source && (
                    <span className="text-xs text-muted-foreground">
                      Covers this {line.source.kind}: its date and amount follow it (the fee, or on a receipt what
                      was paid) until issued. Removing the line releases it when issued.
                    </span>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    linesField.pushValue({ id: "", description: "", date: values.date, amount: "", source: undefined })
                  }
                >
                  <PlusIcon /> Add line
                </Button>
                <span className="text-sm">
                  {spec.paid ? "Total paid" : "Total"} <b className="text-base">{formatCents(total)}</b>
                </span>
              </div>
            </div>
          )}
        </form.Field>
      ),
    },
    {
      id: "notes",
      title: "Notes",
      description: `Printed at the bottom of the ${title}.`,
      content: <form.Field name="notes">{(field) => <TextInput field={field} label="Notes" multiline />}</form.Field>,
    },
    {
      id: "issuer",
      title: "Your details",
      description: `Copied from Settings when the draft was made. Changes here only affect this ${title}.`,
      content: (
        <FieldGroup>
          <form.Field name="issuer.name">{(field) => <TextInput field={field} label="Business name" />}</form.Field>
          <form.Field name="issuer.registrationNo">
            {(field) => <TextInput field={field} label="Registration no." />}
          </form.Field>
          <form.Field name="issuer.address">
            {(field) => <TextInput field={field} label="Address" multiline />}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="issuer.phone">{(field) => <TextInput field={field} label="Phone" />}</form.Field>
            <form.Field name="issuer.email">{(field) => <TextInput field={field} label="Email" />}</form.Field>
          </div>
        </FieldGroup>
      ),
    },
  ];
}

/** The part of a TanStack Form field a text input needs. */
interface TextFieldApi {
  name: string;
  state: { value: string };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

function TextInput({ field, label, multiline }: { field: TextFieldApi; label: string; multiline?: boolean }) {
  return (
    <Field>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          id={field.name}
          rows={2}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
        />
      ) : (
        <Input
          id={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
        />
      )}
    </Field>
  );
}
