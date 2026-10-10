export const AuthKeys = {
  all: ["auth"] as const,
  state: () => [...AuthKeys.all, "state"] as const,
};

export const ClientKeys = {
  all: ["clients"] as const,
  list: () => [...ClientKeys.all, "list"] as const,
};
