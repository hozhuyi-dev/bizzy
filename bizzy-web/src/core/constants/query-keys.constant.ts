export const AuthKeys = {
  all: ["auth"] as const,
  state: () => [...AuthKeys.all, "state"] as const,
};

export const ClientKeys = {
  all: ["clients"] as const,
  list: () => [...ClientKeys.all, "list"] as const,
};

export const SessionKeys = {
  all: ["sessions"] as const,
  range: (from: string, to: string) => [...SessionKeys.all, "range", from, to] as const,
  search: (request: object) => [...SessionKeys.all, "search", request] as const,
  detail: (id: string) => [...SessionKeys.all, "detail", id] as const,
  preview: (request: object) => [...SessionKeys.all, "preview", request] as const,
  movable: (packageId: string) => [...SessionKeys.all, "movable", packageId] as const,
};

export const ActivityKeys = {
  all: ["activity"] as const,
  list: () => [...ActivityKeys.all, "list"] as const,
};

export const ConflictKeys = {
  all: ["conflicts"] as const,
};

export const FollowUpKeys = {
  all: ["followUps"] as const,
  search: (request: object) => [...FollowUpKeys.all, "search", request] as const,
  detail: (id: string) => [...FollowUpKeys.all, "detail", id] as const,
};

export const TimelineKeys = {
  all: ["timeline"] as const,
  search: (request: object) => [...TimelineKeys.all, "search", request] as const,
};

export const TodoKeys = {
  all: ["todo"] as const,
  list: () => [...TodoKeys.all, "list"] as const,
};

export const PackageKeys = {
  all: ["packages"] as const,
  list: (all: boolean) => [...PackageKeys.all, "list", { all }] as const,
};

export const DocumentKeys = {
  all: ["documents"] as const,
  search: (request: object) => [...DocumentKeys.all, "search", request] as const,
  detail: (id: string) => [...DocumentKeys.all, "detail", id] as const,
  client: (clientId: string) => [...DocumentKeys.all, "client", clientId] as const,
  shared: (token: string) => [...DocumentKeys.all, "shared", token] as const,
  /** Keyed by status too: cancelling stamps it. */
  pdf: (id: string, revision: number | undefined, status: string) =>
    [...DocumentKeys.all, "pdf", id, revision, status] as const,
};

export const AttachmentKeys = {
  all: ["attachments"] as const,
  owner: (ownerKind: string, ownerId: string) => [...AttachmentKeys.all, ownerKind, ownerId] as const,
};

export const ExpenseKeys = {
  all: ["expenses"] as const,
  search: (request: object) => [...ExpenseKeys.all, "search", request] as const,
  detail: (id: string) => [...ExpenseKeys.all, "detail", id] as const,
};

/** What the expense form suggests: categories, items and vendors. Apart from ExpenseKeys, so a receipt's file doesn't read it again. */
export const CatalogueKeys = {
  all: ["catalogue"] as const,
};

/** A year of the business at a glance (insights.year). */
export const InsightKeys = {
  all: ["insights"] as const,
  year: (year: number) => [...InsightKeys.all, year] as const,
};

export const SettingsKeys = {
  all: ["settings"] as const,
};

export const SyncKeys = {
  all: ["sync"] as const,
  run: () => [...SyncKeys.all, "run"] as const,
  backfill: () => [...SyncKeys.all, "backfill"] as const,
};

export const GoogleKeys = {
  all: ["google"] as const,
  calendars: () => [...GoogleKeys.all, "calendars"] as const,
};

export const ContactKeys = {
  all: ["contacts"] as const,
  list: () => [...ContactKeys.all, "list"] as const,
  detail: (resourceName: string) => [...ContactKeys.all, "detail", resourceName] as const,
};

/** What every page shows around it: Google, Settings' gaps and the last sync, in one call (app.status). */
export const AppKeys = {
  all: ["app"] as const,
  status: () => [...AppKeys.all, "status"] as const,
};

/**
 * What shows a session's money and stage: its client, fee line, receipt,
 * package and follow-ups all show in these, so a change to any of them
 * reads them all again.
 */
const BILLING = [
  TodoKeys.all,
  SessionKeys.all,
  ConflictKeys.all,
  FollowUpKeys.all,
  PackageKeys.all,
  ClientKeys.all,
  ActivityKeys.all,
  DocumentKeys.all,
  TimelineKeys.all,
  InsightKeys.all,
] as const;

/**
 * What shows what the time makes of an item, not only what is stored: a
 * session past its start, a follow-up due, a package expiring, the to-do
 * list. Read again now and then while the app is open (see
 * useStayCurrent), as no call says the clock moved.
 */
export const CLOCK_KEYS = [
  TodoKeys.all,
  SessionKeys.all,
  FollowUpKeys.all,
  PackageKeys.all,
  TimelineKeys.all,
  ActivityKeys.all,
] as const;

/**
 * The queries that show each kind of item the API stores (its partition,
 * as a response's `changed` names it), read again when a call changes one.
 * A kind not here reads everything again.
 */
export const CHANGED_KEYS: Readonly<Record<string, ReadonlyArray<ReadonlyArray<unknown>>>> = {
  CLIENT: [...BILLING, ContactKeys.all],
  SESSION: BILLING,
  SESSIONNOTES: [SessionKeys.all, TimelineKeys.all],
  PACKAGE: BILLING,
  DOC: BILLING,
  DOCLINK: BILLING,
  DOCREV: [DocumentKeys.all],
  DOCSHARE: [DocumentKeys.all],
  DOCNUMBER: [DocumentKeys.all],
  FOLLOWUP: [FollowUpKeys.all, TodoKeys.all, TimelineKeys.all, SessionKeys.all, ClientKeys.all, ActivityKeys.all],
  CONFLICT: [ConflictKeys.all, TodoKeys.all, SessionKeys.all],
  ATTACHMENT: [AttachmentKeys.all, SessionKeys.all, TimelineKeys.all, ExpenseKeys.all],
  EXPENSE: [ExpenseKeys.all, InsightKeys.all],
  EXPENSEITEM: [CatalogueKeys.all],
  EXPENSEVENDOR: [CatalogueKeys.all],
  EXPENSECATEGORIES: [CatalogueKeys.all],
  SETTINGS: [SettingsKeys.all, AppKeys.all, TodoKeys.all, SessionKeys.all, DocumentKeys.all],
  SYNC: [AppKeys.all],
  GOOGLE: [AppKeys.all, GoogleKeys.all],
  // Which event shows which item: no page shows it.
  EVENTLINK: [],
};
