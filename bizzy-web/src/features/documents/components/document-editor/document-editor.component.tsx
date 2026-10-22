import { EyeIcon, ListPlusIcon, PlusIcon, SaveIcon, SplitIcon, Trash2Icon } from "lucide-react";
import { DOCUMENT_TYPES } from "../../documents.constant";
import { AddSessionsDialog } from "../add-sessions-dialog/add-sessions-dialog.component";
import type { DocumentEditorState } from "./document-editor.hook";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import type { Verdict } from "~/core/lambda/lambda.types";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { PAYMENT_METHODS } from "~/features/payments/payments.constant";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";

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
    // Saved as it is, the API says; changes are saved first, and it decides then.
    can: editor.hasChanges ? undefined : doc.can.issue,
    onClick: () => void editor.issue(),
  };
}

/**
 * The editor's other actions: `more` beside Issue on wider screens (behind ⋯
 * on a phone), and `menu`, Discard, behind ⋯ on every screen.
 */
export function documentEditorActions(editor: DocumentEditorState): { more: Array<Action>; menu: Array<Action> } {
  const { doc, invalid, busy } = editor;
  return {
    more: [
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
    ],
    menu: [
      {
        type: "button",
        label: doc.number ? "Discard revision" : "Discard draft",
        icon: Trash2Icon,
        style: "destructive",
        disabled: busy,
        can: doc.can.discardDraft,
        onClick: editor.discard,
      },
    ],
  };
}

/**
 * The editor's fields as page sections. The page wraps them in a form (Enter
 * saves the draft) and adds its own sections around them.
 */
export function documentEditorSections(editor: DocumentEditorState): Array<PageSection> {
  const { form, values, doc } = editor;
  // On a revision, what has legal weight: disabled, saying why.
  const { locked } = doc;
  const spec = DOCUMENT_TYPES[doc.type];
  const title = spec.title.toLowerCase();
  const total = values.lines.reduce((sum, line) => sum + (parseCents(line.amount) ?? 0), 0);
  // How many sessions and packages it covers: one alone can't move to a draft of its own.
  const covered = values.lines.filter((line) => line.source).length;

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
                  disabled={locked.date !== undefined}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <LockedHint lock={locked.date} />
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
      // A draft invoice gathers more sessions from the drafts they are on.
      more:
        doc.type === "invoice" && doc.can.moveLines.ok
          ? [
              {
                type: "button",
                label: "Add sessions",
                icon: ListPlusIcon,
                disabled: !editor.canMove || editor.busy,
                onClick: () => editor.setAdding(true),
              },
            ]
          : undefined,
      description: editor.hasChanges && doc.can.moveLines.ok ? "Save the draft to add or move sessions." : undefined,
      content: (
        <form.Field name="lines" mode="array">
          {(linesField) => (
            <div className="flex flex-col gap-3">
              <AddSessionsDialog doc={doc} open={editor.adding} onClose={() => editor.setAdding(false)} />
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
                            disabled={locked["lines.amountCents"] !== undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        </Field>
                      )}
                    </form.Field>
                    <div className="flex items-center">
                      {line.source && line.id && covered > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Move to its own ${title}`}
                          title={`Move to its own ${title}`}
                          disabled={!editor.canMove || editor.busy}
                          onClick={() => editor.moveOut(line.id)}
                        >
                          <SplitIcon />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove line"
                        // What an invoice charges stays on one: it moves, or goes with what it covers.
                        title={line.source && doc.type === "invoice" ? `It stays on an invoice: move it to its own instead` : undefined}
                        disabled={
                          linesField.state.value.length === 1 ||
                          locked.lines !== undefined ||
                          (line.source !== undefined && doc.type === "invoice")
                        }
                        onClick={() => linesField.removeValue(i)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                  {line.source && (
                    <span className="text-xs text-muted-foreground">
                      Covers this {line.source.kind}: its date and amount follow it (the fee, or on a receipt what
                      was paid) until issued.{" "}
                      {doc.type === "invoice"
                        ? "It stays on an invoice: move it to one of its own, or add it to another."
                        : "Removing the line undoes its payment."}
                    </span>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked.lines !== undefined}
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
              {/* One hint for both: its lines and their amounts stay together. */}
              <LockedHint
                lock={locked.lines ?? locked["lines.amountCents"]}
                again={saidAbove(locked.lines ?? locked["lines.amountCents"], locked.date)}
              />
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
          <form.Field name="issuer.name">
            {(field) => <TextInput field={field} label="Business name" lock={locked["issuer.name"]} />}
          </form.Field>
          <form.Field name="issuer.registrationNo">
            {(field) => <TextInput field={field} label="Registration no." lock={locked["issuer.registrationNo"]} />}
          </form.Field>
          <LockedHint
            lock={locked["issuer.name"] ?? locked["issuer.registrationNo"]}
            again={saidAbove(
              locked["issuer.name"] ?? locked["issuer.registrationNo"],
              locked.date,
              locked.lines ?? locked["lines.amountCents"],
            )}
          />
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

interface TextInputProps {
  field: TextFieldApi;
  label: string;
  multiline?: boolean;
  /** Why it can't change now: disabled (the caller says why, once for a group). */
  lock?: Verdict | undefined;
}

function TextInput({ field, label, multiline, lock }: TextInputProps) {
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
          disabled={lock !== undefined}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
        />
      )}
    </Field>
  );
}
