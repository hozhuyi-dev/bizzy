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
import { Button } from "~/components/ui/button";
import { useAppForm } from "~/components/shared/form/form.hook";
import { emailError, placeholdersError, wholeNumberError } from "~/core/utils/form.util";
import {
  DEFAULT_DOCUMENT_MESSAGE,
  DEFAULT_PAYMENT_MESSAGE,
  DOCUMENT_PLACEHOLDERS,
  PAYMENT_PLACEHOLDERS,
} from "~/features/whatsapp/whatsapp.constant";
import { documentsPreview, payLinkFirst, paymentPreview } from "~/features/whatsapp/whatsapp-message.util";
import { ComputerWhatsAppSettings } from "~/features/whatsapp/components/computer-whatsapp-settings/computer-whatsapp-settings.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";

export function SettingsPage() {
  const settings = SettingsQuery.useGet();

  if (settings.data) return <SettingsForm saved={settings.data} />;
  return (
    <>
      <PageHeader title="Settings" />
      {settings.error ? (
        <ErrorState error={settings.error} retry={settings.refetch} size="page" />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

const FORM_ID = "settings-form";

const placeholderList = (names: ReadonlyArray<string>) => names.map((name) => `{${name}}`).join(" ");

type Messages = Pick<SettingsView, "paymentMessage" | "documentMessage">;

/** The messages as the form shows them: the app's wording while the user's own is blank. */
function shownMessages<T extends Messages>(values: T): T {
  return {
    ...values,
    paymentMessage: values.paymentMessage || DEFAULT_PAYMENT_MESSAGE,
    documentMessage: values.documentMessage || DEFAULT_DOCUMENT_MESSAGE,
  };
}

/** Saved blank while they are the app's wording, so a better default reaches them. */
function savedMessages<T extends Messages>(values: T): T {
  const own = (value: string, wording: string) => (value.trim() === wording ? "" : value);
  return {
    ...values,
    paymentMessage: own(values.paymentMessage, DEFAULT_PAYMENT_MESSAGE),
    documentMessage: own(values.documentMessage, DEFAULT_DOCUMENT_MESSAGE),
  };
}

function SettingsForm({ saved }: { saved: SettingsView }) {
  const save = SettingsMutation.useSave();

  const form = useAppForm({
    defaultValues: {
      ...shownMessages(saved),
      bankName: saved.bankName ?? "",
      accountName: saved.accountName ?? "",
      accountNo: saved.accountNo ?? "",
      duitNowQr: saved.duitNowQr ?? "",
      payPhone: saved.payPhone ?? "",
      payApps: saved.payApps ?? [],
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(savedMessages(value));
        formApi.reset(shownMessages(value));
        toastWithQuip("Settings saved", QUIPS.saved);
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  // What the message previews fill in, as typed.
  const values = useSelector(form.store, (state) => state.values);

  return (
    <>
      <PageHeader
        title="Settings"
        // Whose details these are, as saved: what invoices and the payment page say.
        subtitle={saved.businessName || undefined}
        actions={[
          {
            type: "submit",
            form: FORM_ID,
            label: "Save settings",
            style: "primary",
            pending: isSubmitting,
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
            description: "Shown on invoices and in the message asking to pay.",
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
              "Every way to pay, on one page the message asking to pay links to. Updates a minute after saving.",
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
              "Typed into the client's chat, ready to send.",
            content: (
              <FieldGroup>
                <form.AppField
                  name="paymentMessage"
                  validators={{ onChange: ({ value }) => placeholdersError(value, PAYMENT_PLACEHOLDERS) }}
                >
                  {(field) => (
                    <field.TextareaField
                      label="Asking to pay"
                      form={FORM_ID}
                      rows={10}
                      description={`When something is owed. Can use ${placeholderList(PAYMENT_PLACEHOLDERS)}`}
                      hint={
                        <MessageHint
                          preview={paymentPreview({ ...values, paymentMessage: field.state.value })}
                          isDefault={field.state.value.trim() === DEFAULT_PAYMENT_MESSAGE}
                          onReset={() => field.handleChange(DEFAULT_PAYMENT_MESSAGE)}
                          note={
                            payLinkFirst(field.state.value)
                              ? undefined
                              : "WhatsApp previews a message's first link: put {payLink} before {items}, whose invoices have links of their own."
                          }
                        />
                      }
                    />
                  )}
                </form.AppField>
                <form.AppField
                  name="documentMessage"
                  validators={{ onChange: ({ value }) => placeholdersError(value, DOCUMENT_PLACEHOLDERS) }}
                >
                  {(field) => (
                    <field.TextareaField
                      label="Sending for records"
                      form={FORM_ID}
                      rows={6}
                      description={`Issued invoices or receipts, when a client asks. Can use ${placeholderList(DOCUMENT_PLACEHOLDERS)}`}
                      hint={
                        <MessageHint
                          preview={documentsPreview({ ...values, documentMessage: field.state.value })}
                          isDefault={field.state.value.trim() === DEFAULT_DOCUMENT_MESSAGE}
                          onReset={() => field.handleChange(DEFAULT_DOCUMENT_MESSAGE)}
                        />
                      }
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
              "Where WhatsApp opens on this computer. Your phone always uses the app.",
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

interface MessageHintProps {
  preview: string;
  isDefault: boolean;
  onReset: () => void;
  /** Something to change in the template: it still works as it is. */
  note?: string | undefined;
}

/** Under a message template: the message as a client would get it, and going back to the app's wording. */
function MessageHint({ preview, isDefault, onReset, note }: MessageHintProps) {
  return (
    <div className="flex flex-col gap-2">
      {note && <p className="rounded-md bg-status-attention p-3 text-sm text-status-attention-foreground">{note}</p>}
      <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">{preview}</p>
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={isDefault} onClick={onReset}>
        Reset to default
      </Button>
    </div>
  );
}
