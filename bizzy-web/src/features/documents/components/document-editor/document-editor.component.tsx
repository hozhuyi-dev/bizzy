import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { EyeIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { DocumentsMutation } from "../../documents.query";
import { toContent, toFormValues } from "../../documents.form";
import { DOCUMENT_TYPES } from "../../documents.registry";
import { openDocumentPdf } from "../../pdf/download-pdf";
import type { ContentValues } from "../../documents.form";
import type { BizDocument, DocumentContent } from "../../documents.types";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { formatCents, parseCents } from "~/core/utils/money.util";

const PAID_BY_SUGGESTIONS = ["Cash", "Bank transfer", "DuitNow QR", "Card"];

/**
 * Free editing of everything printed on the document. Nothing is final until
 * Issue; a revision keeps its number. Split into a hook, its actions and its
 * fields so the page can put the actions in its header.
 */
export function useDocumentEditor(doc: BizDocument, draft: DocumentContent) {
  const save = DocumentsMutation.useSaveDraft();
  const issue = DocumentsMutation.useIssue();
  const discard = DocumentsMutation.useDiscardDraft();
  const navigate = useNavigate();
  const nextRevision = doc.number ? (doc.revision ?? 0) + 1 : undefined;

  const form = useForm({ defaultValues: toFormValues(draft) });
  const values = useStore(form.store, (state) => state.values);
  const content = toContent(values);
  const invalid = validate(values);

  const saveDraft = () => save.mutateAsync({ doc, content });

  return {
    doc,
    form,
    values,
    invalid,
    nextRevision,
    saving: save.isPending,
    issuing: issue.isPending,
    busy: save.isPending || issue.isPending || discard.isPending,

    save: async () => {
      try {
        await saveDraft();
        toast.success("Draft saved");
      } catch (error) {
        toast.error((error as Error).message);
      }
    },

    issue: async () => {
      try {
        const saved = await saveDraft();
        if (!saved) return;
        const issued = await issue.mutateAsync(saved);
        toast.success(`Issued ${issued?.number ?? ""}`);
      } catch (error) {
        toast.error((error as Error).message);
      }
    },

    discard: () =>
      discard.mutate(doc, {
        onSuccess: () => {
          if (doc.number) {
            toast.success("Revision discarded");
            return;
          }
          // A draft never issued is deleted, so its page is gone too.
          toast.success("Draft discarded");
          void navigate({ to: "/receipts" });
        },
        onError: (error) => toast.error(error.message),
      }),

    /** The real PDF, watermarked DRAFT, from what is on screen now. */
    preview: () =>
      openDocumentPdf({ type: doc.type, number: doc.number, revision: nextRevision, watermark: "DRAFT", content }).catch(
        (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't make the PDF"),
      ),
  };
}

export type DocumentEditorState = ReturnType<typeof useDocumentEditor>;

export function DocumentEditorActions({ editor }: { editor: DocumentEditorState }) {
  const { doc, nextRevision, invalid, busy } = editor;
  const title = DOCUMENT_TYPES[doc.type].title.toLowerCase();

  return (
    <>
      <Button variant="outline" disabled={invalid !== undefined} onClick={() => void editor.preview()}>
        <EyeIcon /> Preview PDF
      </Button>
      <Button variant="ghost" disabled={busy} onClick={editor.discard}>
        {doc.number ? "Discard revision" : "Discard draft"}
      </Button>
      <Button variant="outline" disabled={busy || invalid !== undefined} onClick={() => void editor.save()}>
        {editor.saving && !editor.issuing ? "Saving…" : "Save draft"}
      </Button>
      <Button disabled={busy || invalid !== undefined} onClick={() => void editor.issue()}>
        {editor.issuing
          ? "Issuing…"
          : nextRevision
            ? `Issue Rev ${String(nextRevision).padStart(2, "0")}`
            : `Issue ${title}`}
      </Button>
    </>
  );
}

export function DocumentEditorFields({ editor }: { editor: DocumentEditorState }) {
  const { form, values, doc, invalid } = editor;
  const spec = DOCUMENT_TYPES[doc.type];
  const total = values.lines.reduce((sum, line) => sum + (parseCents(line.amount) ?? 0), 0);

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        void editor.save();
      }}
    >
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {invalid}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <FieldGroup>
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

          <FieldSet>
            <FieldLegend variant="label">{spec.recipientLabel}</FieldLegend>
            <form.Field name="recipient.name">
              {(field) => <TextInput field={field} label="Name" />}
            </form.Field>
            <form.Field name="recipient.address">
              {(field) => <TextInput field={field} label="Address" multiline />}
            </form.Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="recipient.phone">
                {(field) => <TextInput field={field} label="Phone" />}
              </form.Field>
              <form.Field name="recipient.email">
                {(field) => <TextInput field={field} label="Email" />}
              </form.Field>
            </div>
          </FieldSet>
        </FieldGroup>

        <FieldSet>
          <FieldLegend variant="label">Your details on this {spec.title.toLowerCase()}</FieldLegend>
          <form.Field name="issuer.name">
            {(field) => <TextInput field={field} label="Business name" />}
          </form.Field>
          <form.Field name="issuer.registrationNo">
            {(field) => <TextInput field={field} label="Registration no." />}
          </form.Field>
          <form.Field name="issuer.address">
            {(field) => <TextInput field={field} label="Address" multiline />}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="issuer.phone">
              {(field) => <TextInput field={field} label="Phone" />}
            </form.Field>
            <form.Field name="issuer.email">
              {(field) => <TextInput field={field} label="Email" />}
            </form.Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Copied from Settings when the draft was made. Changes here only affect this document.
          </p>
        </FieldSet>
      </div>

      <form.Field name="lines" mode="array">
        {(linesField) => (
          <FieldSet>
            <FieldLegend variant="label">Lines</FieldLegend>
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
                    Covers this {line.source.kind}. Removing the line releases it when issued.
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
                  linesField.pushValue({ description: "", date: values.date, amount: "", source: undefined })
                }
              >
                <PlusIcon /> Add line
              </Button>
              <span className="text-sm">
                {spec.paid ? "Total paid" : "Total"} <b className="text-base">{formatCents(total)}</b>
              </span>
            </div>
          </FieldSet>
        )}
      </form.Field>

      <form.Field name="notes">
        {(field) => <TextInput field={field} label="Notes" multiline />}
      </form.Field>
    </form>
  );
}

function validate(values: ContentValues): string | undefined {
  if (!values.date) return "Choose a date.";
  if (!values.recipient.name.trim()) return "Who it's for is required.";
  if (values.lines.some((line) => !line.description.trim())) return "Every line needs a description.";
  if (values.lines.some((line) => parseCents(line.amount) === null)) return "Amounts look like 95 or 95.50.";
  return undefined;
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
