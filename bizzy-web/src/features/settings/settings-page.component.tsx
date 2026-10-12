import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { SettingsMutation, SettingsQuery } from "./settings.query";
import { EVENT_COLOURS } from "./settings.types";
import type { Settings } from "./settings.types";
import {
  DocumentsMutation,
  DocumentsQuery,
} from "~/features/documents/documents.query";
import { CAN_RESET } from "~/features/reset/reset.query";
import { ResetData } from "~/features/reset/components/reset-data/reset-data.component";
import { GoogleConnectionSettings } from "~/features/google/components/google-connection/google-connection.component";
import { AppearanceSettings } from "~/features/theme/components/appearance-settings/appearance-settings.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { queryMatch } from "~/core/utils/query.util";

export function SettingsPage() {
  const settings = SettingsQuery.useGet();

  return queryMatch(settings, {
    pending: () => (
      <>
        <PageHeader title="Settings" />
        <Loading />
      </>
    ),
    error: (error) => (
      <>
        <PageHeader title="Settings" />
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      </>
    ),
    success: (data) => <SettingsForm saved={data} />,
  });
}

const FORM_ID = "settings-form";

type TextKey = Exclude<keyof Settings, "numbering" | "homeVisitColorId">;

const BUSINESS_FIELDS: Array<{
  name: TextKey;
  label: string;
  multiline?: boolean;
  hint?: string;
}> = [
  { name: "businessName", label: "Business name" },
  {
    name: "registrationNo",
    label: "Registration no.",
    hint: "Your SSM number, printed under the name.",
  },
  { name: "address", label: "Address", multiline: true },
  { name: "phone", label: "Phone" },
  { name: "email", label: "Email" },
];

const BANK_FIELDS: Array<{ name: TextKey; label: string }> = [
  { name: "bankName", label: "Bank" },
  { name: "accountName", label: "Account name" },
  { name: "accountNo", label: "Account no." },
];

