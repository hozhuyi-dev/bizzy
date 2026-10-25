import { useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useLocation } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { daysFromToday, toCreateFollowUp, toFollowUpFields, toFollowUpValues } from "./follow-ups.form";
import { FollowUpsMutation } from "./follow-ups.mutation";
import { FollowUpsQuery } from "./follow-ups.query";
import { useMarkDone } from "./follow-ups.hook";
import { formatDue } from "./follow-ups.util";
import { FollowUpPager, followUpParent } from "./components/follow-up-pager/follow-up-pager.component";
import type { FollowUpStepping } from "./components/follow-up-pager/follow-up-pager.component";
import type { ReactNode } from "react";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import type { LinkOptions } from "@tanstack/react-router";
import type { FollowUpTarget, FollowUpView } from "./follow-ups.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { PageStep } from "~/components/shared/layout/page-steps/page-steps.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { PageSteps } from "~/components/shared/layout/page-steps/page-steps.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";
import { FieldGroup } from "~/components/ui/field";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { useAppForm } from "~/components/shared/form/form.hook";
import { QUIPS } from "~/core/constants/quips.constant";
import { useGoBack } from "~/core/navigation/go-back.hook";
import { formatDate, formatSessionTime, todayISO } from "~/core/utils/date.util";
import { requiredError } from "~/core/utils/form.util";
import { allOf } from "~/core/utils/query.util";
import { isApiError } from "~/core/utils/api-error.util";

const FORM_ID = "follow-up-form";

// As the API keeps them: the summary is the calendar title, the notes its description.
const MAX_SUMMARY = 200;
const MAX_NOTES = 8000;

/** A new one's list, where it goes back to when it wasn't opened from another page. */
const PARENT: Parent = { to: "/follow-ups", label: "Follow-ups" };

/** Quick picks, counted from today. */
const IN = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
];

/**
 * A follow-up's page, or a new one's: what to follow up and when, then
 * whether it is done. It is written to the calendar as `! Name: summary`
 * with the notes as the event's description, so it shows on the user's
 * phone too. A new one starts with the client and session it was opened
 * for, as the page that opened it left them in history.
 */
