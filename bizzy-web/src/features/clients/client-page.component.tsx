import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BellPlusIcon,
  CalendarPlusIcon,
  CircleAlertIcon,
  MessageCircleIcon,
  PlusIcon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import { clientLink } from "./clients.columns";
import { feeAmountError, feeStartError, toClientFields, toClientValues } from "./clients.form";
import { useSaveClient } from "./clients.hook";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { ClientContact } from "./components/client-contact/client-contact.component";
import { useClientDocumentsSection } from "./components/client-documents/client-documents.component";
import { ClientOverview } from "./components/client-overview/client-overview.component";
import { ClientPackages } from "./components/client-packages/client-packages.component";
import { ClientTimeline } from "./components/client-timeline/client-timeline.component";
import { DeleteClientDialog } from "./components/delete-client-dialog/delete-client-dialog.component";
import { RecordPaymentDialog } from "./components/record-payment-dialog/record-payment-dialog.component";
import { CLIENTS_LIST } from "./clients.list";
import { clientsListLink, clientsListSearch, contactProblem } from "./clients.util";
import type { ReactNode } from "react";
import type { ChosenContact, ClientView } from "./clients.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import type { ListFilter } from "~/core/list/filter.types";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ActivityQuery } from "~/features/activity/activity.query";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { NewSessionDialog } from "~/features/sessions/components/booking-dialog/booking-dialog.component";
import { Banner } from "~/components/shared/banner/banner.component";
import { ListPager } from "~/components/shared/list-pager/list-pager.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { UnsavedChangesPrompt } from "~/components/shared/unsaved-changes-prompt/unsaved-changes-prompt.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatDate, todayISO } from "~/core/utils/date.util";
import { fieldErrors } from "~/core/utils/form.util";
import { NO_FILTER } from "~/core/list/filter.util";

const FORM_ID = "client-form";

/**
 * `settle`: the calendar edit it was opened to settle; once saved, back to
 * the to-do list. `filter`: All clients or Reconnect, to step through.
 */
export type ClientPageProps =
  | {
      mode: "edit";
      id: string;
      settle?: string | undefined;
      filter: ListFilter;
      onFilterChange: (filter: ListFilter) => void;
    }
  | {
      mode: "new";
      /** Prefills, e.g. from an unmatched calendar name. */
      initialName?: string | undefined;
      settle?: string | undefined;
    };

/**
 * A client's own page: where they stand and what is coming, their story
 * (sessions as its backbone, with what came of each), their documents and
 * packages, then their profile and Google contact. What she does with them
 * is in the header.
 */
export function ClientPage(props: ClientPageProps) {
  const clients = ClientsQuery.useList();

  if (props.mode === "new") {
    return (
      <ClientEditor initialName={props.initialName} settle={props.settle} header={{ parent: clientsListLink(NO_FILTER) }} />
    );
  }

  const { id, filter, onFilterChange } = props;
  const header: ClientHeader = {
    parent: clientsListLink(filter),
    pager: (
      <ListPager
        list={CLIENTS_LIST}
        filter={filter}
        current={{ id }}
        itemLink={(next) => clientLink(next, clientsListSearch(filter))}
        panel={{ onApply: onFilterChange, listLink: clientsListLink }}
      />
    ),
  };

  if (clients.isPending) {
    return (
      <>
        <PageHeader {...header} title="…" />
        <Loading />
      </>
    );
  }
  const client = clients.data?.find((c) => c.id === props.id);
  if (!client) {
    return (
      <>
        <PageHeader {...header} title="Not available" />
        <p role="alert" className="text-sm text-destructive">
          {clients.error?.message ?? "This client doesn't exist, or was removed."}
        </p>
      </>
    );
  }
  // Keyed so a different client starts the form afresh.
  return <ClientEditor key={client.id} client={client} settle={props.settle} header={header} />;
}

/** The header's way back and, for a client, its pager: the same while they load. */
interface ClientHeader {
  parent: ReturnType<typeof clientsListLink>;
  pager?: ReactNode;
}

