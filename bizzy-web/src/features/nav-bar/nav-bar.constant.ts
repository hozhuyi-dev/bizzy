import type { Module } from "./nav-bar.types";

export const MODULES: ReadonlyArray<Module> = [
  { label: "Home", pages: [{ to: "/", label: "Home" }] },
  {
    label: "Sessions",
    pages: [{ to: "/sessions", label: "All sessions" }],
  },
  {
    label: "Follow-ups",
    pages: [
      { to: "/follow-ups", label: "Upcoming" },
      { to: "/follow-ups/done", label: "Done" },
    ],
  },
  {
    label: "Clients",
    pages: [
      { to: "/clients", label: "All clients" },
      { to: "/clients/reconnect", label: "Reconnect" },
      { to: "/packages", label: "Packages" },
    ],
  },
  {
    label: "Documents",
    pages: [
      { to: "/invoices", label: "Invoices" },
      { to: "/receipts", label: "Receipts" },
    ],
  },
  {
    label: "Expenses",
    pages: [
      { to: "/expenses", label: "Expenses" },
      { to: "/expenses/items", label: "Items" },
      { to: "/expenses/categories", label: "Categories" },
    ],
  },
  { label: "Insights", pages: [{ to: "/insights", label: "Insights" }] },
];

/** Settings is no module in the bar (it sits behind the gear) but is matched like one. */
export const SETTINGS: Module = { label: "Settings", pages: [{ to: "/settings", label: "Settings" }] };
