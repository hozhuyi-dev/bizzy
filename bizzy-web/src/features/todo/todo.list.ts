import { useMemo } from "react";
import { TodoQuery } from "./todo.query";
import { todoSessionIds } from "./todo.util";
import type { PagerList } from "~/core/list/pager.types";
import { useAllWindow } from "~/core/list/pager.hook";

/** The sessions on the to-do list, by id: what a session opened from Home steps through. */
export const TODO_SESSIONS: PagerList<string> = {
  noun: "to-do",
  nouns: "to-dos",
  useWindow: () => {
    const todo = TodoQuery.useList();
    const ids = useMemo(() => todo.data && todoSessionIds(todo.data), [todo.data]);
    return useAllWindow(ids);
  },
  idOf: (id) => id,
};