interface ClientEditorProps {
  client?: ClientView | undefined;
  initialName?: string | undefined;
  settle?: string | undefined;
  header: ClientHeader;
}

function ClientEditor({ client, initialName, settle, header }: ClientEditorProps) {
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
  const owed = ActivityQuery.useByClient().get(client?.id ?? "")?.owedCents ?? 0;
  const documents = useClientDocumentsSection(client);
  const [booking, setBooking] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [paying, setPaying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const archive = ClientsMutation.useArchive();
  const unarchive = ClientsMutation.useUnarchive();

  const details: Array<PageSection> = [
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
  ];
  // A client's story first; a new one is only its details.
  const sections: Array<PageSection> = client
    ? [
        { id: "overview", title: "Overview", content: <ClientOverview client={client} />, bare: true },
        { id: "timeline", title: "Timeline", content: <ClientTimeline client={client} />, bare: true },
        ...(documents ? [documents] : []),
        { id: "packages", title: "Packages", content: <ClientPackages client={client} /> },
        ...details,
      ]
    : details;

  const submit: Action = {
    type: "submit",
    form: FORM_ID,
    label: isSubmitting ? "Saving…" : client ? "Save" : "Add client",
    style: "primary",
    disabled: isSubmitting,
  };
  // What she does with them: behind ⋯ until the header has room beside the
  // pager. Only Save stays out, while the details have changes to keep.
  const actions: Array<Action> = !client || hasChanges ? [submit] : [];
  const more: Array<Action> = client
    ? [
        ...(owed > 0 ? [{ type: "button", label: "Record payment", icon: WalletIcon, onClick: () => setPaying(true) } satisfies Action] : []),
        { type: "button", label: "Follow-up", icon: BellPlusIcon, onClick: () => setFollowUp({ mode: "new", clientId: client.id }) },
        ...(whatsapp.canMessage(phone)
          ? [{ type: "button", label: "WhatsApp", icon: MessageCircleIcon, onClick: () => whatsapp.message(phone) } satisfies Action]
          : []),
        {
          type: "button",
          label: "Book session",
          icon: CalendarPlusIcon,
          style: hasChanges ? "secondary" : "primary",
          onClick: () => setBooking(true),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        {...header}
        title={client?.name ?? "New client"}
        actions={actions}
        moreActions={more}
        foldBelow="lg"
        menuActions={
          client
            ? [
                client.archivedAt
                  ? { type: "button", label: "Unarchive", icon: ArchiveRestoreIcon, can: client.can.unarchive, onClick: () => unarchive.mutate(client.id, { onSuccess: () => toast.success(`${client.name} unarchived`), onError: toastRefusal }) }
                  : { type: "button", label: "Archive", icon: ArchiveIcon, can: client.can.archive, onClick: () => archive.mutate(client.id, { onSuccess: () => toast.success(`${client.name} archived`), onError: toastRefusal }) },
                { type: "button", label: "Delete client", icon: Trash2Icon, style: "destructive", can: client.can.delete, onClick: () => setDeleting(true) },
              ]
            : undefined
        }
        banners={
          (client?.archivedAt || problem || save.error) && (
            <>
              {client?.archivedAt && (
                <Banner tone="neutral" icon={ArchiveIcon} title={`Archived ${formatDate(client.archivedAt)}.`}>
                  Kept with all that is theirs, out of lists and pickers. Unarchive to book them again.
                </Banner>
              )}
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
      {client && (
        <>
          <NewSessionDialog open={booking} clientId={client.id} onClose={() => setBooking(false)} />
          <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
          <RecordPaymentDialog client={client} open={paying} onClose={() => setPaying(false)} />
          <DeleteClientDialog
            client={client}
            open={deleting}
            onClose={() => setDeleting(false)}
            onDeleted={() => void navigate({ ...clientsListLink(NO_FILTER), ignoreBlocker: true })}
          />
        </>
      )}
    </>
  );
}
