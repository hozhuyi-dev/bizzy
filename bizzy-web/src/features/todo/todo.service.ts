import type { TodoView } from "./todo.types";
import { invoke } from "~/core/lambda/lambda.client";

export const TodoService = {
  list: () => invoke<Array<TodoView>>("todo.list"),
};
