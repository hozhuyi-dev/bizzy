import { QueryClient } from "@tanstack/react-query";
import { holdingChanges, refreshChanged } from "./query.util";
import { AppKeys, AuthKeys, ExpenseKeys, SessionKeys, TodoKeys } from "~/core/constants/query-keys.constant";

/** A cache holding one of each of these, all fresh. */
function cacheOf(...keys: Array<ReadonlyArray<unknown>>) {
  const queryClient = new QueryClient();
  for (const key of keys) queryClient.setQueryData(key, "x");
  const stale = () =>
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.isStale())
      .map((query) => query.queryKey);
  return { queryClient, stale };
}

describe("refreshChanged", () => {
  test("reads again only what shows the kinds changed", async () => {
    const { queryClient, stale } = cacheOf(TodoKeys.list(), ExpenseKeys.catalogue(), AppKeys.status());
    await refreshChanged(queryClient, ["EXPENSE"]);
    expect(stale()).toEqual([ExpenseKeys.catalogue()]);
  });

  test("a kind no page shows reads nothing again", async () => {
    const { queryClient, stale } = cacheOf(TodoKeys.list(), AppKeys.status());
    await refreshChanged(queryClient, ["EVENTLINK"]);
    expect(stale()).toEqual([]);
  });

  test("keeps what is kept", async () => {
    const { queryClient, stale } = cacheOf(SessionKeys.detail("1"), SessionKeys.detail("2"), TodoKeys.list());
    await refreshChanged(queryClient, ["SESSION"], [SessionKeys.detail("1")]);
    expect(stale()).toEqual([SessionKeys.detail("2"), TodoKeys.list()]);
  });

  test("a kind it doesn't know reads everything again but who is signed in", async () => {
    const { queryClient, stale } = cacheOf(AuthKeys.state(), TodoKeys.list(), ExpenseKeys.catalogue());
    await refreshChanged(queryClient, ["SOMETHINGNEW"]);
    expect(stale()).toEqual([TodoKeys.list(), ExpenseKeys.catalogue()]);
  });
});

describe("holdingChanges", () => {
  test("reads what a run of calls changed once it ends", async () => {
    const { queryClient, stale } = cacheOf(TodoKeys.list(), ExpenseKeys.catalogue(), AppKeys.status());
    const changes = holdingChanges(queryClient);
    const release = changes.hold();
    changes.changed(["SYNC"]);
    changes.changed(["EXPENSE"]);
    expect(stale()).toEqual([]);
    release();
    await Promise.resolve();
    expect(stale()).toEqual([ExpenseKeys.catalogue(), AppKeys.status()]);
  });
});
