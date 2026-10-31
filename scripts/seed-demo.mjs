#!/usr/bin/env node
// Fills development with made-up data for screenshots and demos, through
// the deployed api Lambda, so every rule applies as in the app:
//
//   node scripts/seed-demo.mjs
//
// It resets the data first (data.reset), then adds the business's details,
// a Google contact and a client for each person (all @example.com), two
// packages, about 20 sessions around today (written to the chosen calendar),
// payments, issued documents, a follow-up and expenses. Dates are relative
// to today, so a seed run before a shoot always looks current. Each call is
// one AWS CLI run and many write the calendar, so it takes several minutes.
// Only development or staging; see aws.mjs for the environment and
// credentials.

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aws, environment, projectName } from "./aws.mjs";

if (environment !== "development" && environment !== "staging") {
  console.error(`Only development or staging can be seeded, not ${environment}.`);
  process.exit(1);
}

const functionName = `${projectName}-${environment}-api`;
const out = join(tmpdir(), `${functionName}-seed.json`);
const failures = [];

/** Calls an action as the app does; a refusal is logged and returns null. */
function call(action, payload = {}) {
  aws([
    "lambda",
    "invoke",
    "--function-name",
    functionName,
    "--cli-binary-format",
    "raw-in-base64-out",
    "--payload",
    JSON.stringify({ action, payload }),
    out,
  ]);
  const res = JSON.parse(readFileSync(out, "utf8"));
  if (res.error) {
    const remedies = (res.error.remedies ?? []).map((r) => r.label ?? JSON.stringify(r)).join("; ");
    failures.push(`${action}: ${res.error.message}${remedies ? ` (${remedies})` : ""}`);
    console.error(`  ✗ ${action}: ${res.error.message}`);
    return null;
  }
  return res.data ?? {};
}

/** The first value under key anywhere in v, for views that nest it. */
function find(v, key) {
  if (!v || typeof v !== "object") return undefined;
  if (key in v && v[key]) return v[key];
  for (const child of Object.values(v)) {
    const found = find(child, key);
    if (found) return found;
  }
  return undefined;
}

