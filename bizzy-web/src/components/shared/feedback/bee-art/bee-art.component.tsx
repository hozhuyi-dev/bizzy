import { useState } from "react";
import { cn } from "cn";
import type { ReactNode } from "react";
import { BeeMark } from "~/components/shared/layout/logo/logo.component";

/**
 * Small line drawings for the app's quiet states, drawn like the bee mark
 * (lines only, in currentColor) but never in its honey: the colour stays
 * the logo's, and these take the text colour around them (muted). A quip
 * that names something drawn shows it (see ART_WORDS); any other gets one
 * picked from its pool as it shows, so they stay fresh.
 */
export type BeeArtPool = keyof typeof BEE_ART;

interface ArtProps {
  className?: string | undefined;
}

interface BeeArtProps {
  pool: BeeArtPool;
  /** The quip beside it: what it names is drawn, when it names something. */
  quip?: string | undefined;
  className?: string | undefined;
}

/** The drawing for the quip, or one from the pool, picked when it mounts: it stays put while the page re-renders. */
export function BeeArt({ pool, quip, className }: BeeArtProps) {
  const [Drawing] = useState(() => {
    const drawings = BEE_ART[pool];
    return (quip && artFor(quip)) || (drawings[Math.floor(Math.random() * drawings.length)] ?? BeeArtBee);
  });
  return <Drawing className={className} />;
}

type Drawing = (props: ArtProps) => ReactNode;

/** The drawing a quip names, by the first of ART_WORDS it has; none for one that names nothing drawn. */
export function artFor(quip: string): Drawing | undefined {
  return ART_WORDS.find(([words]) => words.test(quip))?.[1];
}

