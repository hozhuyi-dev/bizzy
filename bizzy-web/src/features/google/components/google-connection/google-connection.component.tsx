import { useState } from "react";
import { toast } from "sonner";
import { GoogleMutation } from "../../google.mutation";
import { GoogleQuery } from "../../google.query";
import { useGoogleConsent } from "../../google.hook";
import type { GoogleConnectionView } from "../../google.types";
import { useSyncCalendar } from "~/features/sync/sync.hook";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { Button } from "~/components/ui/button";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatDate } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";

/**
 * The Google account bizzy acts as: sessions come from one of its
 * calendars, and clients link to its contacts.
 */
export function GoogleConnectionSettings() {
  const status = GoogleQuery.useStatus();
  const startConsent = useGoogleConsent();

  return queryMatch(status, {
    pending: () => <LoadingState />,
    error: (error) => (
      <ErrorState error={error} retry={status.refetch} />
    ),
    success: (connection) =>
      connection ? (
        <Connected connection={connection} />
      ) : (
        <div>
          <Button onClick={startConsent}>Connect Google</Button>
        </div>
      ),
  });
}

interface CalendarChoice {
  id: string;
  name: string;
}

function Connected({ connection }: { connection: GoogleConnectionView }) {
  const startConsent = useGoogleConsent();
  const calendars = GoogleQuery.useCalendars(!connection.problem);
  const [disconnecting, setDisconnecting] = useState(false);
  const [choosing, setChoosing] = useState<CalendarChoice | null>(null);

  const chosen = connection.calendarId ? [{ id: connection.calendarId, name: connection.calendarName }] : [];
  const items = (calendars.data ?? chosen).map((calendar) => ({ value: calendar.id, label: calendar.name }));

  return (
    <>
      <p className="text-sm">
        Connected as <b>{connection.email || "your Google account"}</b> since{" "}
        {formatDate(connection.connectedAt)}.
      </p>

      {connection.problem && (
        <div className="flex flex-wrap items-center gap-2">
          <ErrorMessage>{connection.problem}</ErrorMessage>
          <Button size="sm" onClick={startConsent}>
            Reconnect
          </Button>
        </div>
      )}

      <Field>
        <FieldLabel>Calendar</FieldLabel>
        <Select
          items={items}
          // Unchanged until confirmed: the dialog decides.
          value={connection.calendarId || null}
          disabled={Boolean(connection.problem)}
          onValueChange={(id) => {
            const item = items.find((i) => i.value === id);
            if (item && id !== connection.calendarId) setChoosing({ id: item.value, name: item.label });
          }}
        >
          <SelectTrigger className="w-full max-w-sm data-[size=default]:h-(--control-height)">
            <SelectValue placeholder="Choose a calendar" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          The calendar you book sessions in. Every event in it is read as bizzy's.
        </FieldDescription>
      </Field>

      <div>
        <Button variant="outline" size="sm" onClick={() => setDisconnecting(true)}>
          Disconnect
        </Button>
      </div>

      <ChooseCalendarDialog
        choice={choosing}
        current={connection.calendarId ? connection.calendarName : null}
        onClose={() => setChoosing(null)}
      />
      <DisconnectDialog open={disconnecting} onClose={() => setDisconnecting(false)} />
    </>
  );
}

/** Choosing a calendar writes every session and follow-up into it and reads every event in it as bizzy's. */
function ChooseCalendarDialog({
  choice,
  current,
  onClose,
}: {
  choice: CalendarChoice | null;
  current: string | null;
  onClose: () => void;
}) {
  const setCalendar = GoogleMutation.useSetCalendar();
  const sync = useSyncCalendar();
  const name = choice?.name ?? "";

  return (
    <SheetAlertDialog open={choice !== null} onClose={onClose}>
      <AlertDialogHeader>
        <AlertDialogTitle>Sync bizzy with {name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Every session and follow-up in bizzy is written into {name}, and every event already
          in it is read as bizzy's: a session, a follow-up, or, if it doesn't fit, a fix on your
          to-do list.{" "}
          {current
            ? `${current} is left as it is, and bizzy stops reading it.`
            : "Older events come in a month at a time after the first sync."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <PendingButton
          disabled={!choice}
          pending={setCalendar.isPending}
          onClick={() =>
            choice &&
            setCalendar.mutate(
              { id: choice.id },
              {
                onSuccess: (updated) => {
                  toast.success(`Syncing ${updated.calendarName}…`);
                  onClose();
                  sync().catch(toastRefusal);
                },
                onError: toastRefusal,
              },
            )
          }
        >
          Sync with it
        </PendingButton>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}

function DisconnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disconnect = GoogleMutation.useDisconnect();

  return (
    <SheetAlertDialog open={open} onClose={onClose}>
      <AlertDialogHeader>
        <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
        <AlertDialogDescription>
          The calendar stops syncing and clients can't be added until you connect again. Nothing
          in your calendar or contacts is changed, and sessions, clients and receipts stay.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep connected</AlertDialogCancel>
        <PendingButton
          variant="destructive"
          pending={disconnect.isPending}
          onClick={() =>
            disconnect.mutate(undefined, {
              onSuccess: () => {
                toast.success("Google disconnected");
                onClose();
              },
              onError: toastRefusal,
            })
          }
        >
          Disconnect
        </PendingButton>
      </AlertDialogFooter>
    </SheetAlertDialog>
  );
}
