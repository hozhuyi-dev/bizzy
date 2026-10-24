import { useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BellPlusIcon,
  CalendarPlusIcon,
  CircleAlertIcon,
  MessageCircleIcon,
  PackagePlusIcon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import { clientLink } from "./clients.columns";
import { toClientFields, toClientValues } from "./clients.form";
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
import { clientsListLink, clientsUrl, contactProblem } from "./clients.util";
import type { ReactNode } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { ClientFormValues } from "./clients.form";
import type { ChosenContact, ClientView } from "./clients.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import type { ListFilter } from "~/core/list/filter.types";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ActivityQuery } from "~/features/activity/activity.query";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { PackageDialog } from "~/features/packages/components/package-dialog/package-dialog.component";
import { NewSessionDialog } from "~/features/sessions/components/booking-dialog/booking-dialog.component";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { Field, FieldError, FieldGroup } from "~/components/ui/field";
import { formatDate } from "~/core/utils/date.util";
import { fieldErrors, moneyError, requiredError } from "~/core/utils/form.util";
import { useAppForm } from "~/components/shared/form/form.hook";
import { NO_FILTER } from "~/core/list/filter.util";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";
import { allOf } from "~/core/utils/query.util";

const FORM_ID = "client-form";

/** As the API keeps it: a MyKad is 14 characters with its dashes; passports are shorter. */
const MAX_ID_NO = 20;

/** The profile, and the Google contact it is linked to. */
type ClientEditorValues = ClientFormValues & { contact: ChosenContact | null };

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
  // What they owe is in the header: it opens with it.
  const activity = ActivityQuery.useList();

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
        itemLink={(next) => clientLink(next, clientsUrl.toSearch(filter))}
        panel={{ onApply: onFilterChange, listLink: clientsListLink }}
      />
    ),
  };

  const back = { label: "Back to Clients", link: header.parent as LinkOptions };
  if (clients.data && activity.data) {
    const client = clients.data.find((c) => c.id === props.id);
    // Keyed so a different client starts the form afresh.
    if (client) return <ClientEditor key={client.id} client={client} settle={props.settle} header={header} />;
    return (
      <>
        <PageHeader {...header} title="Not available" />
        <NotFoundPage message="This client was deleted." back={back} />
      </>
    );
  }
  const page = allOf(clients, activity);
  return (
    <>
      <PageHeader {...header} title={page.error ? "Not available" : "…"} />
      {page.error ? (
        <ErrorState error={page.error} retry={page.refetch} size="page" back={back} />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
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
  const settled = useSettleReturn(settle);
  const save = useSaveClient(client, (saved, done) => {
    if (settled) settled(done);
    else if (!client) {
      void navigate({ to: "/clients/$id", params: { id: saved.id }, replace: true, ignoreBlocker: true });
    }
  }, { quiet: Boolean(settled) });

  const defaultValues: ClientEditorValues = { ...toClientValues(client, initialName), contact: client?.contact ?? null };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      if (await save.submit(toClientFields(value, client, value.contact?.resourceName))) formApi.reset(value);
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  const whatsapp = useWhatsApp();
  const phone = client?.contact?.phone;
  const problem = client && contactProblem(client);
  const owed = ActivityQuery.useByClient().get(client?.id ?? "")?.owedCents ?? 0;
  const documents = useClientDocumentsSection(client);
  const [booking, setBooking] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [paying, setPaying] = useState(false);
  const [addingPackage, setAddingPackage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const archive = ClientsMutation.useArchive();
  const unarchive = ClientsMutation.useUnarchive();

  const details: Array<PageSection> = [
    {
      id: "profile",
      title: "Profile",
      content: (
        <FieldGroup>
          <form.AppField name="name" validators={{ onChange: ({ value }) => requiredError(value, "Name is required") }}>
            {(field) => (
              <field.TextField
                label="Name"
                form={FORM_ID}
                autoComplete="off"
                description="How you know them here; the contact can be named differently."
              />
            )}
          </form.AppField>

          <form.AppField name="aliases">
            {(field) => (
              <field.TextField
                label="Other calendar names"
                form={FORM_ID}
                placeholder="Jane S, Janey"
                autoComplete="off"
                description="Comma-separated. The name above always matches."
              />
            )}
          </form.AppField>

          <form.AppField name="idNo">
            {(field) => (
              <field.TextField
                label="IC or passport no."
                form={FORM_ID}
                placeholder="900101-14-5678"
                maxLength={MAX_ID_NO}
                autoComplete="off"
                description="Printed under their name on invoices and receipts."
              />
            )}
          </form.AppField>

          <form.AppField name="fee" validators={{ onChange: ({ value }) => moneyError(value) }}>
            {(field) => (
              <field.TextField
                label="Hourly fee"
                form={FORM_ID}
                inputMode="decimal"
                placeholder="95"
                inputClassName="max-w-44"
                description="Charged when a session is booked with no amount and no package credit. A new fee leaves sessions booked already as they were."
              />
            )}
          </form.AppField>

          <form.AppField name="homeVisits">
            {(field) => <field.CheckboxField label="Usually a home visit" description="(V) or (H) in a calendar title still wins." />}
          </form.AppField>
        </FieldGroup>
      ),
    },
    {
      id: "contact",
      title: "Google contact",
      description: "Where their phone, email and address live.",
      content: (
        <form.Field
          name="contact"
          // A new client needs a contact; an existing one may be unlinked.
          validators={{ onSubmit: ({ value }) => (!value && !client ? "Choose a contact, or create one" : undefined) }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <ClientContact
                contact={field.state.value}
                linked={client?.contact}
                searchFor={form.getFieldValue("name") || initialName || ""}
                clientName={client?.name}
                onChange={(next) => {
                  // The contact it had, picked again, is no change.
                  field.handleChange(next && next.resourceName === client?.contact?.resourceName ? client.contact : next);
                  // A new client takes the contact's name unless one was typed.
                  if (next?.displayName && !form.getFieldValue("name").trim()) {
                    form.setFieldValue("name", next.displayName);
                  }
                }}
              />
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>
      ),
    },
  ];
  // A client's story first; a new one is only its details.
  const sections: Array<PageSection> = client
    ? [
        { id: "overview", title: "Overview", content: <ClientOverview client={client} />, bare: true },
        { id: "timeline", title: "Timeline", content: <ClientTimeline client={client} />, bare: true },
        ...(documents ? [documents] : []),
        {
          id: "packages",
          title: "Packages",
          actions: [{ type: "button", label: "Add package", icon: PackagePlusIcon, onClick: () => setAddingPackage(true) }],
          content: <ClientPackages client={client} />,
        },
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
  const book: Action = { type: "button", label: "Book session", icon: CalendarPlusIcon, onClick: () => setBooking(true) };
  // Booking is the page's main job, until the details have changes to keep:
  // then Save takes its place and booking waits with the rest, beside it on
  // a wide screen and behind ⋯ on a phone.
  const actions: Array<Action> = client && !hasChanges ? [{ ...book, style: "primary" }] : [submit];
  const more: Array<Action> = client
    ? [
        ...(owed > 0 ? [{ type: "button", label: "Record payment", icon: WalletIcon, onClick: () => setPaying(true) } satisfies Action] : []),
        { type: "button", label: "Add follow-up", icon: BellPlusIcon, onClick: () => setFollowUp({ mode: "new", clientId: client.id }) },
        ...(whatsapp.canMessage(phone)
          ? [{ type: "button", label: "WhatsApp", icon: MessageCircleIcon, onClick: () => whatsapp.message(phone) } satisfies Action]
          : []),
        ...(hasChanges ? [book] : []),
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
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      />
      <PageSections sections={sections} />
      <UnsavedChangesDialog when={hasChanges} />
      {client && (
        <>
          <NewSessionDialog open={booking} clientId={client.id} onClose={() => setBooking(false)} />
          <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
          <RecordPaymentDialog client={client} open={paying} onClose={() => setPaying(false)} />
          <PackageDialog
            target={addingPackage ? { mode: "new", clientId: client.id } : null}
            onClose={() => setAddingPackage(false)}
            newTitle="Add package"
            description={`For ${client.name}`}
          />
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
