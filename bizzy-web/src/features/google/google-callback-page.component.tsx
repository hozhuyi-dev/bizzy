import { useFinishGoogleConsent } from "./google.hook";
import type { GoogleCallbackSearch } from "./google.types";

/** Where Google sends her back from the consent screen (see google-oauth.service). */
export function GoogleCallbackPage(search: GoogleCallbackSearch) {
  useFinishGoogleConsent(search);
  return <p className="p-4 text-sm text-muted-foreground">Connecting Google…</p>;
}
