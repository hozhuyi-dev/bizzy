/**
 * A section list's mark under the link being read, on a phone; wider, the
 * list is a rail and marks it there instead. One spec for every such list
 * (PageSections's contents, a session's steps), so they read as one. Goes
 * in a `group relative` link that stretches to the row's bottom border.
 */
export const SECTION_UNDERLINE =
  "absolute inset-x-0 bottom-0 mx-auto hidden h-0.5 w-8 rounded-full bg-foreground group-aria-[current]:block md:group-aria-[current]:hidden";
