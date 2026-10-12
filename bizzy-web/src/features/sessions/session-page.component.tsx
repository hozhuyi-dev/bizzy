import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, LockIcon, MessageCircleIcon, SendIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { DeleteSessionDialog } from "./components/delete-session-dialog/delete-session-dialog.component";
import { paymentCover } from "./session-payment";
import { SESSION_STATUS, sessionAmount, sessionReceipts } from "./session-status";
import { SessionsMutation, isStaleEdit } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { DocumentRef, Session, SessionDraft, StoredSession } from "./sessions.types";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { Client } from "~/features/clients/clients.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { SettingsQuery } from "~/features/settings/settings.query";
import { useSendDocuments } from "~/features/whatsapp/use-whatsapp";
import { openWhatsApp, whatsappLink } from "~/features/whatsapp/whatsapp.link";
import { documentsTitle, paymentMessage } from "~/features/whatsapp/whatsapp.message";
import { PackagesQuery } from "~/features/packages/packages.query";
import { creditsLeft } from "~/features/packages/packages.types";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatDate, formatSessionTime, monthKey, toISODate } from "~/core/utils/date.util";
import { centsToInput, formatCents, parseCents } from "~/core/utils/money.util";

const FORM_ID = "session-form";

/** Where the session was opened from, to go back there once saved. */
export type SessionReturnTo = "home";

export type SessionPageProps = { returnTo?: SessionReturnTo | undefined } & (
  | { mode: "new" }
  | { mode: "edit"; eventId: string }
);

function parentOf(returnTo: SessionReturnTo | undefined) {
  return returnTo === "home" ? ({ to: "/", label: "Home" } as const) : ({ to: "/sessions", label: "Sessions" } as const);
}

/**
 * A session's own page, to add one or change it. Every save goes to her
 * calendar; she fills in fields and the API writes the title.
 */
export function SessionPage(props: SessionPageProps) {
  if (props.mode === "new") return <SessionEditor returnTo={props.returnTo} initial={newDraft()} />;
  return <ExistingSession eventId={props.eventId} returnTo={props.returnTo} />;
}

function ExistingSession({ eventId, returnTo }: { eventId: string; returnTo: SessionReturnTo | undefined }) {
  const detail = SessionsQuery.useDetail(eventId);
  const parent = parentOf(returnTo);

  if (detail.isPending) {
    return (
      <>
        <PageHeader parent={parent} title="…" />
        <Loading />
      </>
    );
  }
  if (detail.error) {
    return (
      <>
        <PageHeader parent={parent} title="Not available" />
        <p role="alert" className="text-sm text-destructive">
          {detail.error.message}
        </p>
      </>
    );
  }
  // Keyed by when it was read: an edit refused because the calendar changed
  // reloads the session, and the form starts again from the latest.
  return (
    <SessionEditor
      key={detail.dataUpdatedAt}
      stored={detail.data}
      initial={detail.data.draft}
      returnTo={returnTo}
    />
  );
}

/** Now, on the hour: most often she's adding the session she just had. */
function newDraft(): SessionDraft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  return { clientId: "", start: start.toISOString(), minutes: 60, homeVisit: false, tentative: false };
}

type PriceIs = "each" | "total";

const PRICE_IS_ITEMS: Array<{ value: PriceIs; label: string }> = [
  { value: "each", label: "per session" },
  { value: "total", label: "in total" },
];

interface SessionFormValues {
  clientId: string;
  date: string;
  time: string;
  minutes: string;
  /** Blank leaves it to a package credit or the default fee. */
  fee: string;
  packageSessions: string;
  packagePrice: string;
  /** Whether the price is per session (`10x180`) or the total (`10@1800`). */
  packagePriceIs: PriceIs;
  homeVisit: boolean;
  tentative: boolean;
}

function toValues(draft: SessionDraft): SessionFormValues {
  const start = new Date(draft.start);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    clientId: draft.clientId,
    date: toISODate(start),
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    minutes: String(draft.minutes),
    fee: centsToInput(draft.feeCents),
    ...packageValues(draft.package),
    homeVisit: draft.homeVisit,
    tentative: draft.tentative,
  };
}

/** Per session when the total divides evenly, as the title writes it. */
function packageValues(
  pkg: SessionDraft["package"],
): Pick<SessionFormValues, "packageSessions" | "packagePrice" | "packagePriceIs"> {
  if (!pkg) return { packageSessions: "", packagePrice: "", packagePriceIs: "each" };
  const each = pkg.priceCents % pkg.sessions === 0;
  return {
    packageSessions: String(pkg.sessions),
    packagePrice: centsToInput(each ? pkg.priceCents / pkg.sessions : pkg.priceCents),
    packagePriceIs: each ? "each" : "total",
  };
}

