import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, MessageCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { totals } from "./client-activity.util";
import { LastSeen } from "./clients.columns";
import { feeAmountError, feeStartError, toClientFields, toClientValues } from "./clients.form";
import { useSaveClient } from "./clients.hook";
import { ClientsQuery } from "./clients.query";
import { ClientContact } from "./components/client-contact/client-contact.component";
import { ClientDocuments } from "./components/client-documents/client-documents.component";
import { ClientFollowUps } from "./components/client-follow-ups/client-follow-ups.component";
import { ClientTimeline } from "./components/client-timeline/client-timeline.component";
import { contactProblem, toClientRow } from "./clients.util";
import type { ChosenContact, ClientView } from "./clients.types";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { ActivityQuery } from "~/features/activity/activity.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { coveringDocuments, documentRoute, refLabel } from "~/features/documents/documents.util";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { UnsavedChangesPrompt } from "~/components/shared/unsaved-changes-prompt/unsaved-changes-prompt.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatDate, formatHours, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { fieldErrors } from "~/core/utils/form.util";

const FORM_ID = "client-form";

const parent = { to: "/clients", label: "Clients" } as const;

/** `settle`: the calendar edit it was opened to settle; once saved, back to the to-do list. */
export type ClientPageProps =
  | { mode: "edit"; id: string; settle?: string | undefined }
  | {
      mode: "new";
      /** Prefills, e.g. from an unmatched calendar name. */
      initialName?: string | undefined;
      settle?: string | undefined;
    };

/**
 * A client's own page: their profile and Google contact, then their story:
 * activity, a timeline of their sessions with her notes, follow-ups,
 * packages and documents.
 */
export function ClientPage(props: ClientPageProps) {
  const clients = ClientsQuery.useList();

  if (props.mode === "new") {
    return (
      <ClientEditor initialName={props.initialName} settle={props.settle} />
    );
  }

  if (clients.isPending) {
    return (
      <>
        <PageHeader parent={parent} title="…" />
        <Loading />
      </>
    );
  }
  const client = clients.data?.find((c) => c.id === props.id);
  if (!client) {
    return (
      <>
        <PageHeader parent={parent} title="Not available" />
        <p role="alert" className="text-sm text-destructive">
          {clients.error?.message ?? "This client doesn't exist, or was removed."}
        </p>
      </>
    );
  }
  // Keyed so a different client starts the form afresh.
  return <ClientEditor key={client.id} client={client} settle={props.settle} />;
}

interface ClientEditorProps {
  client?: ClientView | undefined;
  initialName?: string | undefined;
  settle?: string | undefined;
}

