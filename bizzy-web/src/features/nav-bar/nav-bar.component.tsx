import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronDownIcon, MenuIcon, SettingsIcon } from "lucide-react";
import { MODULES, moduleOf, pageOf } from "./modules";
import type { Module } from "./modules";
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
import { Logo } from "~/components/shared/logo/logo.component";
import { AmplifyService } from "~/features/auth/amplify.service";
import { SyncButton } from "~/features/sync/sync-button.component";

const MODULE_LINK =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The modules, inline on wider screens and in a menu behind the hamburger on
 * a phone, so the bar never scrolls sideways. A module with several pages
 * opens a menu of them on click (never hover, so a touch screen works the
 * same); the page header then reads "Module › Page".
 */
export function NavBar() {
  const { pathname } = useLocation();
  const current = moduleOf(pathname);
  const settingsActive = pathname.startsWith("/settings");

  return (
    // --nav-height (app.css) is this bar's height: PageHeader sticks right below it.
    <header className="sticky top-0 z-30 h-(--nav-height) border-b bg-background">
      <nav className="mx-auto flex h-full max-w-7xl items-center gap-1 px-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" className="-ml-1.5 md:hidden" aria-label="Menu" />}
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
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/settings" />} className={settingsActive ? "bg-muted font-medium" : undefined}>
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Flex, not inline: an inline link sets the logo on a text line, which lifts it above the links. */}
        <Link to="/" className="mr-3 flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {MODULES.map((module) => (
            <ModuleLink key={module.label} module={module} active={current === module} pathname={pathname} />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <SyncButton />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            className={cn("hidden md:inline-flex", settingsActive && "bg-muted")}
            render={<Link to="/settings" />}
            nativeButton={false}
          >
            <SettingsIcon />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void AmplifyService.signOut()}>
            Sign out
          </Button>
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