function toDraft(values: SessionFormValues): SessionDraft {
  const fee = parseCents(values.fee);
  const sessions = Number(values.packageSessions);
  const price = parseCents(values.packagePrice);
  return {
    clientId: values.clientId,
    // Read as her local time.
    start: new Date(`${values.date}T${values.time}`).toISOString(),
    minutes: Number(values.minutes),
    ...(fee !== null ? { feeCents: fee } : {}),
    ...(values.packageSessions.trim() && sessions >= 1 && price !== null && price > 0
      ? { package: { sessions, priceCents: values.packagePriceIs === "each" ? price * sessions : price } }
      : {}),
    homeVisit: values.homeVisit,
    tentative: values.tentative,
  };
}

/** Adapts TanStack Form's string errors to the shape FieldError renders. */
function fieldErrors(errors: ReadonlyArray<string | undefined>) {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}

interface SessionEditorProps {
  /** Omitted for a new session. */
  stored?: StoredSession | undefined;
  initial: SessionDraft;
  returnTo: SessionReturnTo | undefined;
}

function SessionEditor({ stored, initial, returnTo }: SessionEditorProps) {
  const session = stored?.session;
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  const create = SessionsMutation.useCreate();
  const update = SessionsMutation.useUpdate();
  const save = session ? update : create;
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  const parent = parentOf(returnTo);
  const bought = session && packages.data?.find((pkg) => pkg.id === session.eventId);
  // A receipt fixes what it covers: cancel it to change the session.
  const receipts = session ? sessionReceipts(session, bought) : [];
  const locked = receipts.length > 0;

  /** Back where she came from; from Sessions, to the month of the session. */
  const leave = (start?: string) => {
    if (returnTo === "home") {
      void navigate({ to: "/" });
      return;
    }
    const when = start ? new Date(Math.min(new Date(start).getTime(), Date.now())) : new Date();
    void navigate({ to: "/sessions", search: { month: monthKey(when) } });
  };

  const form = useForm({
    defaultValues: toValues(initial),
    onSubmit: async ({ value }) => {
      const draft = toDraft(value);
      try {
        if (session) await update.mutateAsync({ eventId: session.eventId, draft });
        else await create.mutateAsync(draft);
      } catch (error) {
        // The page reloads with the calendar's latest (or leaves, if the
        // event is gone); anything else is shown in the banner.
        if (isStaleEdit(error)) {
          toast.error(error.message);
          if (error.code === "not_found") leave();
        }
        return;
      }
      const booked = new Date(draft.start) > new Date();
      toast.success(
        booked ? `Booked for ${formatSessionTime(draft.start)}` : session ? "Session updated" : "Session added",
      );
      leave(draft.start);
    },
  });

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const coverOf = (values: SessionFormValues) => {
    const draft = toDraft(values);
    return paymentCover({
      client: clientsById.get(values.clientId),
      start: new Date(draft.start),
      packages: packages.data ?? [],
      boughtHere: draft.package !== undefined,
      session,
    });
  };

  const describeCover = (values: SessionFormValues): string => {
    const name = clientsById.get(values.clientId)?.name;
    if (!name) return "Choose a client to see what covers it.";
    const prefix = values.fee.trim() ? "Takes priority over" : "Leave blank to use";
    const cover = coverOf(values);
    switch (cover.kind) {
      case "bought":
        return `${prefix} the package bought in this session.`;
      case "credit":
        return `${prefix} ${name}'s package bought ${formatDate(cover.pkg.purchasedAt)}: ${creditsLeft(cover.pkg)} of ${cover.pkg.sessions} credits left.`;
      case "default":
        return `${prefix} ${name}'s default fee of ${formatCents(cover.feeCents)}; no package credits left.`;
      case "none":
        return `${name} has no package credits left and no default fee.`;
    }
  };

  const sections: Array<PageSection> = [
    {
      id: "session",
      title: "Session",
      content: (
        <FieldGroup>
          <form.Field
            name="clientId"
            validators={{ onChange: ({ value }) => (value ? undefined : "Choose a client") }}
            listeners={{
              // A new choice of client starts from their usual place.
              onChange: ({ value }) => form.setFieldValue("homeVisit", clientsById.get(value)?.homeVisits ?? false),
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel>Client</FieldLabel>
                <Select
                  items={items}
                  value={field.state.value}
                  disabled={locked}
                  onValueChange={(value) => field.handleChange(value ?? "")}
                >
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Choose a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {session && (
                  <FieldDescription>
                    In the calendar as “{session.title}”.
                  </FieldDescription>
                )}
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <div className="flex flex-wrap gap-4">
            <form.Field name="date" validators={{ onChange: ({ value }) => (value ? undefined : "Pick a day") }}>
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0} className="w-auto">
                  <FieldLabel htmlFor={field.name}>Day</FieldLabel>
                  <Input
                    id={field.name}
                    form={FORM_ID}
                    type="date"
                    disabled={locked}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                </Field>
              )}
            </form.Field>

            <form.Field name="time" validators={{ onChange: ({ value }) => (value ? undefined : "Pick a time") }}>
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0} className="w-auto">
                  <FieldLabel htmlFor={field.name}>Start</FieldLabel>
                  <Input
                    id={field.name}
                    form={FORM_ID}
                    type="time"
                    step={300}
                    disabled={locked}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="minutes"
              validators={{
                onChange: ({ value }) =>
                  /^\d+$/.test(value.trim()) && Number(value) >= 5 && Number(value) <= 720 ? undefined : "5 to 720",
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0} className="w-24">
                  <FieldLabel htmlFor={field.name}>Minutes</FieldLabel>
                  <Input
                    id={field.name}
                    form={FORM_ID}
                    inputMode="numeric"
                    disabled={locked}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                </Field>
              )}
            </form.Field>
          </div>

          <form.Field name="homeVisit">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox
                  id={field.name}
                  disabled={locked}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={field.name}>Home visit</FieldLabel>
                  <FieldDescription>Saved as the event's colour.</FieldDescription>
                </FieldContent>
              </Field>
            )}
          </form.Field>

          <form.Field name="tentative">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox
                  id={field.name}
                  disabled={locked}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={field.name}>Not confirmed</FieldLabel>
                  <FieldDescription>Stays on Home until you confirm it.</FieldDescription>
                </FieldContent>
              </Field>
            )}
          </form.Field>
        </FieldGroup>
      ),
    },
    {
      id: "payment",
      title: "Payment",
      content: (
        <FieldGroup>
          <form.Field
            name="fee"
            validators={{
              onChangeListenTo: ["clientId", "date", "time", "packageSessions", "packagePrice"],
              onChange: ({ value }) => {
                if (value.trim()) return parseCents(value) !== null ? undefined : "Like 95 or 95.50";
                return coverOf(form.state.values).kind === "none"
                  ? "Enter what was paid: no package credit or default fee covers it"
                  : undefined;
              },
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Paid for this session</FieldLabel>
                <Input
                  id={field.name}
                  form={FORM_ID}
                  inputMode="decimal"
                  disabled={locked}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="max-w-40"
                />
                <form.Subscribe selector={(state) => state.values}>
                  {(values) => <FieldDescription>{describeCover(values)}</FieldDescription>}
                </form.Subscribe>
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <div className="flex flex-wrap items-start gap-4">
            <form.Field
              name="packageSessions"
              validators={{
                onChangeListenTo: ["packagePrice"],
                onChange: ({ value, fieldApi }) => {
                  if (!value.trim()) {
                    return fieldApi.form.getFieldValue("packagePrice").trim() ? "How many sessions?" : undefined;
                  }
                  return /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 1000
                    ? undefined
                    : "1 to 1000";
                },
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0} className="w-32">
                  <FieldLabel htmlFor={field.name}>Package bought</FieldLabel>
                  <Input
                    id={field.name}
                    form={FORM_ID}
                    inputMode="numeric"
                    placeholder="Sessions"
                    disabled={locked}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="packagePrice"
              validators={{
                onChangeListenTo: ["packageSessions"],
                onChange: ({ value, fieldApi }) => {
                  if (!value.trim()) {
                    return fieldApi.form.getFieldValue("packageSessions").trim() ? "What did it cost?" : undefined;
                  }
                  const cents = parseCents(value);
                  return cents !== null && cents > 0 ? undefined : "Like 180 or 1800";
                },
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0} className="w-32">
                  <FieldLabel htmlFor={field.name}>Price</FieldLabel>
                  <Input
                    id={field.name}
                    form={FORM_ID}
                    inputMode="decimal"
                    disabled={locked}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                </Field>
              )}
            </form.Field>

            <form.Field name="packagePriceIs">
              {(field) => (
                <Field className="w-36">
                  <FieldLabel aria-hidden="true">&nbsp;</FieldLabel>
                  <Select
                    items={PRICE_IS_ITEMS}
                    value={field.state.value}
                    disabled={locked}
                    onValueChange={(value) => value && field.handleChange(value)}
                  >
                    <SelectTrigger className="w-full" aria-label="The price is">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICE_IS_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          </div>
          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              const pkg = toDraft(values).package;
              return (
                <FieldDescription>
                  {pkg
                    ? `${pkg.sessions} sessions for ${formatCents(pkg.priceCents)} (${formatCents(Math.round(pkg.priceCents / pkg.sessions))} each). This session uses the first.`
                    : "Only if one was bought in this session; it uses the first credit."}
                </FieldDescription>
              );
            }}
          </form.Subscribe>
        </FieldGroup>
      ),
    },
  ];

  const client = session?.clientId ? clientsById.get(session.clientId) : undefined;
  const status = session && SESSION_STATUS[session.status];
  const problem = session && (session.drift ?? session.reason ?? status?.hint);
  const messages = useMessageActions(session, client, receipts);
  const more: Array<RowAction> =
    session && !locked
      ? [...messages, { label: "Delete", icon: Trash2Icon, destructive: true, onClick: () => setDeleting(true) }]
      : messages;

  return (
    <>
      <PageHeader
        parent={parent}
        title={session ? (client?.name ?? (session.name || session.title)) : "New session"}
        badges={status && <Badge variant={status.variant}>{status.label}</Badge>}
        actions={
          !locked && (
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" form={FORM_ID} disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Saving…" : session ? "Save" : "Add session"}
                </Button>
              )}
            </form.Subscribe>
          )
        }
        moreActions={more}
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
          (locked || problem || save.error) && (
            <>
              {locked && (
                <Banner tone="neutral" icon={LockIcon} title="Covered by a receipt.">
                  Cancel{" "}
                  {receipts.map((ref, i) => (
                    <span key={ref.documentId}>
                      {i > 0 && " and "}
                      <TextLink to="/receipts/$id" params={{ id: ref.documentId }}>
                        {ref.number ?? "the draft"}
                      </TextLink>
                    </span>
                  ))}{" "}
                  to change it.
                </Banner>
              )}
              {problem && <Banner tone="attention" icon={CircleAlertIcon} title={problem} />}
              {save.error && !isStaleEdit(save.error) && (
                <Banner tone="attention" icon={CircleAlertIcon} title={save.error.message} role="alert" />
              )}
            </>
          )
        }
        sections={sections}
      />
      {session && (
        <DeleteSessionDialog
          session={deleting ? session : null}
          onClose={() => setDeleting(false)}
          onDeleted={() => leave(session.start)}
        />
      )}
    </>
  );
}

