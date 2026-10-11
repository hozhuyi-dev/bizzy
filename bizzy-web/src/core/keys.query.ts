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
  open: () => [...SessionKeys.all, "open"] as const,
  range: (from: string, to: string) => [...SessionKeys.all, "range", from, to] as const,
};

export const PackageKeys = {
  all: ["packages"] as const,
  list: (all: boolean) => [...PackageKeys.all, "list", { all }] as const,
};

export const DocumentKeys = {
  all: ["documents"] as const,
  list: (type: string) => [...DocumentKeys.all, "list", type] as const,
  detail: (id: string) => [...DocumentKeys.all, "detail", id] as const,
  numbering: (type: string) => [...DocumentKeys.all, "numbering", type] as const,
};

export const SettingsKeys = {
  all: ["settings"] as const,
};

export const SyncKeys = {
  all: ["sync"] as const,
  status: () => [...SyncKeys.all, "status"] as const,
};

/**
 * Everything derived from sessions: a sync, a client save or a receipt can
 * change any of these, so they are refreshed together.
 */
export const BILLING_KEYS = [
  SessionKeys.all,
  PackageKeys.all,
  ClientKeys.all,
  DocumentKeys.all,
  SyncKeys.all,
] as const;
