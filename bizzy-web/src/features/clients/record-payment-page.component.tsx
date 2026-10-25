import { ClientsQuery } from "./clients.query";
import type { LinkOptions } from "@tanstack/react-router";
import type { ClientView } from "./clients.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { Payable } from "~/features/payments/payments.types";
import { usePaymentForm } from "~/features/payments/components/payment-panel/payment-panel.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { packagePayables } from "~/features/packages/packages.util";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { sessionPayables } from "~/features/sessions/session-payment.util";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { EmptyStateFrame } from "~/components/shared/feedback/empty-state/empty-state.component";
import { BeeArt } from "~/components/shared/feedback/bee-art/bee-art.component";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";
import { useGoBack } from "~/core/navigation/go-back.hook";
import { pageItems } from "~/core/list/filter.util";
import { formatDate } from "~/core/utils/date.util";
import { allOf } from "~/core/utils/query.util";

const FORM_ID = "payment-form";

/** The client's page, where it goes back to when it wasn't opened from another page. */
function parentOf(id: string, client: ClientView | undefined) {
  return { to: "/clients/$id", params: { id }, label: client?.name ?? "Client" } as const;
}

/**
 * Records what a client paid, for any of what they still owe: sessions to
 * collect (with the packages bought in them) and packages bought on their
 * own. One payment is one receipt.
 */
export function RecordPaymentPage({ id }: { id: string }) {
  const clients = ClientsQuery.useList();
  const owing = SessionsQuery.useSearch({ text: "", when: undefined, chips: { client: [id], stage: ["collect"] } });
  const packages = PackagesQuery.useList(true);
  const client = clients.data?.find((c) => c.id === id);
  const parent = parentOf(id, client);
  const page = allOf(clients, owing, packages);

  if (clients.data && !client) {
    return (
      <>
        <PageHeader parent={{ to: "/clients", label: "Clients" }} title="Not available" />
        <NotFoundPage message="This client was deleted." back={{ label: "Back to Clients", link: { to: "/clients" } }} />
      </>
    );
  }
  if (client && owing.data && packages.data) {
    const own = packages.data.filter((pkg) => pkg.clientId === id);
    const byId = new Map(own.map((pkg) => [pkg.id, pkg]));
    const payables: Array<Payable> = [
      ...pageItems(owing.data).flatMap((session) =>
        sessionPayables(session, session.bought ? byId.get(session.bought.id) : undefined)
          .filter((p) => !p.paid)
          .map((p) => ({ ...p, label: `${p.label}, ${formatDate(session.start)}` })),
      ),
      ...own.filter((pkg) => !pkg.boughtIn && pkg.owedCents > 0).flatMap(packagePayables),
    ];
    if (payables.length === 0) {
      return (
        <>
          <PageHeader parent={parent} title={client.name} kind="Record a payment" />
          <EmptyStateFrame art={<BeeArt pool="empty" />} title={`${client.name} owes nothing.`} />
        </>
      );
    }
    return <RecordPayment key={payables.map((p) => `${p.item.kind}:${p.item.id}`).join()} client={client} payables={payables} />;
  }
  return (
    <>
      <PageHeader parent={parent} title={page.error ? "Not available" : "…"} kind="Record a payment" />
      {page.error ? (
        <ErrorState
          error={page.error}
          retry={page.refetch}
          size="page"
          back={{ label: `Back to ${parent.label}`, link: parent as LinkOptions }}
        />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

function RecordPayment({ client, payables }: { client: ClientView; payables: ReadonlyArray<Payable> }) {
  const parent = parentOf(client.id, client);
  const goBack = useGoBack(parent as LinkOptions);
  const payment = usePaymentForm(payables, () => goBack({ leaving: true }));
  const submit: Action = { type: "submit", form: FORM_ID, label: "Mark paid", style: "primary", pending: payment.submitting };

  return (
    <>
      <PageHeader parent={parent} title={client.name} kind="Record a payment" actions={[submit]} />
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void payment.form.handleSubmit();
        }}
      >
        <PageSections
          sections={[
            {
              id: "payment",
              title: "Payment",
              description: `What ${client.name} paid, in full for each item ticked: one receipt for it all.`,
              content: <div className="flex flex-col gap-4">{payment.fields}</div>,
            },
          ]}
        />
      </form>
    </>
  );
}
