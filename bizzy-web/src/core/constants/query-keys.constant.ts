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
  detail: (id: string) => [...SessionKeys.all, "detail", id] as const,
  client: (clientId: string) => [...SessionKeys.all, "client", clientId] as const,
  preview: (request: object) => [...SessionKeys.all, "preview", request] as const,
};

export const ActivityKeys = {
  all: ["activity"] as const,
  list: () => [...ActivityKeys.all, "list"] as const,
};

export const ConflictKeys = {
  all: ["conflicts"] as const,
  target: (targetId: string) => [...ConflictKeys.all, "target", targetId] as const,
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

export const DocumentKeys = {
  all: ["documents"] as const,
  list: (type: string, month: string) => [...DocumentKeys.all, "list", type, month] as const,
  detail: (id: string) => [...DocumentKeys.all, "detail", id] as const,
  client: (clientId: string) => [...DocumentKeys.all, "client", clientId] as const,
  shared: (token: string) => [...DocumentKeys.all, "shared", token] as const,
};

export const AttachmentKeys = {
  all: ["attachments"] as const,
  owner: (ownerKind: string, ownerId: string) => [...AttachmentKeys.all, ownerKind, ownerId] as const,
};

export const ExpenseKeys = {
  all: ["expenses"] as const,
  list: (from: string, to: string) => [...ExpenseKeys.all, "list", from, to] as const,
  detail: (id: string) => [...ExpenseKeys.all, "detail", id] as const,
  catalogue: () => [...ExpenseKeys.all, "catalogue"] as const,
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
  ConflictKeys.all,
  FollowUpKeys.all,
  PackageKeys.all,
  ClientKeys.all,
  ActivityKeys.all,
  DocumentKeys.all,
  SyncKeys.all,
] as const;
