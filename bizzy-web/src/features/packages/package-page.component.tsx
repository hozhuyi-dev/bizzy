import { useEffect, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useLocation } from "@tanstack/react-router";
import { toast } from "sonner";
import { PackageCheckIcon, Trash2Icon } from "lucide-react";
import { toPackageFields, toPackageValues } from "./packages.form";
import { usePackageSave } from "./package-save.hook";
import { PackagesMutation } from "./packages.mutation";
import { PackagesQuery } from "./packages.query";
import { clientName } from "./packages.util";
import { PackagePager, packageParent } from "./components/package-pager/package-pager.component";
import type { PackageStepping } from "./components/package-pager/package-pager.component";
import type { ReactNode } from "react";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import type { LinkOptions } from "@tanstack/react-router";
import type { PackageView } from "./packages.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageStep } from "~/components/shared/layout/page-steps/page-steps.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { DocumentRow } from "~/features/documents/components/document-row/document-row.component";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { coveringDocuments, refLabel } from "~/features/documents/documents.util";
import { PAYMENT_CHOICES } from "~/features/payments/payments.constant";
import { methodLabel } from "~/features/payments/payments.util";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { PageSteps } from "~/components/shared/layout/page-steps/page-steps.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { DataList, DataListItem } from "~/components/shared/list/data-list/data-list.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { useGoBack } from "~/core/navigation/go-back.hook";
import { clientSessionsSearch } from "~/features/sessions/sessions.util";
import { scrollToSection } from "~/core/scroll-spy/scroll-spy.util";
import { formatDate, formatHours, todayISO } from "~/core/utils/date.util";
import { moneyError, requiredError, wholeNumberError } from "~/core/utils/form.util";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { allOf } from "~/core/utils/query.util";

const FORM_ID = "package-form";

/** A new one's list, where it goes back to when it wasn't opened from another page. */
const PARENT: Parent = { to: "/packages", label: "Packages" };

// Not paid yet: first, so a new package starts left to collect.
const PAID_BY = [{ value: "", label: "Not yet" }, ...PAYMENT_CHOICES];

/**
 * A package's page, or a new one's, wherever it is opened from: its home,
 * as a session's page is. Its steps: the package (client, hours, price and
 * day), its payment, its invoice and receipt, and its credits being used.
 * The first two save together. A new one starts with the client it was
 * opened for, and one opened to pay for it starts at its payment, as the
 * page that opened it left them in history.
 */
