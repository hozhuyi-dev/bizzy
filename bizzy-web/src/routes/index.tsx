import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/features/home/home-page.component";

export const Route = createFileRoute("/")({
  component: HomePage,
});