/**
 * WhatsApp messages to the client (the app on her phone, WhatsApp Web on her
 * computer): asking to pay (with her
 * bank details) until a receipt covers the session, then sending the issued
 * receipts that do.
 */
function useMessageActions(
  session: Session | undefined,
  client: Client | undefined,
  receipts: Array<DocumentRef>,
): Array<RowAction> {
  const settings = SettingsQuery.useGet();
  const issuedIds = receipts.filter((ref) => ref.number).map((ref) => ref.documentId);
  const docs = DocumentsQuery.useByClient(client?.id ?? "", issuedIds.length > 0);
  const { send, busy } = useSendDocuments();

  if (!session || !client) return [];
  const to = { name: client.name, phone: client.contact?.phone };
  const actions: Array<RowAction> = [];

  if (receipts.length === 0 && settings.data) {
    const text = paymentMessage(settings.data, {
      clientName: client.name,
      start: session.start,
      amountCents: sessionAmount(session),
    });
    actions.push({
      label: "Ask to pay",
      icon: MessageCircleIcon,
      onClick: () => {
        const url = whatsappLink(to.phone, text);
        if (url) openWhatsApp(url);
        else toast.error(`${client.name} has no phone number WhatsApp can use.`);
      },
    });
  }

  const issued = (docs.data ?? []).filter((doc) => doc.status === "issued" && issuedIds.includes(doc.id));
  if (issued.length > 0) {
    actions.push({
      label: `Send ${documentsTitle(issued)}`,
      icon: SendIcon,
      disabled: busy,
      onClick: () => send(to, issued),
    });
  }
  return actions;
}
