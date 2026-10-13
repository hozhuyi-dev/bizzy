import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { SettingsMutation, SettingsQuery } from "./settings.query";
import { EVENT_COLOURS } from "./settings.types";
import type { Settings } from "./settings.types";
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
import { DOCUMENT_PLACEHOLDERS, PAYMENT_PLACEHOLDERS } from "~/features/whatsapp/whatsapp.message";
import { ComputerWhatsAppSettings } from "~/features/whatsapp/components/computer-whatsapp-settings/computer-whatsapp-settings.component";

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

type TextKey = Exclude<keyof Settings, "homeVisitColorId" | "confirmAheadDays" | "followUpAheadDays">;

const placeholderList = (names: ReadonlyArray<string>) => names.map((name) => `{${name}}`).join(" ");

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
            description: "Printed on every invoice and receipt. Issued ones keep what they printed.",
            content: <FieldGroup>{BUSINESS_FIELDS.map(textField)}</FieldGroup>,
          },
          {
            id: "bank",
            title: "Bank details",
            description: "Optional. Printed on invoices and sent when asking to pay; receipts confirm money already paid, so they don't print them.",
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
                  hint: "How a session reads on an invoice or receipt line.",
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
            id: "whatsapp",
            title: "WhatsApp messages",
            description:
              "WhatsApp opens the client's chat with the message typed in, ready to send. Leave one blank to go back to the default.",
            content: (
              <FieldGroup>
                {textField({
                  name: "paymentMessage",
                  label: "Asking to pay",
                  multiline: true,
                  hint: `From a session. ${placeholderList(PAYMENT_PLACEHOLDERS)}`,
                })}
                {textField({
                  name: "documentMessage",
                  label: "Sending receipts",
                  multiline: true,
                  hint: `From a receipt, a session or a client; {documents} lists each with its link, and {title} reads "receipt", "receipts" or "documents". ${placeholderList(DOCUMENT_PLACEHOLDERS)}`,
                })}
              </FieldGroup>
            ),
          },
          {
            id: "whatsapp-computer",
            title: "WhatsApp on PC",
            description:
              "Browser opens WhatsApp Web in a new tab each time; the desktop app needs WhatsApp installed. Changes right away and is remembered on this device. Your phone always uses the WhatsApp app.",
            content: <ComputerWhatsAppSettings />,
          },
          {
            id: "todo",
            title: "To do",
            description: "What goes on your to-do list on Home, and how far ahead.",
            content: (
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="confirmAheadDays">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Confirm sessions</FieldLabel>
                        <div className="flex items-center gap-2">
                          <Input
                            id={field.name}
                            form={FORM_ID}
                            type="number"
                            min={1}
                            max={30}
                            className="w-20"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(Number(e.target.value))}
                          />
                          <span className="text-sm text-muted-foreground">days ahead</span>
                        </div>
                        <FieldDescription>When an unconfirmed (?) session comes up, to check the time with the client.</FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="followUpAheadDays">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Follow-ups</FieldLabel>
                        <div className="flex items-center gap-2">
                          <Input
                            id={field.name}
                            form={FORM_ID}
                            type="number"
                            min={1}
                            max={30}
                            className="w-20"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(Number(e.target.value))}
                          />
                          <span className="text-sm text-muted-foreground">days ahead</span>
                        </div>
                        <FieldDescription>When a follow-up comes up before it is due.</FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                </div>
              </FieldGroup>
            ),
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
