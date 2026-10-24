import { useState } from "react";
import { toast } from "sonner";
import { PackageCheckIcon, Trash2Icon } from "lucide-react";
import { PackagesMutation } from "./packages.mutation";
import { clientName } from "./packages.util";
import type { PackageView } from "./packages.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { DialogConfirm } from "~/components/shared/dialog/dialog-actions/dialog-actions.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/**
 * Everything that can be done to a package besides editing it, for its
 * dialog's ⋯ (DialogActions): WhatsApp the client (ask to pay, send its
 * documents), keep one bought in a session as its own, delete it (asking
 * first), each by its `can`. `onDone` closes the dialog once one is done.
 * A new package has none.
 */
export function usePackageActions(pkg: PackageView | undefined, onDone: () => void) {
  const clientsById = ClientsQuery.useById();
  const whatsappMenu = useWhatsAppMenu();
  const makeStandalone = PackagesMutation.useMakeStandalone();
  const remove = PackagesMutation.useDelete();
  const [confirming, setConfirming] = useState(false);
  if (!pkg) return { menu: [], confirm: null };

  const items = [{ kind: "package", id: pkg.id }] as const;
  const menu: Array<Action> = [
    whatsappMenu({
      to: { name: clientName(pkg, clientsById), phone: clientsById.get(pkg.clientId)?.contact?.phone },
      askToPay: { request: { items: [...items] }, can: pkg.can.askToPay },
      sendRecords: { items: [...items], can: pkg.can.sendRecords },
      openChat: true,
    }),
  ];
  if (pkg.can.makeStandalone.ok) {
    menu.push({
      type: "button",
      label: "Keep as its own",
      icon: PackageCheckIcon,
      disabled: makeStandalone.isPending,
      onClick: () =>
        makeStandalone.mutate(pkg.id, {
          onSuccess: () => {
            toast.success("Kept as its own package");
            onDone();
          },
          onError: toastRefusal,
        }),
    });
  }
  menu.push({ type: "button", label: "Delete", icon: Trash2Icon, style: "destructive", can: pkg.can.delete, onClick: () => setConfirming(true) });

  const confirm: DialogConfirm | null = confirming
    ? {
        question: "Delete this package? It can't be undone.",
        yes: "Delete",
        pending: remove.isPending,
        onNo: () => setConfirming(false),
        onYes: () =>
          remove.mutate(pkg.id, {
            onSuccess: () => {
              toast.success("Package deleted");
              onDone();
            },
            onError: toastRefusal,
          }),
      }
    : null;
  return { menu, confirm };
}
