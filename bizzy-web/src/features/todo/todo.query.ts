import { useQuery } from "@tanstack/react-query";
import { TodoService } from "./todo.service";
import { TodoKeys } from "~/core/constants/query-keys.constant";

export const TodoQuery = {
  /** Everything that needs her, oldest first. */
  useList: () =>
    useQuery({
      queryKey: TodoKeys.list(),
      queryFn: () => TodoService.list(),
    }),
};
