import type { Module } from "./navigation.types";

export const MODULES: ReadonlyArray<Module> = [
  { label: "Home", pages: [{ to: "/", label: "Home" }] },
  { label: "Sessions", pages: [{ to: "/sessions", label: "Sessions" }] },
  { label: "Follow-ups", pages: [{ to: "/follow-ups", label: "Follow-ups" }] },
  {
    label: "Clients",
    pages: [
      { to: "/clients", label: "Clients" },
      { to: "/packages", label: "Packages" },
    ],
  },
  { label: "Documents", pages: [{ to: "/documents", label: "Documents", under: ["/invoices", "/receipts"] }] },
  {
    label: "Expenses",
    pages: [
      { to: "/expenses", label: "Expenses" },
      { to: "/expenses/items", label: "Items" },
      { to: "/expenses/vendors", label: "Shops" },
      { to: "/expenses/categories", label: "Categories" },
    ],
  },
  { label: "Insights", pages: [{ to: "/insights", label: "Insights" }] },
];

/** Settings is no module in the bar (it sits behind the gear) but is matched like one. */
export const SETTINGS: Module = { label: "Settings", pages: [{ to: "/settings", label: "Settings" }] };
