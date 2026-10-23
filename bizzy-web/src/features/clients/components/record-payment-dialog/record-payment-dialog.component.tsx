import type { ClientView } from "../../clients.types";
import type { Payable } from "~/features/payments/payments.types";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { packagePayables } from "~/features/packages/packages.util";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { sessionPayables } from "~/features/sessions/session-payment.util";
import { formatDate } from "~/core/utils/date.util";
import { pageItems } from "~/core/list/filter.util";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { allOf } from "~/core/utils/query.util";

interface RecordPaymentDialogProps {
  client: ClientView;
  open: boolean;
  onClose: () => void;
}

/**
 * Records what the client paid, for any of what they still owe: sessions to
 * collect (with the packages bought in them) and packages bought on their
 * own. One payment is one receipt.
 */
export function RecordPaymentDialog({ client, open, onClose }: RecordPaymentDialogProps) {
  return (
    <SheetDialog open={open} onClose={onClose}>
      {open && <RecordPayment client={client} onClose={onClose} />}
    </SheetDialog>
  );
}

function RecordPayment({ client, onClose }: Omit<RecordPaymentDialogProps, "open">) {
  const owing = SessionsQuery.useSearch({ text: "", when: undefined, chips: { client: [client.id], stage: ["collect"] } });
  const packages = PackagesQuery.useList(true);
  const reads = allOf(owing, packages);

  const own = (packages.data ?? []).filter((pkg) => pkg.clientId === client.id);
  const byId = new Map(own.map((pkg) => [pkg.id, pkg]));
  const payables: Array<Payable> = [
    ...pageItems(owing.data).flatMap((session) =>
      sessionPayables(session, session.bought ? byId.get(session.bought.id) : undefined)
        .filter((p) => !p.paid)
        .map((p) => ({ ...p, label: `${p.label}, ${formatDate(session.start)}` })),
    ),
    ...own.filter((pkg) => !pkg.boughtIn && pkg.owedCents > 0).flatMap(packagePayables),
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>What {client.name} paid, in full for each item ticked: one receipt for it all.</DialogDescription>
      </DialogHeader>
      {reads.error ? (
        <ErrorState error={reads.error} retry={reads.refetch} />
      ) : reads.isPending ? (
        <LoadingState />
      ) : payables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{client.name} owes nothing.</p>
      ) : (
        <PaymentPanel payables={payables} onPaid={onClose} />
      )}
    </>
  );
}
