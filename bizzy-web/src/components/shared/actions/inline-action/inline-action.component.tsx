import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

/*
 * A row's buttons, swapped in place for a question (to make sure of what
 * can't be taken back) or one field (a fee, a summary). Each is one
 * button high, so nothing around it moves: it only fades in.
 */

const SWAP = "flex min-w-0 flex-1 items-center gap-1.5 duration-150 animate-in fade-in-0 motion-reduce:animate-none sm:flex-none";

interface InlineConfirmProps {
  question: string;
  /** The button that takes it, e.g. "Cancel INV-001". */
  yes: string;
  pending?: boolean;
  onYes: () => void;
  onNo: () => void;
  size?: "xs" | "sm";
}

export function InlineConfirm({ question, yes, pending, onYes, onNo, size = "sm" }: InlineConfirmProps) {
  return (
    <span role="group" aria-label={question} className={SWAP}>
      <span title={question} className="line-clamp-2 min-w-0 flex-1 text-xs leading-tight sm:line-clamp-1 sm:text-sm">
        {question}
      </span>
      <Button size={size} variant="destructive" disabled={pending} autoFocus onClick={onYes}>
        {yes}
      </Button>
      <Button size={size} variant="ghost" disabled={pending} onClick={onNo}>
        Keep
      </Button>
    </span>
  );
}

interface InlineFieldProps {
  /** What it is, for screen readers: "Usual fee". */
  label: string;
  placeholder?: string;
  inputMode?: "decimal" | "text";
  maxLength?: number;
  /** Whether a value can be saved; any but blank otherwise. */
  valid?: (value: string) => boolean;
  pending?: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
  /** After Save, e.g. a link to the whole form. */
  extra?: ReactNode;
  size?: "xs" | "sm";
}

export function InlineField({
  label,
  placeholder,
  inputMode,
  maxLength,
  valid,
  pending,
  onSave,
  onCancel,
  extra,
  size = "sm",
}: InlineFieldProps) {
  const [value, setValue] = useState("");
  const ok = value.trim() !== "" && (valid?.(value) ?? true);

  return (
    <form
      className={`${SWAP} sm:w-80`}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok && !pending) onSave(value.trim());
      }}
    >
      <Input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className={size === "xs" ? "h-6 flex-1" : "h-7 flex-1"}
      />
      <Button type="submit" size={size} disabled={!ok || pending}>
        <CheckIcon /> Save
      </Button>
      <Button type="button" size={size === "xs" ? "icon-xs" : "icon-sm"} variant="ghost" aria-label="Cancel" onClick={onCancel}>
        <XIcon />
      </Button>
      {extra}
    </form>
  );
}