export function FollowUpPage({ id, stepping }: { id?: string | undefined; stepping?: FollowUpStepping | undefined }) {
  const detail = FollowUpsQuery.useDetail(id);
  const clients = ClientsQuery.useList();
  const clientId = useLocation({ select: (location) => location.state.clientId });
  const sessionId = useLocation({ select: (location) => location.state.sessionId });
  const header: FollowUpHeader = {
    parent: stepping ? followUpParent(stepping.within, stepping.filter) : PARENT,
    // Steps on while the next one loads, so the header stays put.
    pager: id !== undefined && stepping && (
      <FollowUpPager id={id} gone={isApiError(detail.error, "not_found")} stepping={stepping} />
    ),
  };

  if (clients.data && (id === undefined || detail.data)) {
    const target: FollowUpTarget = detail.data ? { mode: "edit", followUp: detail.data } : { mode: "new", clientId, sessionId };
    return <FollowUpEditor key={detail.data?.id ?? "new"} target={target} header={header} />;
  }
  const page = id === undefined ? clients : allOf(clients, detail);
  return (
    <>
      <PageHeader {...header} title={page.error ? "Not available" : "…"} kind="Follow-up" />
      {page.error ? (
        <ErrorState
          error={page.error}
          retry={page.refetch}
          size="page"
          back={{ label: `Back to ${header.parent.label}`, link: header.parent as LinkOptions }}
        />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

/** The header's way back and pager, the same while the follow-up loads. */
interface FollowUpHeader {
  parent: Parent;
  pager: ReactNode;
}

function FollowUpEditor({ target, header }: { target: FollowUpTarget; header: FollowUpHeader }) {
  const clientsById = ClientsQuery.useById();
  const create = FollowUpsMutation.useCreate();
  const update = FollowUpsMutation.useUpdate();
  const remove = FollowUpsMutation.useDelete();
  const markDone = useMarkDone();
  const goBack = useGoBack(header.parent as LinkOptions);
  const [deleting, setDeleting] = useState(false);
  const editing = target.mode === "edit" ? target.followUp : undefined;
  const sessionId = target.mode === "new" ? target.sessionId : undefined;
  // One opened for a client (from their page, a session) keeps them.
  const fixedClient = target.mode === "new" && Boolean(target.clientId);

  const form = useAppForm({
    defaultValues: toFollowUpValues(target),
    onSubmit: async ({ value, formApi }) => {
      try {
        if (editing) {
          await update.mutateAsync({ id: editing.id, fields: toFollowUpFields(value, editing) });
          formApi.reset(value);
          toastWithQuip("Follow-up updated", QUIPS.saved);
        } else {
          await create.mutateAsync(toCreateFollowUp(value, sessionId));
          toastWithQuip("Follow-up added to your calendar", QUIPS.saved);
          // Back to what it was added from.
          goBack({ leaving: true });
        }
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  const clientId = useSelector(form.store, (state) => state.values.clientId);
  const summary = useSelector(form.store, (state) => state.values.summary);
  const clientName = clientsById.get(clientId)?.name;

  const save: Action = {
    type: "submit",
    form: FORM_ID,
    label: editing ? "Save" : "Add follow-up",
    style: "primary",
    pending: isSubmitting,
  };

  const steps: Array<PageStep> = [
    {
      id: "follow-up",
      title: "Follow-up",
      state: editing ? "done" : "current",
      meta: editing && dueLine(editing),
      content: (
        <FieldGroup>
          <p className="text-sm text-muted-foreground">
            In your calendar as “! {clientName ?? "Name"}
            {summary.trim() ? `: ${summary.trim()}` : ""}”.
          </p>
          {!fixedClient && (
            <form.AppField name="clientId" validators={{ onChange: ({ value }) => requiredError(value, "Choose a client") }}>
              {() => <ClientSelectField keepId={editing?.clientId} />}
            </form.AppField>
          )}

          <form.AppField name="summary">
            {(field) => (
              <field.TextField label="What to follow up" maxLength={MAX_SUMMARY} placeholder="Check MRI results" />
            )}
          </form.AppField>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)] items-start gap-2 sm:grid-cols-[10rem_8rem]">
              <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Pick a day") }}>
                {(field) => (
                  <field.TextField
                    label="When"
                    type="date"
                    // Fine for a note of a call made; most often a slip.
                    description={field.state.value && field.state.value < todayISO() ? "That day has passed." : undefined}
                  />
                )}
              </form.AppField>
              <form.Subscribe selector={(state) => state.values.allDay}>
                {(allDay) =>
                  !allDay && (
                    <form.AppField
                      name="time"
                      validators={{
                        onChangeListenTo: ["allDay"],
                        onChange: ({ value, fieldApi }) =>
                          fieldApi.form.getFieldValue("allDay") ? undefined : requiredError(value, "Pick a time"),
                      }}
                    >
                      {(field) => <field.TextField label="Time" type="time" step={300} />}
                    </form.AppField>
                  )
                }
              </form.Subscribe>
            </div>
            <div className="flex flex-wrap gap-1">
              {IN.map(({ label, days }) => (
                <Button key={label} type="button" variant="outline" size="xs" onClick={() => form.setFieldValue("date", daysFromToday(days))}>
                  In {label}
                </Button>
              ))}
            </div>
          </div>

          <form.AppField name="allDay">
            {(field) => <field.CheckboxField label="All day" description="Untick to block a time for the call." />}
          </form.AppField>

          <form.AppField name="notes">
            {(field) => (
              <field.TextareaField
                label="Notes"
                rows={4}
                maxLength={MAX_NOTES}
                description="Saved as the calendar event's description."
              />
            )}
          </form.AppField>
        </FieldGroup>
      ),
    },
    doneStep(editing, markDone),
  ];

  return (
    <>
      <PageHeader
        {...header}
        title={(editing ? (clientName ?? editing.clientName) : clientName) ?? "New follow-up"}
        titleLink={editing && clientsById.has(editing.clientId) ? { to: "/clients/$id", params: { id: editing.clientId } } : undefined}
        kind={editing ? "Follow-up" : clientName ? "New follow-up" : undefined}
        subtitle={editing ? `due ${formatDue(editing)}` : undefined}
        // Save while there is something to keep; a new one is nothing until added.
        actions={!editing || hasChanges ? [save] : []}
        menuActions={
          editing && [{ type: "button", label: "Delete", icon: Trash2Icon, style: "destructive", onClick: () => setDeleting(true) }]
        }
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

      {editing && (
        <SheetAlertDialog open={deleting} onClose={() => setDeleting(false)}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this follow-up?</AlertDialogTitle>
            <AlertDialogDescription>It is deleted from your calendar too.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <PendingButton
              variant="destructive"
              pending={remove.isPending}
              onClick={() =>
                remove.mutate(editing.id, {
                  onSuccess: () => {
                    toast.success("Follow-up deleted from your calendar");
                    goBack({ leaving: true });
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
      )}
    </>
  );
}

/** "Due Tue 20 Oct", with its time unless all day. */
function dueLine(followUp: FollowUpView): string {
  return `Due ${followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due)}`;
}

/**
 * Whether the user has got back to the client: to do once it is on the
 * to-do list (due soon or overdue), ahead before then. Marking it is the
 * step's own action, and can be undone.
 */
function doneStep(followUp: FollowUpView | undefined, markDone: ReturnType<typeof useMarkDone>): PageStep {
  if (!followUp) {
    return { id: "done", title: "Done", state: "todo", content: <p className="text-sm text-muted-foreground">Once it is added, it waits here until you mark it done.</p> };
  }
  const done = followUp.doneAt;
  return {
    id: "done",
    title: "Done",
    state: done ? "done" : followUp.todo.length > 0 ? "current" : "todo",
    meta: done ? `Done ${formatDate(done)}` : undefined,
    actions: [
      done
        ? { type: "button", label: "Not done", icon: RotateCcwIcon, pending: markDone.isPending, onClick: () => markDone.mark(followUp, false) }
        : { type: "button", label: "Mark done", icon: CheckIcon, pending: markDone.isPending, onClick: () => markDone.mark(followUp, true) },
    ],
    content: (
      <p className="text-sm">
        {done
          ? `Done ${formatDate(done)}.`
          : followUp.todo.length > 0
            ? "On your to-do list. Mark it done once you've got back to them."
            : `It comes onto your to-do list nearer the day. ${dueLine(followUp)}.`}
      </p>
    ),
  };
}
