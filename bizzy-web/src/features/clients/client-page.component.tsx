import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, MessageCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { totals, whatsappLink } from "./clients.activity";
import { LastSeen, contactProblem, extraAliases, toClientRow } from "./clients.columns";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { ClientContact } from "./components/client-contact/client-contact.component";
import type { ChosenContact } from "./components/client-contact/client-contact.component";
import type { Client, SaveClientInput } from "./clients.types";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { creditsLeft } from "~/features/packages/packages.types";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatDate } from "~/core/utils/date.util";
import { centsToInput, formatCents, parseCents } from "~/core/utils/money.util";

const FORM_ID = "client-form";
const parent = { to: "/clients", label: "Clients" } as const;

/** Where a new client was started from, to go back there once saved. */
export type ClientReturnTo = "sessions";

export type ClientPageProps =
  | { mode: "edit"; id: string }
  | {
      mode: "new";
      /** Prefills, e.g. from an unmatched calendar name and the contact it matched. */
      initialName?: string | undefined;
      initialContact?: { resourceName: string; displayName: string } | undefined;
      returnTo?: ClientReturnTo | undefined;
    };

/** A client's own page: their profile, Google contact, activity and packages. */
export function ClientPage(props: ClientPageProps) {
  const clients = ClientsQuery.useList();

  if (props.mode === "new") {
    return (
      <ClientEditor
        initialName={props.initialName}
        initialContact={props.initialContact}
        returnTo={props.returnTo}
      />
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
  return <ClientEditor key={client.id} client={client} />;
}

interface ClientEditorProps {
  client?: Client | undefined;
  initialName?: string | undefined;
  initialContact?: { resourceName: string; displayName: string } | undefined;
  returnTo?: ClientReturnTo | undefined;
}

interface ClientFormValues {
  name: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  defaultFee: string;
  homeVisits: boolean;
}

function ClientEditor({ client, initialName, initialContact, returnTo }: ClientEditorProps) {
  const save = ClientsMutation.useSave();
  const navigate = useNavigate();
  const [contact, setContact] = useState<ChosenContact | null>(client?.contact ?? initialContact ?? null);
  const [contactRequired, setContactRequired] = useState(false);

  const form = useForm({
    defaultValues: {
      name: client?.name ?? initialName ?? "",
      aliases: client ? extraAliases(client).join(", ") : "",
      defaultFee: centsToInput(client?.defaultFeeCents),
      homeVisits: client?.homeVisits ?? false,
    } satisfies ClientFormValues,
    onSubmit: async ({ value }) => {
      // A new client needs a contact; an existing one may be unlinked.
      if (!contact && !client) {
        setContactRequired(true);
        document.getElementById("contact")?.scrollIntoView({ block: "start" });
        return;
      }
      try {
        const saved = await save.mutateAsync(toInput(value, client?.id, contact?.resourceName));
        toast.success(client ? "Client updated" : "Client added");
        if (!client) {
          void navigate(
            returnTo === "sessions" ? { to: "/" } : { to: "/clients/$id", params: { id: saved.id }, replace: true },
          );
        }
      } catch {
        // Shown through save.error.
      }
    },
  });

  const whatsapp = whatsappLink(client?.contact?.phone);
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

          <form.Field
            name="defaultFee"
            validators={{
              onChange: ({ value }) =>
                !value.trim() || parseCents(value) !== null ? undefined : "Enter an amount like 95 or 95.50",
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Default fee</FieldLabel>
                <Input
                  id={field.name}
                  form={FORM_ID}
                  className="max-w-40"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  inputMode="decimal"
                  placeholder="95"
                />
                <FieldDescription>Used when a calendar entry has no amount and no package credit.</FieldDescription>
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="homeVisits">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
                <FieldContent>
                  <FieldLabel htmlFor={field.name}>Usually a home visit</FieldLabel>
                  <FieldDescription>An event colour set in the calendar still wins.</FieldDescription>
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
          { id: "packages", title: "Packages", content: <ClientPackages clientId={client.id} /> },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        parent={parent}
        title={client?.name ?? "New client"}
        actions={
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" form={FORM_ID} disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : client ? "Save" : "Add client"}
              </Button>
            )}
          </form.Subscribe>
        }
        moreActions={whatsapp ? [{ label: "WhatsApp", icon: MessageCircleIcon, href: whatsapp }] : undefined}
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
        banner={
          (problem || save.error) && (
            <>
              {problem && <Banner tone="attention" icon={CircleAlertIcon} title={`${problem}.`} />}
              {save.error && (
                <Banner tone="attention" icon={CircleAlertIcon} title={save.error.message} role="alert" />
              )}
            </>
          )
        }
        sections={sections}
      />
    </>
  );
}

/** Adapts TanStack Form's string errors to the shape FieldError renders. */
function fieldErrors(errors: ReadonlyArray<string | undefined>) {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}

function toInput(values: ClientFormValues, id: string | undefined, resourceName: string | undefined): SaveClientInput {
  const fee = values.defaultFee.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    ...(resourceName ? { contact: { resourceName } } : {}),
    aliases: values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    ...(fee ? { defaultFeeCents: parseCents(fee) ?? 0 } : {}),
    ...(values.homeVisits ? { homeVisits: true } : {}),
  };
}

function Activity({ client }: { client: Client }) {
  const row = toClientRow(client);
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
          <span className="text-muted-foreground"> · {totals(client).sessions} sessions</span>
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
            {pkg.sessions} sessions for {formatCents(pkg.priceCents)}
            <span className="text-muted-foreground"> · bought {formatDate(pkg.purchasedAt)}</span>
          </span>
          <span className="flex items-center gap-3">
            <span className={creditsLeft(pkg) > 0 ? undefined : "text-muted-foreground"}>
              {creditsLeft(pkg)} of {pkg.sessions} left
            </span>
            {pkg.document ? (
              <TextLink to="/receipts/$id" params={{ id: pkg.document.documentId }}>
                {pkg.document.number ?? "Draft"}
              </TextLink>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
