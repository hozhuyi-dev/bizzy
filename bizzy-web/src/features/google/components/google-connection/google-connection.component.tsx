import { useState } from "react";
import { toast } from "sonner";
import { GoogleMutation, GoogleQuery } from "../../google.query";
import { startGoogleConsent } from "../../google.oauth";
import type { GoogleConnection } from "../../google.types";
import { SyncMutation } from "~/features/sync/sync.query";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";

/**
 * The Google account bizzy acts as: sessions come from one of its
 * calendars, and clients link to its contacts.
 */
export function GoogleConnectionSettings() {
  const status = GoogleQuery.useStatus();

  return queryMatch(status, {
    pending: () => <Loading />,
    error: (error) => (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    ),
    success: (connection) =>
      connection ? (
        <Connected connection={connection} />
      ) : (
        <div>
          <Button onClick={startGoogleConsent}>Connect Google</Button>
        </div>
      ),
  });
}

function Connected({ connection }: { connection: GoogleConnection }) {
  const calendars = GoogleQuery.useCalendars(!connection.problem);
  const setCalendar = GoogleMutation.useSetCalendar();
  const sync = SyncMutation.useRun();
  const [disconnecting, setDisconnecting] = useState(false);

  const items = (calendars.data ?? [{ id: connection.calendarId, name: connection.calendarName }]).map(
    (calendar) => ({ value: calendar.id, label: calendar.name }),
  );

  return (
    <>
      <p className="text-sm">
        Connected as <b>{connection.email || "your Google account"}</b> since{" "}
        {formatDate(connection.connectedAt)}.
      </p>

      {connection.problem && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {connection.problem}
          </p>
          <Button size="sm" onClick={startGoogleConsent}>
            Reconnect
          </Button>
        </div>
      )}

      <Field>
        <FieldLabel>Calendar</FieldLabel>
        <Select
          items={items}
          value={connection.calendarId}
          disabled={setCalendar.isPending || Boolean(connection.problem)}
          onValueChange={(id) =>
            id &&
            id !== connection.calendarId &&
            setCalendar.mutate(id, {
              onSuccess: (updated) => {
                toast.success(`Reading ${updated.calendarName}`);
                // A different calendar is read in full, replacing the old one's sessions.
                sync.mutate({ all: true }, { onError: (error) => toast.error(error.message) });
              },
              onError: (error) => toast.error(error.message),
            })
          }
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>The calendar you book sessions in.</FieldDescription>
      </Field>

      <div>
        <Button variant="outline" size="sm" onClick={() => setDisconnecting(true)}>
          Disconnect
        </Button>
      </div>

      <DisconnectDialog open={disconnecting} onClose={() => setDisconnecting(false)} />
    </>
  );
}

function DisconnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disconnect = GoogleMutation.useDisconnect();

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
          <AlertDialogDescription>
            The calendar stops syncing and clients can't be added until you connect again. Nothing
            in your calendar or contacts is changed, and sessions, clients and receipts stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep connected</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={disconnect.isPending}
            onClick={() =>
              disconnect.mutate(undefined, {
                onSuccess: () => {
                  toast.success("Google disconnected");
                  onClose();
                },
                onError: (error) => toast.error(error.message),
              })
            }
          >
            Disconnect
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
