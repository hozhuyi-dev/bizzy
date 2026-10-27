import { clientsListLink, clientsUrl, matchesChips, missingDetails, toClientRow } from "./clients.util";
import type { ClientView } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";

const yes = { ok: true };
const client: ClientView = {
  id: "c",
  name: "Jane",
  aliases: [],
  sharesWith: [],
  homeVisits: false,
  can: { archive: yes, unarchive: { ok: false }, delete: yes },
};
const activity: ActivityView = { clientId: "c", months: {}, owedCents: 9000, lapsedMonths: 6 };
const row = toClientRow(client, activity);

describe("clients list chips", () => {
  test("lapsed keeps those not seen at least that long", () => {
    expect(matchesChips(row, { lapse: ["3"] })).toBe(true);
    expect(matchesChips(row, { lapse: ["6"] })).toBe(true);
    expect(matchesChips(row, { lapse: ["12"] })).toBe(false);
    expect(matchesChips(toClientRow(client, undefined), { lapse: ["3"] })).toBe(false);
  });

  test("each chip narrows, together, lapsed too", () => {
    expect(matchesChips(row, { owes: ["yes"] })).toBe(true);
    expect(matchesChips(row, { owes: ["yes"], lapse: ["6"] })).toBe(true);
    expect(matchesChips(row, { owes: ["yes"], credits: ["yes"] })).toBe(false);
    expect(matchesChips(row, { booked: ["no"] })).toBe(true);
    expect(matchesChips(row, { booked: ["yes"] })).toBe(false);
    expect(matchesChips(row, { followUp: ["yes"] })).toBe(false);
    expect(matchesChips(row, { homeVisits: ["yes"] })).toBe(false);
  });

  test("missing details: any one chosen", () => {
    expect(missingDetails(client)).toEqual(["phone", "idNo", "contact"]);
    const withPhone = { ...client, idNo: "900101-14-5555", contact: { phone: "+60123456789" } } as ClientView;
    expect(matchesChips(toClientRow(withPhone, activity), { missing: ["phone", "idNo"] })).toBe(false);
    expect(matchesChips(toClientRow({ ...withPhone, idNo: "" }, activity), { missing: ["phone", "idNo"] })).toBe(true);
  });

  test("archived clients show only under their chip", () => {
    const archived = toClientRow({ ...client, archivedAt: "2026-10-01T00:00:00Z" }, activity);
    expect(matchesChips(archived, {})).toBe(false);
    expect(matchesChips(archived, { archived: ["yes"] })).toBe(true);
    expect(matchesChips(row, { archived: ["yes"] })).toBe(false);
  });

  test("a filter goes to the list, and back from a client's page", () => {
    const owing = { text: "jane", when: undefined, chips: { owes: ["yes"], lapse: ["6"] } };
    expect(clientsListLink(owing)).toMatchObject({ to: "/clients", search: { q: "jane", owes: ["yes"], lapse: ["6"] } });
    const back = clientsUrl.toFilter(clientsUrl.validate({ q: "jane", owes: "yes", lapse: 6 }));
    expect(back.chips).toMatchObject({ owes: ["yes"], lapse: ["6"] });
  });
});
