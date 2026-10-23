import { useId, useRef, useState } from "react";
import { QrCodeIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { qrPayee, readQr } from "../../duitnow-qr.util";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";

interface DuitNowQrFieldProps {
  /** What the QR says; blank for none. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * Her DuitNow QR, uploaded as an image: the browser reads what it says, and
 * the payment page draws it again from that. Shows who it pays, so the
 * right QR is easy to tell.
 */
export function DuitNowQrField({ value, onChange }: DuitNowQrFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const payee = value ? qrPayee(value) : undefined;

  const read = async (file: File) => {
    setReading(true);
    try {
      const payload = await readQr(file);
      if (payload) onChange(payload);
      else toast.error("Couldn't find a QR in that image. Try a screenshot of the QR on its own.");
    } catch {
      toast.error("Couldn't open that image. Try a PNG or JPEG screenshot.");
    } finally {
      setReading(false);
    }
  };

  return (
    <Field>
      <FieldLabel htmlFor={id}>DuitNow QR</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 inline-flex items-center gap-2 text-sm">
          <QrCodeIcon className="size-4 text-muted-foreground" />
          {value ? (payee ? `Pays ${payee}` : "QR added") : <span className="text-muted-foreground">No QR yet</span>}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => input.current?.click()}>
          <UploadIcon /> {reading ? "Reading…" : value ? "Replace" : "Upload QR"}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            <Trash2Icon /> Remove
          </Button>
        )}
      </div>
      <FieldDescription>
        The QR your bank or e-wallet gives you to receive money, as a screenshot or photo. Any bank app, TnG and
        GrabPay can scan it.
      </FieldDescription>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same file again reads it again.
          event.target.value = "";
          if (file) void read(file);
        }}
      />
    </Field>
  );
}
