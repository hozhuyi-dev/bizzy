import { createFileRoute, redirect } from "@tanstack/react-router";
import { LAPSE_MONTHS } from "~/features/clients/clients.constant";
import { oneOf } from "~/core/utils/url-param.util";

/** Reconnect is the clients list's preset now; an old link lands there, with its lapse. */
export const Route = createFileRoute("/clients/reconnect")({
  beforeLoad: ({ search }) => {
    // Numbers in the URL parse as numbers.
    const lapse = oneOf(String((search as Record<string, unknown>).lapse), LAPSE_MONTHS) ?? LAPSE_MONTHS[0];
    throw redirect({ to: "/clients", search: { lapse: [lapse], sort: "-lifetimeCents" }, replace: true });
  },
});