// Kuala Lumpur has no daylight saving: +08:00 all year.
const todayKL = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const day = (offset) => {
  const d = new Date(`${todayKL}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset, time) => `${day(offset)}T${time}:00+08:00`;
const plusHours = (iso, hours) => new Date(new Date(iso).getTime() + hours * 3600 * 1000).toISOString();

console.log(`Seeding ${functionName} around ${todayKL}`);

console.log("Resetting");
call("data.reset");

console.log("Business details");
const settings = call("settings.get");
call("settings.save", {
  ...settings,
  businessName: "Physio Co",
  registrationNo: "202401234567 (1234567-X)",
  address: "Unit 3-2, Jalan Contoh 1, 47301 Petaling Jaya, Selangor",
  email: "hello@example.com",
  phone: "+60 12-345 6789",
  bankName: "Maybank",
  accountName: "Physio Co",
  accountNo: "5140 0000 1234",
  // The made-up QR of settings/duitnow_test.go (sampleQR).
  duitNowQr: "00020101021126490014A000000615000101068900530210000012345605030005204809953034585802MY5909PHYSIO CO6012KUALA LUMPUR6304319E",
  payPhone: "+60 12-345 6789",
  payApps: ["duitnow", "tng", "grabpay"],
});

console.log("Clients");
const people = [
  { key: "jane", given: "Jane", family: "Tan", fee: 12000 },
  { key: "ahmad", given: "Ahmad Faiz", family: "Ismail", fee: 15000, homeVisits: true, street: "12 Jalan Contoh 3, Taman Contoh", city: "Petaling Jaya", postcode: "47300" },
  { key: "priya", given: "Priya", family: "Nair", fee: 11000 },
  { key: "lily", given: "Lily", family: "Tan", fee: 11000 },
  { key: "adam", given: "Adam", family: "Tan", fee: 11000, family_of: "lily" },
  { key: "wong", given: "Kar Mun", family: "Wong", fee: 12000 },
  { key: "nurul", given: "Nurul", family: "Aina", fee: 12000 },
  { key: "daniel", given: "Daniel", family: "Lim", fee: 13000 },
];
// A reset leaves Google's contacts be, so a rerun links the ones made before.
const contacts = call("contacts.list") ?? [];
const client = {};
for (const p of people) {
  const contact = contacts.find((c) => c.givenName === p.given && c.familyName === p.family) ?? call("contacts.create", {
    givenName: p.given,
    familyName: p.family,
    email: `${p.given.split(" ")[0].toLowerCase()}.${p.family.toLowerCase()}@example.com`,
    phone: "",
    address: p.street ? { street: p.street, city: p.city, postcode: p.postcode, region: "Selangor" } : {},
  });
  if (!contact) continue;
  const fields = {
    name: `${p.given} ${p.family}`,
    contact: { resourceName: contact.resourceName },
    fee: { cents: p.fee },
    homeVisits: Boolean(p.homeVisits),
  };
  if (p.family_of) {
    fields.sharesWith = [client[p.family_of]];
    fields.billTo = client[p.family_of];
  }
  const c = call("clients.create", fields);
  if (c) client[p.key] = c.id;
  console.log(`  ${fields.name}`);
}

// The calendar keeps the last seed's events, which a sync makes sessions
// and follow-ups again once their clients are back. Deleting those deletes
// their events, so the calendar holds only what this seed writes.
console.log("Clearing the last seed's events");
call("sync.run");
const synced = call("sessions.list", { from: at(-190, "00:00"), to: at(190, "00:00") }) ?? [];
for (const s of synced) call("sessions.delete", { id: s.id });
const followUps = call("followUps.search", { statuses: ["open", "overdue", "done"], limit: 200 })?.items ?? [];
for (const f of followUps) call("followUps.delete", { id: f.id });
console.log(`  deleted ${synced.length} sessions and ${followUps.length} follow-ups`);

console.log("Packages");
const priyaPackage = call("packages.create", {
  clientId: client.priya,
  hours: 10,
  priceCents: 100000,
  purchasedAt: at(-14, "09:00"),
  note: "10 sessions, back rehab",
  payment: { payment: { method: "bank_transfer", paidOn: day(-14) } },
});
const tanPackage = call("packages.create", {
  clientId: client.lily,
  hours: 10,
  priceCents: 110000,
  purchasedAt: at(-9, "09:00"),
  note: "Family package, Lily and Adam",
  sharedWith: [client.adam],
});

// [day, time, client, hours, extra]: record is the summary written after;
// paid is [method, days after]; tentative is not confirmed yet.
const schedule = [
  [-12, "10:00", "jane", 1, { record: "Neck and upper back tight from desk work. Soft tissue and mobility, desk stretches given.", paid: ["cash", 0], issue: true }],
  [-12, "14:00", "ahmad", 1, { visit: true, record: "Knee post-op week 6. Range 0–110°. Quads strengthening progressed.", paid: ["bank_transfer", 1], issue: true }],
  [-10, "09:30", "priya", 1, { record: "Lower back, pain 4/10. Core activation and hip hinge practice." }],
  [-10, "11:00", "daniel", 1, { record: "Shoulder impingement. Taping and rotator cuff band work.", invoice: true }],
  [-9, "16:00", "adam", 1, { record: "Ankle sprain from futsal. Balance and calf raises." }],
  [-8, "10:00", "nurul", 1, { record: "Plantar fasciitis. Calf release, night splint advised.", paid: ["tng", 0] }],
  [-5, "10:00", "jane", 1, { record: "Much better. Progressed to strengthening.", paid: ["cash", 0] }],
  [-5, "15:00", "wong", 1.5, {}],
  [-3, "09:30", "priya", 1, { record: "Pain 2/10. Added deadlift pattern with dowel." }],
  [-3, "17:00", "lily", 1, { record: "Frozen shoulder. Mobilisation, home pendulum exercises." }],
  [-2, "14:00", "ahmad", 1, { visit: true, record: "Range 0–120°. Started step-ups." }],
  [-1, "10:00", "daniel", 1, { paid: ["grab", 0] }],
  [0, "09:00", "jane", 1, {}],
  [0, "11:00", "adam", 1, {}],
  [2, "10:00", "priya", 1, {}],
  [2, "14:00", "nurul", 1, { tentative: true }],
  [3, "15:00", "ahmad", 1, { visit: true }],
  [4, "10:00", "wong", 1, { cancel: "Travelling for work" }],
  [4, "16:00", "lily", 1, {}],
  [5, "11:00", "jane", 1, { tentative: true }],
  [6, "09:30", "daniel", 1, {}],
];

console.log("Sessions");
const issue = new Set();
for (const [offset, time, who, hours, extra] of schedule) {
  const start = at(offset, time);
  const s = call("sessions.create", {
    clientId: client[who],
    time: { start, end: plusHours(start, hours) },
    location: extra.visit ? "visit" : "own",
    tentative: Boolean(extra.tentative),
  });
  if (!s) continue;
  console.log(`  ${day(offset)} ${time} ${who}`);
  if (extra.record) call("sessions.saveRecord", { id: s.id, summary: extra.record, notes: "" });
  if (extra.paid) {
    const [method, after] = extra.paid;
    call("payments.set", { items: [{ kind: "session", id: s.id }], payment: { method, paidOn: day(offset + after) } });
  }
  if (extra.cancel) call("sessions.cancel", { id: s.id, reason: extra.cancel });
  if (extra.issue || extra.invoice) {
    const full = call("sessions.get", { id: s.id });
    const id = extra.issue ? find(full, "paid")?.receiptId : find(full, "invoice")?.id;
    if (id) issue.add(id);
  }
}

console.log("Documents");
for (const p of call("packages.list") ?? []) {
  if (p.id === priyaPackage?.id && p.paid?.receiptId) issue.add(p.paid.receiptId);
  if (p.id === tanPackage?.id && p.invoice?.id) issue.add(p.invoice.id);
}
for (const id of issue) {
  const d = call("documents.issue", { id });
  if (d) console.log(`  issued ${find(d, "number") ?? id}`);
}

console.log("Follow-up");
call("followUps.create", {
  clientId: client.ahmad,
  when: { date: day(9) },
  summary: "Check knee range after 3 weeks of step-ups",
  notes: "",
});

console.log("Expenses");
// [day, shop, [item, category id (expenses' default categories), cents]]
const expenses = [
  [-13, "Medic Supplies", [["Kinesio tape", "purchases", 4590], ["Massage oil 1L", "purchases", 3800]]],
  [-11, "Petrol station", [["Petrol", "travel", 6000]]],
  [-7, "Online store", [["Resistance bands set", "equipment", 8900]]],
  [-4, "Print shop", [["Business cards", "promotion", 5500]]],
  [-2, "Medic Supplies", [["Kinesio tape", "purchases", 4590], ["Disposable towels", "purchases", 2450]]],
  [-1, "Telco", [["Mobile plan", "other", 6800]]],
];
for (const [offset, vendor, lines] of expenses) {
  call("expenses.create", {
    date: day(offset),
    vendor,
    notes: "",
    lines: lines.map(([name, categoryId, amountCents]) => ({ name, categoryId, amountCents })),
  });
}

if (failures.length) {
  console.error(`\nDone, with ${failures.length} refused:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nDone.");
