import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";

/**
 * A page that broke while showing (the router's error boundary), shaped
 * like the not-found page: trying again reloads it, and the details have
 * where it broke, for the developer.
 */
export function ErrorPage({ error }: { error: unknown }) {
  return (
    <ErrorState
      error={error}
      size="page"
      title="Something went wrong"
      back={{ label: "Back to Home", link: { to: "/" } }}
    />
  );
}
