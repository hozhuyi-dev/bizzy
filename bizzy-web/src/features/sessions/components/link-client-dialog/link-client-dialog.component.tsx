import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Session } from "../../sessions.types";
import type { Impact } from "~/features/billing/billing.types";
import { ClientsMutation } from "~/features/clients/clients.mutation";
import { ClientsService } from "~/features/clients/clients.service";
import { profileOf } from "~/features/clients/clients.util";
import { ClientsQuery } from "~/features/clients/clients.query";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatSessionTime } from "~/core/utils/date.util";

interface LinkClientDialogProps {
  session: Session | null;
  onClose: () => void;
}

/**
 * Links an unmatched calendar name to a client by adding it as one of their
 * calendar names, or creates the client. Every session with that name then
 * matches, now and in future syncs.
 */
export function LinkClientDialog({ session, onClose }: LinkClientDialogProps) {
  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {session && <LinkClientBody key={session.eventId} session={session} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkClientBody({ session, onClose }: { session: Session; onClose: () => void }) {
  const clients = ClientsQuery.useList();
  const save = ClientsMutation.useSave();
  const navigate = useNavigate();
  const [clientId, setClientId] = useState(session.suggestedClientId ?? "");
  const name = session.name ?? "";

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // What linking brings on (a session matched to a client with no fee, a
  // package price coming through) is shown first, to link anyway.
  const [impact, setImpact] = useState<Impact | null>(null);

  const link = async () => {
    const client = clients.data?.find((c) => c.id === clientId);
    if (!client) return;
    const input = { ...profileOf(client), aliases: [...client.aliases, name] };
    if (!impact) {
      try {
        const preview = await ClientsService.impact(input);
        if (preview.refused) return void toast.error(preview.refused);
        if (preview.needsConfirm) return void setImpact(preview);
      } catch (error) {
        return void toast.error((error as Error).message);
      }
    }
    save.mutate(
      { input, confirm: impact !== null },
      {
        onSuccess: () => {
          toast.success(`“${name}” now matches ${client.name}`);
          onClose();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Who is “{name}”?</DialogTitle>
        <DialogDescription>
          If it's a typo, edit the session instead. Otherwise add it as one of a client's
          calendar names.
        </DialogDescription>
      </DialogHeader>

      <Field>
        <FieldLabel>Client</FieldLabel>
        <Select items={items} value={clientId} onValueChange={(value) => {
            setClientId(value ?? "");
            setImpact(null);
          }}>
          <SelectTrigger className="w-full">
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
        {session.suggestedClientId && (
          <FieldDescription>Suggested because the names are close.</FieldDescription>
        )}
      </Field>

      {impact && (
        <div className="flex flex-col gap-1 text-sm">
          <p>Linking leaves these to fix, on your to-do list:</p>
          <ul className="flex max-h-48 flex-col divide-y overflow-y-auto">
            {impact.brings.map((b) => (
              <li key={`${b.kind}-${b.id}-${b.rule}`} className="flex flex-col py-1.5">
                <span>{formatSessionTime(b.start)}</span>
                <span className="text-muted-foreground">{b.problem}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          onClick={() => {
            onClose();
            void navigate({ to: "/clients/new", search: { name, from: "home" } });
          }}
        >
          New client
        </Button>
        <Button disabled={!clientId || save.isPending} onClick={() => void link()}>
          {save.isPending ? "Linking…" : impact ? "Link anyway" : "Link"}
        </Button>
      </DialogFooter>
    </>
  );
}
