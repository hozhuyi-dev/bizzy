import { EyeIcon, ListPlusIcon, PlusIcon, SaveIcon, SplitIcon, Trash2Icon } from "lucide-react";
import { DOCUMENT_TYPES } from "../../documents.constant";
import { AddSessions } from "../add-sessions/add-sessions.component";
import { DocumentsMutation } from "../../documents.mutation";
import type { DocumentEditorState } from "./document-editor.hook";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import { Button } from "~/components/ui/button";
import { FieldDescription, FieldGroup } from "~/components/ui/field";
import { BillToSelect } from "~/features/clients/components/bill-to-select/bill-to-select.component";
import { BILLED_TO_HELP } from "~/features/clients/clients.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { emailError, moneyError, requiredError } from "~/core/utils/form.util";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";

/** As the API keeps a client's: what is printed under the name. */
const MAX_ID_NO = 20;

/** As the API keeps a client's billing ID: a company's registration number. */
const MAX_REG_NO = 40;

/** Issue: what the page is for, so it stays in view on a phone. */
export function documentIssueAction(editor: DocumentEditorState): Action {
  const { doc, nextRevision, busy } = editor;
  return {
    type: "button",
    label: nextRevision
      ? `Issue Rev ${String(nextRevision).padStart(2, "0")}`
      : `Issue ${DOCUMENT_TYPES[doc.type].title.toLowerCase()}`,
    style: "primary",
    disabled: busy,
    pending: editor.issuing,
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
  const { doc, busy } = editor;
  return {
    more: [
      {
        type: "button",
        label: "Preview PDF",
        icon: EyeIcon,
        onClick: () => void editor.preview(),
      },
      {
        type: "button",
        label: "Save draft",
        icon: SaveIcon,
        disabled: busy,
        pending: editor.saving && !editor.issuing,
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
 * saves the draft) and adds its own sections around them. Each field says
 * what is missing once it is left, or once the draft is saved, issued or
 * previewed.
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
  // Whom a line is for, when not who pays: its item's, as stored.
  const forName = (id: string) => {
    const line = doc.draft?.lines.find((l) => l.id === id);
    return line?.for ? (line.for.name ?? "") || "someone else" : undefined;
  };

  return [
    {
      id: "details",
      title: "Details",
      content: (
        <div className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Choose its date") }}>
            {(field) => (
              <field.TextField
                label={`${spec.title} date`}
                type="date"
                disabled={locked.date !== undefined}
                hint={<LockedHint lock={locked.date} />}
              />
            )}
          </form.AppField>
        </div>
      ),
    },
    {
      id: "recipient",
      title: spec.recipientLabel,
      content: (
        <FieldGroup>
          <DocumentBillTo editor={editor} />
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField
              name="recipient.name"
              validators={{ onChange: ({ value }) => requiredError(value, "Name who it's for") }}
            >
              {(field) => <field.TextField label="Name" />}
            </form.AppField>
            <form.AppField name="recipient.idNo">
              {(field) => <field.TextField label="IC or passport no." maxLength={MAX_ID_NO} />}
            </form.AppField>
            <form.AppField name="recipient.regNo">
              {(field) => (
                <field.TextField
                  label="Registration no."
                  maxLength={MAX_REG_NO}
                  description="A company's, printed in place of the IC when set."
                />
              )}
            </form.AppField>
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
                disabled: !editor.canMove || editor.busy || editor.adding,
                onClick: () => editor.setAdding(true),
              },
            ]
          : undefined,
      description: editor.hasChanges && doc.can.moveLines.ok ? "Save the draft to add or move sessions." : undefined,
      content: (
        <form.Field name="lines" mode="array">
          {(linesField) => (
            <div className="flex flex-col gap-3">
              {editor.adding && <AddSessions doc={doc} onClose={() => editor.setAdding(false)} />}
              {linesField.state.value.map((line, i) => (
                <div key={i} className="flex flex-col gap-1 border-b pb-3">
                  <div className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_11rem_8rem_auto]">
                    <form.AppField
                      name={`lines[${i}].description`}
                      validators={{ onChange: ({ value }) => requiredError(value, "Describe the line") }}
                    >
                      {(field) => <field.TextField label="Description" />}
                    </form.AppField>
                    <form.AppField name={`lines[${i}].date`}>
                      {(field) => <field.TextField label="Date" type="date" readOnly={line.source !== undefined} />}
                    </form.AppField>
                    <form.AppField
                      name={`lines[${i}].amount`}
                      validators={{ onChange: ({ value }) => moneyError(value, { required: "An amount" }) }}
                    >
                      {(field) => (
                        <field.TextField
                          label="Amount"
                          inputMode="decimal"
                          inputClassName="text-right"
                          readOnly={line.source !== undefined}
                          disabled={locked["lines.amountCents"] !== undefined}
                        />
                      )}
                    </form.AppField>
                    {/* Level with the inputs, under their labels. */}
                    <div className="flex items-center md:mt-6">
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
                  {forName(line.id) && <p className="text-xs text-muted-foreground">for {forName(line.id)}</p>}
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
                  {spec.totalLabel} <b className="text-base">{formatCents(total)}</b>
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
      content: (
        <form.AppField name="notes">
          {(field) => <field.TextareaField label="Notes" labelClassName="sr-only" rows={2} />}
        </form.AppField>
      ),
    },
    {
      id: "issuer",
      title: "Your details",
      description: `Copied from Settings when the draft was made. Changes here only affect this ${title}.`,
      content: (
        <FieldGroup>
          <form.AppField
            name="issuer.name"
            validators={{ onChange: ({ value }) => requiredError(value, "Your business name") }}
          >
            {(field) => <field.TextField label="Business name" disabled={locked["issuer.name"] !== undefined} />}
          </form.AppField>
          <form.AppField name="issuer.registrationNo">
            {(field) => <field.TextField label="Registration no." disabled={locked["issuer.registrationNo"] !== undefined} />}
          </form.AppField>
          <LockedHint
            lock={locked["issuer.name"] ?? locked["issuer.registrationNo"]}
            again={saidAbove(
              locked["issuer.name"] ?? locked["issuer.registrationNo"],
              locked.date,
              locked.lines ?? locked["lines.amountCents"],
            )}
          />
          <form.AppField name="issuer.address">
            {(field) => <field.TextareaField label="Address" rows={2} />}
          </form.AppField>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="issuer.phone">{(field) => <field.TextField label="Phone" type="tel" />}</form.AppField>
            <form.AppField name="issuer.email" validators={{ onChange: ({ value }) => emailError(value) }}>
              {(field) => <field.TextField label="Email" type="email" />}
            </form.AppField>
          </div>
        </FieldGroup>
      ),
    },
  ];
}

/**
 * Who pays (Bill to, Received from): on a draft never issued, another
 * client is picked and saved at once, the recipient filled from them. Not
 * while the draft has changes, which would be lost.
 */
function DocumentBillTo({ editor }: { editor: DocumentEditorState }) {
  const { doc } = editor;
  const setPayer = DocumentsMutation.useSetPayer();
  if (doc.number) return null;
  const why = !doc.can.setPayer.ok ? doc.can.setPayer : editor.hasChanges ? { ok: false, why: "Save the draft first." } : undefined;
  return (
    <BillToSelect
      payer={doc.clientId}
      disabled={why !== undefined || editor.busy || setPayer.isPending}
      onChange={(clientId) => setPayer.mutate({ id: doc.id, clientId }, { onError: toastRefusal })}
      description={`${BILLED_TO_HELP} Lines for someone else say whom.`}
      hint={why && <FieldDescription>{why.why}</FieldDescription>}
    />
  );
}
