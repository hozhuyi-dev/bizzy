import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { CalendarIcon, ChevronDownIcon, CircleUserIcon, LogOutIcon, MenuIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import type { Module } from "~/core/navigation/navigation.types";
import { MODULES } from "~/core/navigation/navigation.constant";
import { moduleOf, pageOf } from "~/core/navigation/navigation.util";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Logo } from "~/components/shared/layout/logo/logo.component";
import { AuthMutation } from "~/features/auth/auth.mutation";
import { SyncButton } from "~/features/sync/components/sync-button/sync-button.component";
import { CalendarGuideDialog } from "~/features/sync/components/calendar-guide-dialog/calendar-guide-dialog.component";

// One line always: "Follow-ups" would otherwise break at its hyphen as the bar fills.
const MODULE_LINK =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The modules, inline from lg and in a menu behind the hamburger below it,
 * so the bar never scrolls sideways or wraps: inline they take about 56rem
 * with the logo and the icons, more than md has. Settings, the calendar
 * guide and Sign out are in the account menu at every width, and the sync's words show from xl
 * only, kept to a width, so a long one never pushes the bar. A module with several pages
 * opens a menu of them on click (never hover, so a touch screen works the
 * same); the page header then reads "Module › Page".
 */
export function NavBar() {
  const { pathname } = useLocation();
  const signOut = AuthMutation.useSignOut();
  const current = moduleOf(pathname);
  const settingsActive = pathname.startsWith("/settings");
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    // --nav-height (app.css) is this bar's height: PageHeader sticks right below it.
    <header className="sticky top-0 z-(--z-nav) h-(--nav-height) border-b bg-background">
      <nav className="mx-auto flex h-full max-w-(--content-width) items-center gap-1 px-(--page-gutter)">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="-ml-1.5 lg:hidden" aria-label="Menu" />}
          >
            <MenuIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[80dvh] w-52 overflow-y-auto">
            {MODULES.map((module, i) => (
              <DropdownMenuGroup key={module.label}>
                {i > 0 && <DropdownMenuSeparator />}
                {module.pages.length > 1 && <DropdownMenuLabel>{module.label}</DropdownMenuLabel>}
                {module.pages.map((page) => (
                  <DropdownMenuItem
                    key={page.to}
                    render={<Link to={page.to} />}
                    className={cn(
                      module.pages.length > 1 && "pl-4",
                      current === module && pageOf(module, pathname) === page && "bg-muted font-medium",
                    )}
                  >
                    {module.pages.length > 1 ? page.label : module.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Flex, not inline: an inline link sets the logo on a text line, which lifts it above the links. */}
        <Link to="/" className="mr-3 flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {MODULES.map((module) => (
            <ModuleLink key={module.label} module={module} active={current === module} pathname={pathname} />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <SyncButton />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Account" className={settingsActive ? "bg-muted" : undefined} />
              }
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
              <DropdownMenuItem onClick={() => setGuideOpen(true)}>
                <CalendarIcon /> Calendar guide
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut.mutate()}>
                <LogOutIcon /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <CalendarGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
        </div>
      </nav>
    </header>
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
