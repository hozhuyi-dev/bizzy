import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { CalendarIcon, ChevronDownIcon, CircleUserIcon, LogOutIcon, MenuIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { NavSheet } from "../nav-sheet/nav-sheet.component";
import type { Module } from "~/core/navigation/navigation.types";
import { MODULES } from "~/core/navigation/navigation.constant";
import { moduleOf, pageOf } from "~/core/navigation/navigation.util";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { BeeMark, Logo, Wordmark } from "~/components/shared/layout/logo/logo.component";
import { PageHeaderTitleSlot } from "~/components/shared/layout/page-header/page-header-slots.component";
import { useCompactLayout } from "~/components/shared/layout/page-header/page-header.hook";
import { AuthMutation } from "~/features/auth/auth.mutation";
import { SyncButton } from "~/features/sync/components/sync-button/sync-button.component";
import { useSyncNow } from "~/features/sync/components/sync-button/sync-button.hook";
import { CalendarGuideDialog } from "~/features/sync/components/calendar-guide-dialog/calendar-guide-dialog.component";

// One line always: "Follow-ups" would otherwise break at its hyphen as the bar fills.
const MODULE_LINK =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * From lg: the logo, the modules inline, the sync and the account menu. A
 * module with several pages opens a menu of them on click (never hover, so a
 * touch screen works the same); the page header then reads "Module › Page".
 * Inline they take about 56rem with the logo and the icons, more than md has.
 *
 * Below lg the bar never scrolls sideways or wraps: one ☰ at the right edge,
 * in a thumb's reach, opens a sheet with the modules, the sync and the
 * account's; a failed sync marks it, so it still shows on every page. On a
 * phone the page's title takes the name's place after the bee (PageHeader
 * puts it in PageHeaderTitleSlot), so it starts in one place on every page;
 * the way back is in the dock. The name shows while no page header is up.
 */
export function NavBar() {
  const { pathname } = useLocation();
  const signOut = AuthMutation.useSignOut();
  const current = moduleOf(pathname);
  const compact = useCompactLayout();
  const sync = useSyncNow();
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    // --nav-height (app.css) is this bar's height: PageHeader sticks right below it.
    <header className="sticky top-0 z-(--z-nav) h-(--nav-height) border-b bg-background">
      <nav className="mx-auto flex h-full max-w-(--content-width) items-center gap-1 px-(--page-gutter)">
        {compact ? (
          <>
            {/* The bee is always home; the title starts in one place after it on every page. */}
            <Link
              to="/"
              aria-label="Home"
              className="-ml-1.5 flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <BeeMark className="size-9" />
            </Link>
            <PageHeaderTitleSlot className="peer flex min-w-0 flex-1 flex-col justify-center empty:hidden" />
            <Wordmark className="hidden peer-empty:inline" />
          </>
        ) : (
          <HomeLink className="mr-3 flex" />
        )}

        <div className="hidden items-center gap-1 lg:flex">
          {MODULES.map((module) => (
            <ModuleLink key={module.label} module={module} active={current === module} pathname={pathname} />
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-1 lg:flex">
            <SyncButton />
            <AccountMenu
              settingsActive={pathname.startsWith("/settings")}
              onCalendarGuide={() => setGuideOpen(true)}
              onSignOut={() => signOut.mutate()}
            />
          </div>
          {/* A thumb's size in a phone's taller bar. */}
          <Button
            variant="ghost"
            size="icon-lg"
            className="relative -mr-2 max-md:-mr-2.5 max-md:size-11 lg:hidden"
            aria-label={sync?.failed ? "Menu. The last calendar sync failed" : "Menu"}
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon className="size-4 max-md:size-6" />
            {sync?.failed && (
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-destructive max-md:top-2 max-md:right-1.5 max-md:size-2" />
            )}
          </Button>
        </div>
      </nav>
      <NavSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        sync={sync}
        onCalendarGuide={() => setGuideOpen(true)}
        onSignOut={() => signOut.mutate()}
      />
      <CalendarGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </header>
  );
}

/** The logo, home. Flex, not inline: an inline link sets the logo on a text line, which lifts it above the links. */
function HomeLink({ className }: { className: string }) {
  return (
    <Link to="/" className={cn("rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      <Logo />
    </Link>
  );
}

interface AccountMenuProps {
  settingsActive: boolean;
  onCalendarGuide: () => void;
  onSignOut: () => void;
}

/** Settings, the calendar guide and Sign out, behind the account icon on a wide bar. */
function AccountMenu({ settingsActive, onCalendarGuide, onSignOut }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Account" className={settingsActive ? "bg-muted" : undefined} />}
      >
        <CircleUserIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          render={<Link to="/settings" />}
          aria-current={settingsActive ? "page" : undefined}
          className={settingsActive ? "bg-muted font-medium" : undefined}
        >
          <SettingsIcon /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCalendarGuide}>
          <CalendarIcon /> Calendar guide
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A module in the bar: a link, or a menu of its pages. */
function ModuleLink({ module, active, pathname }: { module: Module; active: boolean; pathname: string }) {
  const [only] = module.pages;
  const className = cn(MODULE_LINK, active && "bg-muted text-foreground");

  if (module.pages.length === 1 && only) {
    return (
      <Link to={only.to} aria-current={active ? "page" : undefined} className={className}>
        {module.label}
      </Link>
    );
  }

  const current = active ? pageOf(module, pathname) : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(className, "cursor-pointer")}>
        {module.label}
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {module.pages.map((page) => (
          <DropdownMenuItem
            key={page.to}
            render={<Link to={page.to} />}
            aria-current={page === current ? "page" : undefined}
            className={page === current ? "bg-muted font-medium" : undefined}
          >
            {page.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