export function PackagePage({ id, stepping }: { id?: string | undefined; stepping?: PackageStepping | undefined }) {
  // Every package is read already (sessions show their credits): one cached read.
  const packages = PackagesQuery.useList(true);
  const clients = ClientsQuery.useList();
  const clientId = useLocation({ select: (location) => location.state.clientId });
  const at = useLocation({ select: (location) => location.state.at });
  const pkg = id === undefined ? undefined : packages.data?.find((p) => p.id === id);
  const gone = id !== undefined && packages.data !== undefined && !pkg;
  const header: PackageHeader = {
    parent: stepping ? packageParent(stepping) : PARENT,
    // Steps on while the next one loads, so the header stays put.
    pager: id !== undefined && stepping && <PackagePager id={id} gone={gone} stepping={stepping} />,
  };
  const back = { label: `Back to ${header.parent.label}`, link: header.parent as LinkOptions };

  const page = allOf(packages, clients);
  if (packages.data && clients.data) {
    if (gone) {
      return (
        <>
          <PageHeader {...header} title="Not available" kind="Package" />
          <NotFoundPage message="This package was deleted." back={back} />
        </>
      );
    }
    return <PackageEditor key={pkg?.id ?? "new"} pkg={pkg} clientId={clientId} at={at} header={header} />;
  }
  return (
    <>
      <PageHeader {...header} title={page.error ? "Not available" : "…"} kind="Package" />
      {page.error ? (
        <ErrorState error={page.error} retry={page.refetch} size="page" back={back} />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

/** The header's way back and pager, the same while the package loads. */
interface PackageHeader {
  parent: Parent;
  pager: ReactNode;
}

interface PackageEditorProps {
  header: PackageHeader;
  /** Omitted for a new one. */
  pkg: PackageView | undefined;
  /** The client a new one is for, to start with. */
  clientId: string | undefined;
  /** Opened to pay for it ("Another day…"): its payment comes into view. */
  at: "payment" | undefined;
}

/**
 * What its update can't change now (one bought in a session keeps the
 * session's client and day; a payment an issued receipt records) is
 * disabled, saying why.
 */
function PackageEditor({ pkg, clientId, at, header }: PackageEditorProps) {
  const clientsById = ClientsQuery.useById();
  const goBack = useGoBack(header.parent as LinkOptions);
  // Added to settle a calendar edit: back to the to-do list once saved.
  const settled = useSettleReturn();
  const save = usePackageSave(
    pkg,
    (done) => {
      if (pkg) return;
      // Added: back to what it was added for.
      if (settled) settled(done);
      else goBack({ leaving: true });
    },
    !pkg && Boolean(settled),
  );
  const [error, setError] = useState<string | null>(null);
  const locked = pkg?.locked ?? {};
  useEffect(() => {
    // Once the page is laid out and scrolled to its top.
    if (at === "payment") requestAnimationFrame(() => scrollToSection("payment"));
  }, [at]);

  const form = useAppForm({
    defaultValues: toPackageValues(pkg, clientId),
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        await save.submit(toPackageFields(value, pkg));
        formApi.reset(value);
      } catch (e) {
        // Shown with what would let it through, and kept on the form.
        toastRefusal(e);
        setError((e as Error).message);
      }
    },
  });
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  const actions = usePackageActions(pkg, () => goBack({ leaving: true }));
  // A new one opened for a client is theirs from the start.
  const newFor = clientId ? clientsById.get(clientId)?.name : undefined;

  const submit: Action = {
    type: "submit",
    form: FORM_ID,
    label: pkg ? "Save" : "Add package",
    style: "primary",
    pending: isSubmitting,
  };

  const details = (
    <FieldGroup>
      {pkg?.boughtIn && (
        <p className="text-sm text-muted-foreground">
          Bought in{" "}
          <TextLink to="/sessions/$id" params={{ id: pkg.boughtIn }} search={clientSessionsSearch(pkg.clientId)}>
            a session
          </TextLink>
          , and on its invoice.
        </p>
      )}
      <form.AppField name="clientId" validators={{ onChange: ({ value }) => requiredError(value, "Choose a client") }}>
        {() => (
          <ClientSelectField
            keepId={pkg?.clientId ?? clientId}
            disabled={locked.clientId !== undefined}
            hint={<LockedHint lock={locked.clientId} />}
          />
        )}
      </form.AppField>

      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="hours" validators={{ onChange: ({ value }) => wholeNumberError(value, 1, 1000) }}>
          {(field) => (
            <field.TextField
              label="Hours"
              inputMode="numeric"
              disabled={locked.hours !== undefined}
              hint={<LockedHint lock={locked.hours} again={saidAbove(locked.hours, locked.clientId)} />}
            />
          )}
        </form.AppField>

        <form.AppField
          name="price"
          validators={{ onChange: ({ value }) => moneyError(value, { required: "What does it cost?", positive: true }) }}
        >
          {(field) => (
            <field.TextField
              label="Total price"
              inputMode="decimal"
              disabled={locked.priceCents !== undefined}
              hint={<LockedHint lock={locked.priceCents} again={saidAbove(locked.priceCents, locked.clientId, locked.hours)} />}
            />
          )}
        </form.AppField>
      </div>

      <form.Subscribe selector={(state) => [state.values.hours, state.values.price] as const}>
        {([hours, price]) => {
          const cents = parseCents(price);
          const n = Number(hours);
          return cents !== null && Number.isInteger(n) && n >= 1 ? (
            <FieldDescription>
              {formatCents(Math.round(cents / n))} an hour. Sessions use credits by the half hour.
            </FieldDescription>
          ) : null;
        }}
      </form.Subscribe>

      <form.AppField name="purchasedOn" validators={{ onChange: ({ value }) => requiredError(value, "Choose the day it was bought") }}>
        {(field) => (
          <field.TextField
            label="Bought on"
            type="date"
            inputClassName="max-w-44"
            disabled={locked.purchasedAt !== undefined}
            description="Credits cover sessions from this day on."
            hint={
              <LockedHint
                lock={locked.purchasedAt}
                again={saidAbove(locked.purchasedAt, locked.clientId, locked.hours, locked.priceCents)}
              />
            }
          />
        )}
      </form.AppField>

      <form.AppField name="note">{(field) => <field.TextField label="Note" />}</form.AppField>
    </FieldGroup>
  );

  const payment = (
    <FieldGroup>
      {locked.payment && pkg?.paid ? (
        <Field>
          <FieldLabel>Paid</FieldLabel>
          <p className="text-sm">
            <b>{formatCents(pkg.paid.amountCents)}</b> by {methodLabel(pkg.paid.method)} on {formatDate(pkg.paid.paidOn)}
          </p>
          <LockedHint lock={locked.payment} />
        </Field>
      ) : (
        <>
          <form.Subscribe selector={(state) => [state.values.paidBy, state.values.price] as const}>
            {([paidBy, price]) => (
              <form.AppField name="paidBy">
                {(field) => (
                  <field.ChoiceField label="Paid" options={PAID_BY} description={paidHelp(pkg, paidBy, parseCents(price))} />
                )}
              </form.AppField>
            )}
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values.paidBy}>
            {(paidBy) =>
              paidBy && (
                <form.AppField
                  name="paidOn"
                  validators={{ onChange: ({ value }) => requiredError(value, "Choose the day it was paid") }}
                >
                  {(field) => (
                    <field.TextField
                      label="Paid on"
                      type="date"
                      inputClassName="max-w-44"
                      // Money comes in on a day that has come; one ahead is most likely a slip.
                      description={field.state.value > todayISO() ? "That day hasn't come yet." : undefined}
                    />
                  )}
                </form.AppField>
              )
            }
          </form.Subscribe>
        </>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </FieldGroup>
  );

  const steps: Array<PageStep> = [
    {
      id: "package",
      title: "Package",
      state: pkg ? "done" : "current",
      meta: pkg && `${formatHours(pkg.hours)} for ${formatCents(pkg.priceCents)}, bought ${formatDate(pkg.purchasedAt)}`,
      content: details,
    },
    {
      id: "payment",
      title: "Payment",
      state: pkg?.paid ? "done" : pkg && pkg.owedCents > 0 ? "current" : pkg ? "none" : "todo",
      meta: pkg?.paid
        ? `Paid ${formatDate(pkg.paid.paidOn)} by ${methodLabel(pkg.paid.method)}`
        : pkg && pkg.owedCents > 0
          ? `${formatCents(pkg.owedCents)} to collect`
          : undefined,
      content: payment,
    },
    documentsStep(pkg),
    creditsStep(pkg),
  ];

  return (
    <>
      <PageHeader
        {...header}
        title={pkg ? clientName(pkg, clientsById) : (newFor ?? "New package")}
        titleLink={pkg && clientsById.has(pkg.clientId) ? { to: "/clients/$id", params: { id: pkg.clientId } } : undefined}
        kind={pkg ? "Package" : newFor ? "New package" : undefined}
        subtitle={pkg && `${formatHours(pkg.hours)}, bought ${formatDate(pkg.purchasedAt)}`}
        // Save while there is something to keep; a new one is nothing until added.
        actions={!pkg || hasChanges ? [submit] : []}
        moreActions={actions.more}
        menuActions={actions.menu}
      />
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <PageSteps steps={steps} />
      </form>
      <UnsavedChangesDialog when={hasChanges} />
      {actions.dialog}
    </>
  );
}

/** Its invoice, drafted with it, and the receipt for its payment: issued when the client asks. */
function documentsStep(pkg: PackageView | undefined): PageStep {
  const docs = coveringDocuments(pkg);
  if (!pkg) {
    return {
      id: "documents",
      title: "Documents",
      state: "optional",
      content: <p className="text-sm text-muted-foreground">Its invoice is drafted once it is added, and its receipt once it is paid.</p>,
    };
  }
  return {
    id: "documents",
    title: "Documents",
    state: docs.some((doc) => doc.issued) ? "done" : "optional",
    meta: docs.length === 0 ? "Invoice and receipt, if asked" : docs.map((doc) => (doc.issued ? refLabel(doc.type, doc.ref, true) : `${DOCUMENT_TYPES[doc.type].title} in draft`)).join(" · "),
    count: docs.length,
    content: (
      <DataList label="Documents">
        {docs.map((doc) => (
          <DataListItem key={doc.ref.id}>
            <DocumentRow
              doc={doc}
              search={{ package: pkg.id }}
              meta={
                doc.type === "invoice"
                  ? `Invoice · ${formatCents(pkg.priceCents)}`
                  : pkg.paid
                    ? `Receipt · ${formatCents(pkg.paid.amountCents)} · ${methodLabel(pkg.paid.method)} · ${formatDate(pkg.paid.paidOn)}`
                    : "Receipt"
              }
            />
          </DataListItem>
        ))}
        {!pkg.paid && (
          <DataListItem>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Receipt</span> · Made when it is paid.
            </p>
          </DataListItem>
        )}
      </DataList>
    ),
  };
}

/** Its credits, used by sessions from the day it was bought, once older packages' run out. */
function creditsStep(pkg: PackageView | undefined): PageStep {
  if (!pkg) {
    return {
      id: "credits",
      title: "Credits",
      state: "todo",
      content: <p className="text-sm text-muted-foreground">Sessions from the day it was bought use its hours, by the half hour.</p>,
    };
  }
  const left = `${formatHours(pkg.creditsLeft)} of ${formatHours(pkg.hours)} left`;
  return {
    id: "credits",
    title: "Credits",
    state: pkg.creditsLeft <= 0 ? "done" : pkg.creditsUsed > 0 ? "current" : "todo",
    meta: pkg.creditsLeft <= 0 ? "Used up" : left,
    content: (
      <p className="text-sm">
        {pkg.creditsLeft <= 0
          ? `All ${formatHours(pkg.hours)} used.`
          : `${formatHours(pkg.creditsUsed)} used, ${left}. Sessions from ${formatDate(pkg.purchasedAt)} on use them, by the half hour, once older packages' run out.`}
      </p>
    ),
  };
}

/** What saving does to the payment, as the section stands: collect it, undo it, or move it to a new price. */
function paidHelp(pkg: PackageView | undefined, paidBy: string, priceCents: number | null): string | undefined {
  const paid = pkg?.paid;
  if (!paidBy) return paid ? "Saving undoes the payment recorded." : "It goes on your to-do list to collect.";
  if (paid && priceCents !== null && priceCents !== pkg.priceCents) return "Paid in full: the payment moves to the new price.";
  return undefined;
}

/**
 * Everything done to a package besides editing it, by its `can`: WhatsApp
 * the client (ask to pay, send its documents) beside Save, then behind ⋯
 * keeping one bought in a session as its own, and deleting it, asking
 * first. A new package has none. `onDeleted` leaves the page.
 */
function usePackageActions(pkg: PackageView | undefined, onDeleted: () => void) {
  const clientsById = ClientsQuery.useById();
  const whatsappMenu = useWhatsAppMenu();
  const makeStandalone = PackagesMutation.useMakeStandalone();
  const remove = PackagesMutation.useDelete();
  const [deleting, setDeleting] = useState(false);
  if (!pkg) return { more: [], menu: [], dialog: null };

  const items = [{ kind: "package", id: pkg.id }] as const;
  const more: Array<Action> = [
    whatsappMenu({
      to: { name: clientName(pkg, clientsById), phone: clientsById.get(pkg.clientId)?.contact?.phone },
      askToPay: { request: { items: [...items] }, can: pkg.can.askToPay },
      sendRecords: { items: [...items], can: pkg.can.sendRecords },
      openChat: true,
    }),
  ];
  const menu: Array<Action> = [];
  if (pkg.can.makeStandalone.ok) {
    menu.push({
      type: "button",
      label: "Keep as its own",
      icon: PackageCheckIcon,
      pending: makeStandalone.isPending,
      onClick: () =>
        makeStandalone.mutate(pkg.id, { onSuccess: () => toast.success("Kept as its own package"), onError: toastRefusal }),
    });
  }
  menu.push({ type: "button", label: "Delete package", icon: Trash2Icon, style: "destructive", can: pkg.can.delete, onClick: () => setDeleting(true) });

  const dialog = (
    <SheetAlertDialog open={deleting} onClose={() => setDeleting(false)}>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this package?</AlertDialogTitle>
        <AlertDialogDescription>It can't be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <PendingButton
          variant="destructive"
          pending={remove.isPending}
          onClick={() =>
            remove.mutate(pkg.id, {
              onSuccess: () => {
                toast.success("Package deleted");
                onDeleted();
              },
              onError: toastRefusal,
              onSettled: () => setDeleting(false),
            })
          }
        >
          Delete
        </PendingButton>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
  return { more, menu, dialog };
}
