import { useRef, useState } from "react";
import { DownloadIcon, FileTextIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { ATTACHMENT_ACCEPT } from "../../attachments.constant";
import { AttachmentsMutation } from "../../attachments.mutation";
import { AttachmentsQuery } from "../../attachments.query";
import { formatBytes, isPreviewable } from "../../attachments.util";
import type { AttachmentOwner, AttachmentView } from "../../attachments.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

interface AttachmentListProps {
  owner: AttachmentOwner;
  /** Whether files can be added or removed now (the owner's view says). */
  can: Verdict;
  /** What to call the button, e.g. "Attach a receipt". */
  addLabel?: string;
}

/**
 * An owner's files as tiles: photos as thumbnails, anything else by name.
 * Tapping one opens it; each can be downloaded or removed.
 */
export function AttachmentList({ owner, can, addLabel = "Attach photos or PDFs" }: AttachmentListProps) {
  const files = AttachmentsQuery.useList(owner);
  const upload = AttachmentsMutation.useUpload(owner);
  const remove = AttachmentsMutation.useRemove(owner);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<AttachmentView | null>(null);

  const attach = async (picked: FileList | null) => {
    const list = Array.from(picked ?? []);
    if (list.length === 0) return;
    let failed = 0;
    for (const [i, file] of list.entries()) {
      setProgress({ done: i, total: list.length });
      try {
        await upload.mutateAsync(file);
      } catch (error) {
        failed++;
        toast.error(error instanceof Error ? error.message : `${file.name} didn't upload.`);
      }
    }
    setProgress(null);
    const attached = list.length - failed;
    const message = attached === 1 ? "File attached" : `${attached} files attached`;
    // An expense's receipt is money: no quip there.
    if (attached > 0 && owner.ownerKind === "session") toastWithQuip(message, QUIPS.saved);
    else if (attached > 0) toast.success(message);
  };

  const items = files.data ?? [];
  if (!can.ok && items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {files.error && <p className="text-sm text-destructive">{files.error.message}</p>}
      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {items.map((file) => (
            <li key={file.id} className="group relative flex flex-col overflow-hidden rounded-md border">
              <a href={file.url} target="_blank" rel="noreferrer" className="block aspect-square bg-muted">
                {isPreviewable(file.contentType) ? (
                  <img src={file.url} alt={file.name} loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-muted-foreground">
                    <FileTextIcon className="size-8" aria-hidden="true" />
                    <span className="text-xs uppercase">{file.name.split(".").pop()}</span>
                  </span>
                )}
              </a>
              <div className="flex items-center gap-1 p-1.5 pl-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs" title={file.name}>
                    {file.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Download ${file.name}`}
                  render={<a href={file.downloadUrl} />}
                  nativeButton={false}
                >
                  <DownloadIcon />
                </Button>
                {can.ok && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${file.name}`}
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoving(file)}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {can.ok ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={progress !== null}
            onClick={() => input.current?.click()}
          >
            <PaperclipIcon />
            {progress
              ? progress.total === 1
                ? "Uploading…"
                : `Uploading ${progress.done + 1} of ${progress.total}…`
              : addLabel}
          </Button>
          <span className="text-xs text-muted-foreground">Photos are shrunk before upload. Up to 20 MB each.</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{can.why}</p>
      )}

      <SheetAlertDialog open={removing !== null} onClose={() => setRemoving(null)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
          <AlertDialogDescription>The file is deleted. Download it first if you still need it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              removing &&
              remove.mutate(removing.id, {
                onSuccess: () => toast.success("File removed"),
                onError: toastRefusal,
                onSettled: () => setRemoving(null),
              })
            }
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </SheetAlertDialog>
    </div>
  );
}
