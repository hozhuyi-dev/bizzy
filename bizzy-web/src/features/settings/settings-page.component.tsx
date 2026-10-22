import { useSelector } from "@tanstack/react-form";
import { ExternalLinkIcon } from "lucide-react";
import { DuitNowQrField } from "./components/duitnow-qr-field/duitnow-qr-field.component";
import { PAY_APP_OPTIONS, PAY_URL } from "./settings.constant";
import { SettingsMutation } from "./settings.mutation";
import { SettingsQuery } from "./settings.query";
import type { SettingsView } from "./settings.types";
import { CAN_RESET } from "~/features/reset/reset.constant";
import { ResetData } from "~/features/reset/components/reset-data/reset-data.component";
import { GoogleConnectionSettings } from "~/features/google/components/google-connection/google-connection.component";
import { AppearanceSettings } from "~/features/theme/components/appearance-settings/appearance-settings.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { FieldGroup } from "~/components/ui/field";
import { useAppForm } from "~/components/shared/form/form.hook";
import { emailError, placeholdersError, wholeNumberError } from "~/core/utils/form.util";
import { queryMatch } from "~/core/utils/query.util";
import { DOCUMENT_PLACEHOLDERS, PAYMENT_PLACEHOLDERS } from "~/features/whatsapp/whatsapp.constant";
import { ComputerWhatsAppSettings } from "~/features/whatsapp/components/computer-whatsapp-settings/computer-whatsapp-settings.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

export function SettingsPage() {
  const settings = SettingsQuery.useGet();

  return queryMatch(settings, {
    pending: () => (
      <>
        <PageHeader title="Settings" />
        <LoadingState />
      </>
    ),
    error: (error) => (
      <>
        <PageHeader title="Settings" />
        <ErrorMessage>{error.message}</ErrorMessage>
      </>
    ),
    success: (data) => <SettingsForm saved={data} />,
  });
}

const FORM_ID = "settings-form";

const placeholderList = (names: ReadonlyArray<string>) => names.map((name) => `{${name}}`).join(" ");

