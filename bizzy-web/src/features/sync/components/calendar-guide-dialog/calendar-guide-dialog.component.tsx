import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";

interface Example {
  title: string;
  meaning: string;
}

// What the API reads (internal/calendar/syntax.go), put plainly.
const SESSIONS: Array<Example> = [
  { title: "Jane", meaning: "A session with Jane, at her usual fee." },
  { title: "Jane 95", meaning: "This session costs RM95." },
  { title: "Jane (V)", meaning: "A home visit at Jane's. (H) is at your place." },
  { title: "Jane 10x85", meaning: "Jane buys a package: 10 hours at RM85 each." },
  { title: "Jane 10@850", meaning: "Jane buys a package: 10 hours for RM850 in total." },
  { title: "? Jane", meaning: "Not confirmed yet." },
  { title: "? Jane (V) 95", meaning: "Mix them: the name first, the rest in any order." },
];

const FOLLOW_UPS: Array<Example> = [
  { title: "! Jane", meaning: "A reminder to get back to Jane." },
  { title: "! Jane: check knee", meaning: "With a note of what for." },
];

interface CalendarGuideDialogProps {
  open: boolean;
  onClose: () => void;
}

/** How to write an event's title in Google Calendar so bizzy reads it. */
export function CalendarGuideDialog({ open, onClose }: CalendarGuideDialogProps) {
  return (
    <SheetDialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Booking in Google Calendar</DialogTitle>
        <DialogDescription>
          Write the event's title like this. Its time is the session's time. bizzy picks it up on the next sync.
        </DialogDescription>
      </DialogHeader>
      <ExampleList heading="Sessions" examples={SESSIONS} />
      <ExampleList heading="Follow-ups" examples={FOLLOW_UPS} />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>The name is the client's, or one of their other calendar names. Capitals don't matter.</li>
        <li>A title bizzy can't read waits on your to-do list, saying what to fix.</li>
        <li>
          Deleting an event deletes its session for good, with its fee on a draft invoice. One with notes is cancelled
          instead, and one paid for or on an issued invoice waits on your to-do list.
        </li>
      </ul>
      <DialogFooter showCloseButton />
    </SheetDialog>
  );
}

function ExampleList({ heading, examples }: { heading: string; examples: Array<Example> }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      <dl className="divide-y rounded-lg border text-sm">
        {examples.map(({ title, meaning }) => (
          <div key={title} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="shrink-0 sm:w-36">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{title}</code>
            </dt>
            <dd className="text-muted-foreground">{meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
