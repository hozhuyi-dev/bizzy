import { clientsListFilter, clientsListLink, clientsListSearch, matchesChips, toClientRow, withLapse } from "./clients.util";
import type { ClientView } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";
import { NO_FILTER } from "~/core/list/filter.util";

const yes = { ok: true };
const client: ClientView = {
  id: "c",
  name: "Jane",
  aliases: [],
  feeRates: [],
  homeVisits: false,
  can: { archive: yes, unarchive: { ok: false }, delete: yes },
};
const activity: ActivityView = { clientId: "c", months: {}, owedCents: 9000, lapsedMonths: 6 };
const row = toClientRow(client, activity);

describe("clients list chips", () => {
  test("Reconnect keeps those lapsed at least that long", () => {
    expect(matchesChips(row, { lapse: ["3"] })).toBe(true);
    expect(matchesChips(row, { lapse: ["6"] })).toBe(true);
    expect(matchesChips(row, { lapse: ["12"] })).toBe(false);
    expect(matchesChips(toClientRow(client, undefined), { lapse: ["3"] })).toBe(false);
  });

  test("All clients' chips each narrow, together", () => {
    expect(matchesChips(row, { owes: ["yes"] })).toBe(true);
    expect(matchesChips(row, { owes: ["yes"], credits: ["yes"] })).toBe(false);
    expect(matchesChips(row, { booked: ["no"] })).toBe(true);
    expect(matchesChips(row, { booked: ["yes"] })).toBe(false);
    expect(matchesChips(row, { followUp: ["yes"] })).toBe(false);
  });

  test("archived clients show only under their chip", () => {
    const archived = toClientRow({ ...client, archivedAt: "2026-10-01T00:00:00Z" }, activity);
    expect(matchesChips(archived, {})).toBe(false);
    expect(matchesChips(archived, { archived: ["yes"] })).toBe(true);
    expect(matchesChips(row, { archived: ["yes"] })).toBe(false);
  });

  test("Reconnect keeps a lapse when its chip comes off", () => {
    expect(withLapse(NO_FILTER).chips.lapse).toEqual(["3"]);
    expect(withLapse({ ...NO_FILTER, chips: { lapse: ["12"] } }).chips.lapse).toEqual(["12"]);
  });

  test("a filter goes to its own list, and back from a client's page", () => {
    const owing = { ...NO_FILTER, text: "jane", chips: { owes: ["yes"] } };
    expect(clientsListLink(owing)).toMatchObject({ to: "/clients", search: { q: "jane", owes: ["yes"] } });
    expect(clientsListLink(withLapse(NO_FILTER))).toMatchObject({ to: "/clients/reconnect", search: { lapse: undefined } });
    expect(clientsListFilter(clientsListSearch(owing))).toEqual(owing);
  });
});