function ClientEditor({ client, initialName, settle }: ClientEditorProps) {
  const navigate = useNavigate();
  const [contact, setContact] = useState<ChosenContact | null>(client?.contact ?? null);
  const [contactRequired, setContactRequired] = useState(false);
  const settled = useSettleReturn(settle);
  const save = useSaveClient(client, (saved, done) => {
    if (settled) settled(done);
    else if (!client) {
      void navigate({ to: "/clients/$id", params: { id: saved.id }, replace: true, ignoreBlocker: true });
    }
  }, { quiet: Boolean(settled) });

  const form = useForm({
    defaultValues: toClientValues(client, initialName),
    onSubmit: async ({ value, formApi }) => {
      // A new client needs a contact; an existing one may be unlinked.
      if (!contact && !client) {
        setContactRequired(true);
        document.getElementById("contact")?.scrollIntoView({ block: "start" });
        return;
      }
      if (await save.submit(toClientFields(value, client, contact?.resourceName))) formApi.reset(value);
    },
  });

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const hasChanges =
    useStore(form.store, (state) => !state.isDefaultValue) ||
    contact?.resourceName !== client?.contact?.resourceName;
  const whatsapp = useWhatsApp();
  const phone = client?.contact?.phone;
  const problem = client && contactProblem(client);

  const sections: Array<PageSection> = [
    {
      id: "profile",
      title: "Profile",
      content: (
        <FieldGroup>
          <form.Field
            name="name"
            validators={{ onChange: ({ value }) => (value.trim() ? undefined : "Name is required") }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  form={FORM_ID}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  autoComplete="off"
                />
                <FieldDescription>How you know them here; the contact can be named differently.</FieldDescription>
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="aliases">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Other calendar names</FieldLabel>
                <Input
                  id={field.name}
                  form={FORM_ID}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Jane S, Janey"
                  autoComplete="off"
                />
                <FieldDescription>Comma-separated. The name above always matches.</FieldDescription>
              </Field>
            )}
          </form.Field>

          <form.Field name="fees" mode="array">
            {(feesField) => (
              <Field>
                <FieldLabel>Hourly fee</FieldLabel>
                {feesField.state.value.map((_, i) => (
                  <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-start gap-2">
                    <form.Field
                      name={`fees[${i}].amount`}
                      validators={{
                        onChange: ({ value }) => feeAmountError(value),
                        onSubmit: ({ value }) => feeAmountError(value),
                      }}
                    >
                      {(field) => (
                        <Field data-invalid={field.state.meta.errors.length > 0}>
                          <Input
                            aria-label="Amount"
                            form={FORM_ID}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            inputMode="decimal"
                            placeholder="95"
                          />
                          <FieldError errors={fieldErrors(field.state.meta.errors)} />
                        </Field>
                      )}
                    </form.Field>
                    {i === 0 ? (
                      <span className="flex h-8 items-center text-sm text-muted-foreground">
                        {feesField.state.value.length > 1 ? "Until the next one" : "For every session"}
                      </span>
                    ) : (
                      <form.Field
                        name={`fees[${i}].from`}
                        validators={{
                          onChange: ({ value }) => feeStartError(form.getFieldValue("fees"), i, value),
                          onSubmit: ({ value }) => feeStartError(form.getFieldValue("fees"), i, value),
                        }}
                      >
                        {(field) => (
                          <Field data-invalid={field.state.meta.errors.length > 0}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">from</span>
                              <Input
                                aria-label="Starts on"
                                type="date"
                                form={FORM_ID}
                                className="max-w-44"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                              />
                            </div>
                            <FieldError errors={fieldErrors(field.state.meta.errors)} />
                          </Field>
                        )}
                      </form.Field>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove fee"
                      onClick={() => feesField.removeValue(i)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() =>
                    feesField.pushValue({ from: feesField.state.value.length > 0 ? todayISO() : "", amount: "" })
                  }
                >
                  <PlusIcon /> {feesField.state.value.length > 0 ? "New fee from a date" : "Set a fee"}
                </Button>
                <FieldDescription>
                  Charged when a calendar entry has no amount and no package credit. A new fee from a date leaves the
                  sessions before it as they were.
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          <form.Field name="homeVisits">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
                <FieldContent>
                  <FieldLabel htmlFor={field.name}>Usually a home visit</FieldLabel>
                  <FieldDescription>(V) or (H) in a calendar title still wins.</FieldDescription>
                </FieldContent>
              </Field>
            )}
          </form.Field>
        </FieldGroup>
      ),
    },
    {
      id: "contact",
      title: "Google contact",
      description: "Where their phone, email and address live; receipts print the address.",
      content: (
        <Field data-invalid={contactRequired && !contact}>
          <ClientContact
            contact={contact}
            linked={client?.contact}
            searchFor={form.getFieldValue("name") || initialName || ""}
            clientName={client?.name}
            onChange={(next) => {
              setContact(next);
              setContactRequired(false);
              // A new client takes the contact's name unless she typed one.
              if (next?.displayName && !form.getFieldValue("name").trim()) {
                form.setFieldValue("name", next.displayName);
              }
            }}
          />
          {contactRequired && !contact && <FieldError errors={[{ message: "Choose a contact, or create one" }]} />}
        </Field>
      ),
    },
    ...(client
      ? [
          { id: "activity", title: "Activity", content: <Activity client={client} /> },
          { id: "timeline", title: "Sessions", content: <ClientTimeline client={client} /> },
          { id: "follow-ups", title: "Follow-ups", content: <ClientFollowUps client={client} /> },
          { id: "packages", title: "Packages", content: <ClientPackages clientId={client.id} /> },
          { id: "documents", title: "Documents", content: <ClientDocuments client={client} /> },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        parent={parent}
        title={client?.name ?? "New client"}
        actions={[
          {
            type: "submit",
            form: FORM_ID,
            label: isSubmitting ? "Saving…" : client ? "Save" : "Add client",
            style: "primary",
            disabled: isSubmitting,
          },
        ]}
        moreActions={
          whatsapp.canMessage(phone)
            ? [{ type: "button", label: "WhatsApp", icon: MessageCircleIcon, onClick: () => whatsapp.message(phone) }]
            : undefined
        }
        banners={
          (problem || save.error) && (
            <>
              {problem && <Banner tone="attention" icon={CircleAlertIcon} title={`${problem}.`} />}
              {save.error && (
                <Banner tone="attention" icon={CircleAlertIcon} title={save.error.message} role="alert" />
              )}
            </>
          )
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
      <SectionLayout sections={sections} />
      <UnsavedChangesPrompt when={hasChanges} />
    </>
  );
}

function Activity({ client }: { client: ClientView }) {
  const activity = ActivityQuery.useByClient().get(client.id);
  const row = toClientRow(client, activity);
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-3">
      <div className="flex flex-col gap-0.5 sm:col-span-3">
        <dt className="text-xs text-muted-foreground">Last session</dt>
        <dd>
          <LastSeen row={row} />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">Last 12 months</dt>
        <dd>
          {formatCents(row.revenue12Cents)}
          <span className="text-muted-foreground"> · {row.sessions12} sessions</span>
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">Lifetime</dt>
        <dd>
          {formatCents(row.lifetimeCents)}
          <span className="text-muted-foreground"> · {totals(activity).sessions} sessions</span>
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">Last contacted</dt>
        <dd>{client.lastContactedAt ? formatDate(client.lastContactedAt) : "—"}</dd>
      </div>
    </dl>
  );
}

function ClientPackages({ clientId }: { clientId: string }) {
  const packages = PackagesQuery.useList(true);
  if (packages.isPending) return <Loading />;
  const own = (packages.data ?? []).filter((pkg) => pkg.clientId === clientId);
  if (own.length === 0) {
    return <p className="text-sm text-muted-foreground">No packages. Write 10x85 after their name in the calendar.</p>;
  }
  return (
    <ul className="flex flex-col divide-y text-sm">
      {own.map((pkg) => (
        <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>
            {formatHours(pkg.hours)} for {formatCents(pkg.priceCents)}
            <span className="text-muted-foreground"> · bought {formatDate(pkg.purchasedAt)}</span>
          </span>
          <span className="flex items-center gap-3">
            <span className={pkg.creditsLeft > 0 ? undefined : "text-muted-foreground"}>
              {formatHours(pkg.creditsLeft)} of {formatHours(pkg.hours)} left
            </span>
            {coveringDocuments(pkg).length > 0 ? (
              coveringDocuments(pkg).map(({ type, ref, issued }) => (
                <TextLink key={type} to={documentRoute(type)} params={{ id: ref.id }}>
                  {refLabel(type, ref, issued)}
                </TextLink>
              ))
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
