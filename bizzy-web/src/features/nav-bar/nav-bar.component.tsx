import { Link, useMatchRoute } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Logo } from "~/components/shared/logo/logo.component";
import { AmplifyService } from "~/features/auth/amplify.service";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/sessions", label: "Sessions" },
  { to: "/clients", label: "Clients" },
  { to: "/packages", label: "Packages" },
  { to: "/receipts", label: "Receipts" },
  { to: "/insights", label: "Insights" },
  { to: "/settings", label: "Settings" },
] as const;

/**
 * Pages sit in a menu behind the hamburger on a phone and inline on wider
 * screens, so the bar never scrolls sideways.
 */
export function NavBar() {
  const matchRoute = useMatchRoute();
  const isActive = (to: (typeof LINKS)[number]["to"]) =>
    Boolean(matchRoute({ to, fuzzy: to !== "/" }));

  return (
    // h-12: PageHeader sticks right below it at top-12.
    <header className="sticky top-0 z-30 h-12 border-b bg-background">
      <nav className="mx-auto flex h-full max-w-7xl items-center gap-1 px-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" className="-ml-1.5 md:hidden" aria-label="Menu" />}
          >
            <MenuIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {LINKS.map((link) => (
              <DropdownMenuItem
                key={link.to}
                render={<Link to={link.to} />}
                className={isActive(link.to) ? "bg-muted font-medium" : undefined}
              >
                {link.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Flex, not inline: an inline link sets the logo on a text line, which lifts it above the links. */}
        <Link to="/" className="mr-3 flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              activeProps={{ className: "bg-muted text-foreground" }}
              activeOptions={{ exact: link.to === "/" }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <Button
          className="ml-auto"
          variant="ghost"
          size="sm"
          onClick={() => void AmplifyService.signOut()}
        >
          Sign out
        </Button>
      </nav>
    </header>
  );
}