function SettingsForm({ saved }: { saved: SettingsView }) {
  const save = SettingsMutation.useSave();

  const form = useAppForm({
    defaultValues: {
      ...saved,
      bankName: saved.bankName ?? "",
      accountName: saved.accountName ?? "",
      accountNo: saved.accountNo ?? "",
      duitNowQr: saved.duitNowQr ?? "",
      payPhone: saved.payPhone ?? "",
      payApps: saved.payApps ?? [],
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value);
        formApi.reset(value);
        toastWithQuip("Settings saved", QUIPS.saved);
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  return (
    <>
      <PageHeader
        title="Settings"
        actions={[
          {
            type: "submit",
            form: FORM_ID,
            label: isSubmitting ? "Saving…" : "Save settings",
            style: "primary",
            disabled: isSubmitting,
          },
        ]}
      />
      {/* Inputs join this form through their form attribute, so Enter saves. */}
      <form
        id={FORM_ID}
        hidden
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      />
      <PageSections
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
            content: (
              <FieldGroup>
                <form.AppField name="businessName">
                  {(field) => <field.TextField label="Business name" form={FORM_ID} />}
                </form.AppField>
                <form.AppField name="registrationNo">
                  {(field) => (
                    <field.TextField
                      label="Registration no."
                      form={FORM_ID}
                      description="Your SSM number, printed under the name."
                    />
                  )}
                </form.AppField>
                <form.AppField name="address">
                  {(field) => (
                    <field.TextareaField
                      label="Address"
                      form={FORM_ID}
                      rows={3}
                      description="Optional. Printed under your name when given."
                    />
                  )}
                </form.AppField>
                <form.AppField name="phone">
                  {(field) => <field.TextField label="Phone" type="tel" form={FORM_ID} />}
                </form.AppField>
                <form.AppField name="email" validators={{ onChange: ({ value }) => emailError(value) }}>
                  {(field) => <field.TextField label="Email" type="email" form={FORM_ID} />}
                </form.AppField>
              </FieldGroup>
            ),
          },
          {
            id: "bank",
            title: "Bank details",
            description: "Printed on invoices and sent in the WhatsApp message asking to pay, so all three are needed. Receipts confirm money already paid, so they don't print them.",
            content: (
              <div className="grid gap-4 sm:grid-cols-3">
                <form.AppField name="bankName">{(field) => <field.TextField label="Bank" form={FORM_ID} />}</form.AppField>
                <form.AppField name="accountName">
                  {(field) => <field.TextField label="Account name" form={FORM_ID} />}
                </form.AppField>
                <form.AppField name="accountNo">
                  {(field) => <field.TextField label="Account no." inputMode="numeric" form={FORM_ID} />}
                </form.AppField>
              </div>
            ),
          },
          {
            id: "payment-page",
            title: "Payment page",
            description:
              "One page with every way to pay: your DuitNow QR, bank details and the phone number e-wallets pay. The message asking to pay links to it ({payLink}). Saving updates it within a minute.",
            actions: PAY_URL
              ? [{ type: "external", label: "Open page", icon: ExternalLinkIcon, href: PAY_URL }]
              : undefined,
            content: (
              <FieldGroup>
                <form.AppField name="duitNowQr">
                  {(field) => <DuitNowQrField value={field.state.value} onChange={field.handleChange} />}
                </form.AppField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.AppField name="payPhone">
                    {(field) => (
                      <field.TextField
                        label="Phone clients pay to"
                        type="tel"
                        form={FORM_ID}
                        placeholder={saved.phone || undefined}
                        description="Blank uses your phone number above."
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="payApps">
                    {(field) => (
                      <field.ChoicesField
                        label="It takes"
                        options={PAY_APP_OPTIONS}
                        description="None leaves the phone number off the page."
                      />
                    )}
                  </form.AppField>
                </div>
              </FieldGroup>
            ),
          },
          {
            id: "sessions",
            title: "Sessions",
            description:
              "In a calendar title, (V) marks a home visit and (H) your place, like “Jane (V) 95”. Without either, a session is at the client's usual place.",
            content: (
              <FieldGroup>
                <form.AppField name="serviceName">
                  {(field) => (
                    <field.TextField
                      label="Session description"
                      form={FORM_ID}
                      description="How a session reads on an invoice or receipt line."
                    />
                  )}
                </form.AppField>
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
                <form.AppField
                  name="paymentMessage"
                  validators={{ onChange: ({ value }) => placeholdersError(value, PAYMENT_PLACEHOLDERS) }}
                >
                  {(field) => (
                    <field.TextareaField
                      label="Asking for payment"
                      form={FORM_ID}
                      rows={3}
                      description={`From a session, or a package bought on its own. {item} reads "your session on 5 Oct 2026" or "your 10-hour package", {payLink} is your payment page, and {ref} is the invoice number, or the client's name and the day ("AISYAH 05OCT") until one is issued. ${placeholderList(PAYMENT_PLACEHOLDERS)}`}
                    />
                  )}
                </form.AppField>
                <form.AppField
                  name="documentMessage"
                  validators={{ onChange: ({ value }) => placeholdersError(value, DOCUMENT_PLACEHOLDERS) }}
                >
                  {(field) => (
                    <field.TextareaField
                      label="Sending documents"
                      form={FORM_ID}
                      rows={3}
                      description={`From an invoice or receipt, a session or a client; {documents} lists each with its link, and {title} reads "invoice", "receipts" or "documents" as it fits. ${placeholderList(DOCUMENT_PLACEHOLDERS)}`}
                    />
                  )}
                </form.AppField>
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
                  <form.AppField
                    name="confirmAheadDays"
                    validators={{ onChange: ({ value }) => wholeNumberError(value, 1, 30) }}
                  >
                    {(field) => (
                      <field.NumberField
                        label="Confirm sessions"
                        form={FORM_ID}
                        min={1}
                        max={30}
                        inputClassName="w-20"
                        suffix="days ahead"
                        description="When an unconfirmed (?) session comes up, to check the time with the client."
                      />
                    )}
                  </form.AppField>
                  <form.AppField
                    name="followUpAheadDays"
                    validators={{ onChange: ({ value }) => wholeNumberError(value, 1, 30) }}
                  >
                    {(field) => (
                      <field.NumberField
                        label="Follow-ups"
                        form={FORM_ID}
                        min={1}
                        max={30}
                        inputClassName="w-20"
                        suffix="days ahead"
                        description="When a follow-up comes up before it is due."
                      />
                    )}
                  </form.AppField>
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
      <UnsavedChangesDialog when={hasChanges} />
    </>
  );
}
