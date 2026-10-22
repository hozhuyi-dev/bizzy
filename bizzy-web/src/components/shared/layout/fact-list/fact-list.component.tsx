import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * Figures at a glance, each a quiet label over its value, in a grid: three
 * across on a wider screen, one under the other on a phone.
 */
export function FactList({ children }: { children: ReactNode }) {
  return <dl className="grid gap-4 text-sm sm:grid-cols-3">{children}</dl>;
}

interface FactProps {
  label: string;
  /** Takes the whole row: a value with more to say. */
  wide?: boolean | undefined;
  children: ReactNode;
}

/** One figure: "Owed", "RM 180". */
export function Fact({ label, wide, children }: FactProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", wide && "sm:col-span-3")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
