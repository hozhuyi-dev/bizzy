import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/features/home/home-page.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { TodoQuery } from "~/features/todo/todo.query";
import { dayRange } from "~/core/utils/date.util";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/")({
  loader: () => {
    const { from, to } = dayRange();
    return pageData(prefetch(TodoQuery.list()), prefetch(SessionsQuery.range(from, to)), prefetch(ClientsQuery.list()));
  },
  component: HomePage,
});
