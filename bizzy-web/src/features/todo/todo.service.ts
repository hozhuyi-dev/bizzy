import type { TodoItem } from "./todo.types";
import { invoke } from "~/core/lambda/lambda.client";

export const TodoService = {
  list: () => invoke<Array<TodoItem>>("todo.list"),
};
