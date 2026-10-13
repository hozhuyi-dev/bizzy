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
  detail: (eventId: string) => [...SessionKeys.all, "detail", eventId] as const,
  client: (clientId: string) => [...SessionKeys.all, "client", clientId] as const,
  removed: () => [...SessionKeys.all, "removed"] as const,
};

export const FollowUpKeys = {
  all: ["followUps"] as const,
  list: (view: string) => [...FollowUpKeys.all, "list", view] as const,
  client: (clientId: string) => [...FollowUpKeys.all, "client", clientId] as const,
  session: (sessionId: string) => [...FollowUpKeys.all, "session", sessionId] as const,
};

export const TodoKeys = {
  all: ["todo"] as const,
  list: () => [...TodoKeys.all, "list"] as const,
};

export const PackageKeys = {
  all: ["packages"] as const,
  list: (all: boolean) => [...PackageKeys.all, "list", { all }] as const,
};

export const BillingKeys = {
  all: ["billing"] as const,
  preview: (input: object) => [...BillingKeys.all, "preview", input] as const,
};

export const DocumentKeys = {
  all: ["documents"] as const,
  list: (type: string, month: string) => [...DocumentKeys.all, "list", type, month] as const,
  detail: (id: string) => [...DocumentKeys.all, "detail", id] as const,
  client: (clientId: string) => [...DocumentKeys.all, "client", clientId] as const,
  shared: (token: string) => [...DocumentKeys.all, "shared", token] as const,
};

export const SettingsKeys = {
  all: ["settings"] as const,
};

export const SyncKeys = {
  all: ["sync"] as const,
  status: () => [...SyncKeys.all, "status"] as const,
  run: () => [...SyncKeys.all, "run"] as const,
};

export const GoogleKeys = {
  all: ["google"] as const,
  status: () => [...GoogleKeys.all, "status"] as const,
  calendars: () => [...GoogleKeys.all, "calendars"] as const,
};

export const ContactKeys = {
  all: ["contacts"] as const,
  list: () => [...ContactKeys.all, "list"] as const,
  detail: (resourceName: string) => [...ContactKeys.all, "detail", resourceName] as const,
};

/**
 * Everything derived from sessions: a sync, a client save or a receipt can
 * change any of these, so they are refreshed together.
 */
export const BILLING_KEYS = [
  TodoKeys.all,
  SessionKeys.all,
  FollowUpKeys.all,
  PackageKeys.all,
  BillingKeys.all,
  ClientKeys.all,
  DocumentKeys.all,
  SyncKeys.all,
] as const;
