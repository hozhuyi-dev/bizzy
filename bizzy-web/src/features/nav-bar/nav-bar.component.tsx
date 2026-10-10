import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { AmplifyService } from "~/features/auth/amplify.service";

const LINKS = [
  { to: "/", label: "Sessions" },
  { to: "/clients", label: "Clients" },
] as const;

export function NavBar() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2">
        <span className="mr-3 font-semibold">Bizzy</span>
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            activeProps={{ className: "bg-muted text-foreground" }}
            activeOptions={{ exact: true }}
          >
            {link.label}
          </Link>
        ))}
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
