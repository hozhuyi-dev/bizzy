import { useId, useRef, useState } from "react";
import { DownloadIcon, FileTextIcon, ImageUpIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ATTACHMENT_ACCEPT } from "../../attachments.constant";
import { useShrinkPhotos } from "../../attachments.hook";
import { AttachmentsMutation } from "../../attachments.mutation";
import { AttachmentsQuery } from "../../attachments.query";
import { formatBytes, isPreviewable } from "../../attachments.util";
import type { AttachmentOwner, AttachmentView } from "../../attachments.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import { ActionMenu } from "~/components/shared/actions/action-bar/action-bar.component";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
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
 * An owner's files as tiles, each its small thumbnail (a photo, a PDF's
 * first page; anything without one by its type), so a page of them loads
 * at once. Tapping one opens the file itself; each can be downloaded or
 * removed. Photos are shrunk before upload unless that is turned off; one
 * shrunk too far can be replaced with the photo at full size.
 */
export function AttachmentList({ owner, can, addLabel = "Attach photos or PDFs" }: AttachmentListProps) {
  const files = AttachmentsQuery.useList(owner);
  const upload = AttachmentsMutation.useUpload(owner);
  const remove = AttachmentsMutation.useRemove(owner);
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const shrinkId = useId();
  const [shrink, setShrink] = useShrinkPhotos();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<AttachmentView | null>(null);
  const [replacing, setReplacing] = useState<AttachmentView | null>(null);

  const attach = async (picked: FileList | null) => {
    const list = Array.from(picked ?? []);
    if (list.length === 0) return;
    let failed = 0;
    for (const [i, file] of list.entries()) {
      setProgress({ done: i, total: list.length });
      try {
        await upload.mutateAsync({ file, shrink });
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

  // The photo picked again, as it is, in the shrunk one's place.
  const replace = async (picked: FileList | null, old: AttachmentView | null) => {
    const file = picked?.[0];
    if (!file || !old) return;
    setProgress({ done: 0, total: 1 });
    try {
      await upload.mutateAsync({ file, shrink: false, replaces: old.id });
      toast.success("Replaced with the full-size photo");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${file.name} didn't upload.`);
    } finally {
      setProgress(null);
      setReplacing(null);
    }
  };

  const tileActions = (file: AttachmentView): Array<Action> => {
    if (!can.ok) return [];
    const removeFile: Action = {
      type: "button",
      label: "Remove",
      icon: Trash2Icon,
      style: "destructive",
      onClick: () => setRemoving(file),
    };
    if (!file.originalBytes) return [removeFile];
    const replaceWithFull: Action = {
      type: "button",
      label: "Replace with full size",
      icon: ImageUpIcon,
      disabled: progress !== null,
      onClick: () => {
        setReplacing(file);
        replaceInput.current?.click();
      },
    };
    return [replaceWithFull, removeFile];
  };

  const items = files.data ?? [];
  if (!can.ok && items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {files.error && <p className="text-sm text-destructive">{files.error.message}</p>}
      {items.length > 0 && (
        // One tile size everywhere, as many to a row as fit: two on the
        // narrowest phone (360px, less the gutters and the card's padding),
        // and the thumbnails (THUMBNAIL_MAX_SIDE) stay sharp at it.
        <ul className="grid grid-cols-[repeat(auto-fill,9rem)] gap-2">
          {items.map((file) => (
            <li key={file.id} className="group relative flex flex-col overflow-hidden rounded-md border">
              <a href={file.url} target="_blank" rel="noreferrer" className="relative block aspect-square bg-muted">
                <TilePreview file={file} />
              </a>
              <span className="truncate px-2 pt-1.5 text-xs" title={file.name}>
                {file.name}
              </span>
              <div className="flex items-center gap-1 p-1.5 pt-0 pl-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {formatBytes(file.sizeBytes)}
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
                <ActionMenu actions={tileActions(file)} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={replaceInput}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          void replace(e.target.files, replacing);
          e.target.value = "";
        }}
      />
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
          <div className="flex items-center gap-2">
            <Checkbox id={shrinkId} checked={shrink} onCheckedChange={setShrink} disabled={progress !== null} />
            <Label htmlFor={shrinkId} className="text-xs font-normal">
              Shrink photos
            </Label>
          </div>
          <span className="w-full text-xs text-muted-foreground">
            {shrink ? "Photos are shrunk to save space; open one to check it." : "Photos are uploaded at full size."}{" "}
            Up to 20 MB each.
          </span>
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

/**
 * A tile's picture: its thumbnail; a photo from before thumbnails as it
 * is; anything else by its type. Tagged when shrunk (from what size), or a PDF.
 */
function TilePreview({ file }: { file: AttachmentView }) {
  const pdf = file.contentType === "application/pdf";
  const src = file.thumbnailUrl ?? (isPreviewable(file.contentType) ? file.url : undefined);
  const tag = file.originalBytes ? `Shrunk from ${formatBytes(file.originalBytes)}` : pdf && src ? "PDF" : undefined;
  return (
    <>
      {src ? (
        // A page shows its top, where its title is.
        <img src={src} alt={file.name} loading="lazy" className={cn("size-full object-cover", pdf && "object-top")} />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-muted-foreground">
          <FileTextIcon className="size-8" aria-hidden="true" />
          <span className="text-xs uppercase">{file.name.split(".").pop()}</span>
        </span>
      )}
      {tag && (
        <span className="absolute top-1.5 left-1.5 rounded-sm bg-background/90 px-1.5 py-0.5 text-2xs font-medium text-foreground">
          {tag}
        </span>
      )}
    </>
  );
}
