import { queryOptions, useQuery } from "@tanstack/react-query";
import { TodoService } from "./todo.service";
import { TodoKeys } from "~/core/constants/query-keys.constant";

const list = () => queryOptions({ queryKey: TodoKeys.list(), queryFn: () => TodoService.list() });

export const TodoQuery = {
  /** For reading it outside a component, e.g. to see what a fix settled. */
  list,
  /** Everything that needs her, oldest first. */
  useList: () => useQuery(list()),
};
