import { SearchIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useQuip } from "~/components/shared/quip/quip.hook";
import { QUIPS } from "~/core/constants/quips.constant";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Says what is searched, e.g. "Search clients"; the placeholder is a quip. */
  label: string;
  className?: string | undefined;
}

/** A search box for the list below it. Escape or × clears it. */
export function SearchInput({ value, onChange, label, className }: SearchInputProps) {
  const placeholder = useQuip(QUIPS.searchPlaceholder);
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        // Room for × only while there is something to clear, so the placeholder fits.
        className={cn("pl-8 [&::-webkit-search-cancel-button]:hidden", value && "pr-8")}
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          onClick={() => onChange("")}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
