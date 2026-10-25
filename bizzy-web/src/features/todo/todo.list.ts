import { useMemo } from "react";
import { TodoQuery } from "./todo.query";
import { todoIds } from "./todo.util";
import type { TodoItemKind } from "./todo.util";
import type { PagerList } from "~/core/list/pager.types";
import { useAllWindow } from "~/core/list/pager.hook";

/** The items of one kind on the to-do list, by id: what one opened from Home steps through. */
function todoList(kind: TodoItemKind): PagerList<string> {
  return {
    noun: "to-do",
    nouns: "to-dos",
    useWindow: () => {
      const todo = TodoQuery.useList();
      const ids = useMemo(() => todo.data && todoIds(todo.data, kind), [todo.data]);
      return useAllWindow(ids);
    },
    idOf: (id) => id,
  };
}

export const TODO_SESSIONS = todoList("session");
export const TODO_PACKAGES = todoList("package");
export const TODO_FOLLOW_UPS = todoList("followUp");