function SettingsForm({ saved }: { saved: Settings }) {
  const save = SettingsMutation.useSave();

  const form = useForm({
    defaultValues: {
      ...saved,
      bankName: saved.bankName ?? "",
      accountName: saved.accountName ?? "",
      accountNo: saved.accountNo ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        await save.mutateAsync(value);
        toast.success("Settings saved");
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  const colourItems = EVENT_COLOURS.map((colour) => ({
    value: colour.id,
    label: colour.name,
  }));

  const textField = ({
    name,
    label,
    multiline,
    hint,
  }: {
    name: TextKey;
    label: string;
    multiline?: boolean;
    hint?: string;
  }) => (
    <form.Field key={name} name={name}>
      {(field) => (
        <Field>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          {multiline ? (
            <Textarea
              id={field.name}
              form={FORM_ID}
              rows={3}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          ) : (
            <Input
              id={field.name}
              form={FORM_ID}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
          {hint && <FieldDescription>{hint}</FieldDescription>}
        </Field>
      )}
    </form.Field>
  );

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save settings"}
              </Button>
            )}
          </form.Subscribe>
        }
      />
      {/* Inputs join this form through their form attribute, so Enter saves. */}
      <form
        id={FORM_ID}
        hidden
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      />
      <SectionLayout
        sections={[
          {
            id: "google",
            title: "Google",
            description:
              "Sessions are read from a calendar in this account, and every client is linked to one of its contacts, so their details are on your phone too.",
            content: <GoogleConnectionSettings />,
          },
          {
            id: "business",
            title: "Your business",
            description: "Printed on every receipt. Issued receipts keep what they printed.",
            content: <FieldGroup>{BUSINESS_FIELDS.map(textField)}</FieldGroup>,
          },
          {
            id: "bank",
            title: "Bank details",
            description: "Optional. Receipts confirm money already paid, so they don't print these.",
            content: <div className="grid gap-4 sm:grid-cols-3">{BANK_FIELDS.map(textField)}</div>,
          },
          {
            id: "sessions",
            title: "Sessions",
            content: (
              <FieldGroup>
                {textField({
                  name: "serviceName",
                  label: "Session description",
                  hint: "How a session reads on a receipt line.",
                })}
                <form.Field name="homeVisitColorId">
                  {(field) => (
                    <Field>
                      <FieldLabel>Home visit colour</FieldLabel>
                      <Select
                        items={colourItems}
                        value={field.state.value}
                        onValueChange={(value) => value && field.handleChange(value)}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EVENT_COLOURS.map((colour) => (
                            <SelectItem key={colour.id} value={colour.id}>
                              <span className="size-3 rounded-full" style={{ backgroundColor: colour.hex }} />
                              {colour.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Give a calendar entry this colour to mark a home visit. Any other colour means
                        your place; no colour follows the client's usual.
                      </FieldDescription>
                    </Field>
                  )}
                </form.Field>
              </FieldGroup>
            ),
          },
          {
            id: "numbering",
            title: "Receipt numbers",
            description: "Numbers are taken when a receipt is issued and are never reused.",
            content: <ReceiptNumbering />,
          },
          {
            id: "appearance",
            title: "Appearance",
            description:
              "Changes right away and is remembered on this device. System follows your phone or computer.",
            content: <AppearanceSettings />,
          },
          ...(CAN_RESET
            ? [
                {
                  id: "reset",
                  title: "Reset",
                  description: `Only in ${import.meta.env.MODE}. Starts this environment over from your calendar.`,
                  content: <ResetData />,
                },
              ]
            : []),
        ]}
      />
    </>
  );
}

/**
 * The receipt number format and where the sequence is. Moving the sequence
 * forward lets her continue from her old receipt book.
 */
function ReceiptNumbering() {
  const settings = SettingsQuery.useGet();
  const numbering = DocumentsQuery.useNumbering("receipt");
  const saveSettings = SettingsMutation.useSave();
  const setNext = DocumentsMutation.useSetNextNumber();
  const [template, setTemplate] = useState<string | null>(null);
  const [next, setNextValue] = useState("");

  const currentTemplate = template ?? numbering.data?.template ?? "";

  return (
    <>
      <p className="text-sm">
        Next receipt: <b>{numbering.data?.next ?? "…"}</b>
      </p>

      <Field>
        <FieldLabel htmlFor="numbering-template">Format</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="numbering-template"
            className="max-w-56"
            value={currentTemplate}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={
              !settings.data || template === null || saveSettings.isPending
            }
            onClick={() => {
              if (!settings.data) return;
              saveSettings.mutate(
                {
                  ...settings.data,
                  numbering: {
                    ...settings.data.numbering,
                    receipt: currentTemplate,
                  },
                },
                {
                  onSuccess: () => {
                    setTemplate(null);
                    void numbering.refetch();
                    toast.success("Format saved");
                  },
                  onError: (error) => toast.error(error.message),
                },
              );
            }}
          >
            Save format
          </Button>
        </div>
        <FieldDescription>
          {"{seq:4}"} is the running number padded to 4 digits; add {"{YYYY}"}{" "}
          or {"{YY}"} to restart every year. For example RCP-{"{seq:4}"} or R
          {"{YY}"}-{"{seq:3}"}.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="next-number">Continue from</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="next-number"
            className="max-w-32"
            inputMode="numeric"
            placeholder={numbering.data ? String(numbering.data.seq) : ""}
            value={next}
            onChange={(e) => setNextValue(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!/^\d+$/.test(next) || setNext.isPending}
            onClick={() =>
              setNext.mutate(
                { type: "receipt", next: Number(next) },
                {
                  onSuccess: (result) => {
                    setNextValue("");
                    toast.success(`Next receipt will be ${result.next}`);
                  },
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            Set next number
          </Button>
        </div>
        <FieldDescription>
          Only moves forward, so a number can never be issued twice.
        </FieldDescription>
      </Field>
    </>
  );
}
