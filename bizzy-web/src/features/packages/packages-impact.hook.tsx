import { useRef, useState } from "react";
import { toast } from "sonner";
import { PackagesMutation } from "./packages.mutation";
import { PackagesService } from "./packages.service";
import type { Package, PackageOptions, SavePackageInput } from "./packages.types";
import type { Impact } from "~/features/billing/billing.types";
import { useImpactSave } from "~/features/billing/billing.hook";
import { ImpactDialog } from "~/features/billing/components/impact-dialog/impact-dialog.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { parseCents } from "~/core/utils/money.util";

/**
 * Saves a package from its form: its preview first (packages.impact), and
 * what that brings on (sessions gaining or losing its credits) waits in
 * `dialog` for her to confirm. The dialog offers to update what was paid
 * when the price changes, and to give a client with no usual fee one when
 * sessions would be left without a fee.
 */
export function usePackageSave(pkg: Package | undefined, onSaved: () => void) {
  const save = PackagesMutation.useSave();
  const impact = useImpactSave();
  const options = useRef<PackageOptions>({});
  const [updatePayment, setUpdatePayment] = useState(false);
  const [clientFee, setClientFee] = useState("");

  const send = async (input: SavePackageInput, confirm: boolean) => {
    await save.mutateAsync({ input, options: { ...options.current, confirm } });
    toast.success(pkg ? "Package updated" : "Package added");
    onSaved();
  };

  const submit = async (input: SavePackageInput) => {
    options.current = {};
    setUpdatePayment(false);
    setClientFee("");
    const outcome = await impact.run(
      () => PackagesService.impact(input),
      (confirm) => send(input, confirm),
    );
    if (outcome.kind === "refused") throw new Error(outcome.impact.refused);
  };

  const repriced = pkg !== undefined && (impact.impact?.brings ?? []).some(
    (b) => b.kind === "package" && b.id === pkg.id && b.rule === "price-changed-after-payment",
  );

  const dialog = (
    <ImpactDialog
      impact={impact.impact}
      saving={impact.saving}
      onConfirm={() => void impact.confirm().catch((error: Error) => toast.error(error.message))}
      onCancel={impact.cancel}
    >
      {repriced && (
        <Field orientation="horizontal">
          <Checkbox
            id="package-update-payment"
            checked={updatePayment}
            onCheckedChange={(checked) => {
              options.current = { ...options.current, updatePayment: checked };
              setUpdatePayment(checked);
            }}
          />
          <FieldContent>
            <FieldLabel htmlFor="package-update-payment">Update the payment too</FieldLabel>
            <FieldDescription>What was paid moves to the new price, as what you collected or refunded.</FieldDescription>
          </FieldContent>
        </Field>
      )}
      <ClientFeeField
        impact={impact.impact}
        value={clientFee}
        onChange={(value) => {
          setClientFee(value);
          options.current = { ...options.current, clientFeeCents: parseCents(value) ?? undefined };
        }}
      />
    </ImpactDialog>
  );

  return { submit, dialog, saving: save.isPending };
}

/**
 * Offers to give the client a usual fee in the same save, when the change
 * leaves their sessions without one: it settles them all at once.
 */
export function ClientFeeField({ impact, value, onChange }: { impact: Impact | null; value: string; onChange: (value: string) => void }) {
  const clientsById = ClientsQuery.useById();
  if (!impact?.needsClientFee) return null;
  const name = clientsById.get(impact.needsClientFee)?.name ?? "The client";
  return (
    <Field>
      <FieldLabel htmlFor="client-fee">Give {name} a usual fee</FieldLabel>
      <Input
        id="client-fee"
        inputMode="decimal"
        placeholder="e.g. 90"
        className="max-w-40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldDescription>{name} has no usual fee: this sets one, so those sessions need no fix.</FieldDescription>
    </Field>
  );
}