/** Every drawing on a 32-unit square, stroked like the bee mark. */
function Art({ className, children }: ArtProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** A dotted flight path: round caps on near-zero dashes draw dots. */
const DOTTED = { strokeDasharray: "0.01 3" };

/** A little bee, centred on (x, y), flying right. */
function Bee({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-0.6 -2.3C-2.8 -5.6 0.6 -6.8 0.6 -2.5" />
      <path d="M1 -2.3C2.6 -5.8 5.4 -4.2 2.2 -1.7" />
      <ellipse cx="0" cy="0" rx="3.4" ry="2.5" />
      <path d="M1 -2.4Q1.7 0 1 2.4" />
      <path d="M3.4 0h1.2" />
    </g>
  );
}

/** The bee mark itself, in the colour around it; cropped to the bee, so drawn smaller to match the rest. */
function BeeArtBee({ className }: ArtProps) {
  return <BeeMark className={cn("scale-80 text-current", className)} />;
}

function BeeArtHoneycomb({ className }: ArtProps) {
  return (
    <Art className={className}>
      <path d="M16 6L21.2 9V15L16 18L10.8 15V9Z" />
      <path d="M10.8 15L16 18V24L10.8 27L5.6 24V18Z" />
      <path d="M21.2 15L26.4 18V24L21.2 27L16 24V18" />
      <path d="M16 12h0" />
    </Art>
  );
}

/** A skep: the old woven hive, with its door. */
function BeeArtHive({ className }: ArtProps) {
  return (
    <Art className={className}>
      <path d="M8 26V20Q8 8 16 7Q24 8 24 20V26" />
      <path d="M6 26H26" />
      <path d="M8 21H24" />
      <path d="M8.8 16Q16 15 23.2 16" />
      <path d="M11.5 11.5Q16 10.8 20.5 11.5" />
      <path d="M16 7V5.5" />
      <path d="M14 26V24a2 2 0 0 1 4 0V26" />
    </Art>
  );
}

function BeeArtFlower({ className }: ArtProps) {
  return (
    <Art className={className}>
      <circle cx="11" cy="14.6" r="2.4" />
      <circle cx="15" cy="17.7" r="2.4" />
      <circle cx="13.5" cy="22.4" r="2.4" />
      <circle cx="8.5" cy="22.4" r="2.4" />
      <circle cx="7" cy="17.7" r="2.4" />
      <circle cx="11" cy="19" r="1.6" />
      <path d="M11 25V30" />
      <path d="M11 28.2Q14.5 28 15.5 25" />
      <path d="M19.5 11.5Q17 13 16.2 15" {...DOTTED} />
      <Bee x={23} y={9} />
    </Art>
  );
}

function BeeArtJar({ className }: ArtProps) {
  return (
    <Art className={className}>
      <rect x="9" y="7" width="14" height="4" rx="1.5" />
      <path d="M10 11C8.5 13 8 15 8 18V24a3 3 0 0 0 3 3H21a3 3 0 0 0 3-3V18C24 15 23.5 13 22 11" />
      <path d="M13 11v3a1.2 1.2 0 0 0 2.4 0V11" />
      <path d="M16 17.4L18.25 18.7V21.3L16 22.6L13.75 21.3V18.7Z" />
    </Art>
  );
}

/** Three bees, out together. */
function BeeArtTrio({ className }: ArtProps) {
  return (
    <Art className={className}>
      <path d="M11 18.5Q12.5 15.5 13.5 13.8" {...DOTTED} />
      <path d="M19.5 13.5Q21.5 15.5 22 17" {...DOTTED} />
      <Bee x={8} y={22} />
      <Bee x={16} y={10.5} />
      <Bee x={24} y={21} />
    </Art>
  );
}

function BeeArtSleeping({ className }: ArtProps) {
  return (
    <Art className={className}>
      <path d="M14 14.2C11 11 12.8 7.6 15.3 8.8C17.2 9.8 16.6 12.6 15 14.1" />
      <ellipse cx="14" cy="20" rx="8" ry="6" />
      <path d="M17 14.4Q18.4 20 17 25.6" />
      <path d="M20 15.8Q21 20 20 24.2" />
      <path d="M22 20h2" />
      <path d="M8.6 18.6q1.1.9 2.2 0" />
      <path d="M8.4 15.4Q7.6 12.8 5.4 12" />
      <path d="M21 5h3l-3 3.5h3" />
      <path d="M26 10.5h2.2l-2.2 2.4h2.2" />
    </Art>
  );
}

/** A lens over an empty cell: looked, found nothing. */
function BeeArtSearch({ className }: ArtProps) {
  return (
    <Art className={className}>
      <circle cx="13" cy="13" r="7.5" />
      <path d="M18.5 18.5L26 26" />
      <path d="M13 9.8L15.77 11.4V14.6L13 16.2L10.23 14.6V11.4Z" />
    </Art>
  );
}

function BeeArtDrop({ className }: ArtProps) {
  return (
    <Art className={className}>
      <path d="M16 4C13 9 8 14 8 19.5a8 8 0 0 0 16 0C24 14 19 9 16 4Z" />
      <path d="M11.8 20a4.2 4.2 0 0 0 3.2 4.2" />
    </Art>
  );
}

/** A bee that took the long way round. */
function BeeArtLoop({ className }: ArtProps) {
  return (
    <Art className={className}>
      <path d="M4 26C9 29.5 15 22.5 11.5 19.5C8 16.5 7 25 15 22C18.5 20.5 18.5 17 19.5 15" {...DOTTED} />
      <Bee x={23} y={12} />
    </Art>
  );
}

/**
 * Which drawings each state picks from: `busy` while something loads,
 * `empty` for a list or part with nothing in it, `lost` for something
 * that isn't there.
 */
const BEE_ART = {
  busy: [BeeArtBee, BeeArtHoneycomb, BeeArtHive, BeeArtFlower, BeeArtJar, BeeArtTrio, BeeArtDrop, BeeArtLoop],
  empty: [BeeArtSleeping, BeeArtHive, BeeArtFlower, BeeArtHoneycomb, BeeArtJar, BeeArtDrop],
  lost: [BeeArtSearch, BeeArtSleeping, BeeArtLoop, BeeArtHive, BeeArtBee],
} as const satisfies Record<string, ReadonlyArray<Drawing>>;

/**
 * What a quip says, and the drawing that goes with it, first match wins:
 * so "Searched the whole hive" is the lens, not the hive, and "Waking the
 * bees" the bee asleep. A new quip pairs itself by its words.
 */
const ART_WORDS: ReadonlyArray<readonly [RegExp, Drawing]> = [
  [/search|find|check|look|sniff|empty-handed|know/i, BeeArtSearch],
  [/wak|sleep|nap|wings off|feet up|relax|quiet/i, BeeArtSleeping],
  [/\bdrop\b/i, BeeArtDrop],
  [/honey|jar|shelf|stock/i, BeeArtJar],
  [/flower|pollen/i, BeeArtFlower],
  [/comb|cell/i, BeeArtHoneycomb],
  [/fl(y|ew|ap|ight|own)|speed|wander|stray/i, BeeArtLoop],
  [/\bbees\b|everyone|whole/i, BeeArtTrio],
  [/hive/i, BeeArtHive],
];
