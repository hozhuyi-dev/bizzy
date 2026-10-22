import type { PayApp } from "./settings.types";

/** The apps clients can pay her phone number with, as the payment page lists them. */
export const PAY_APP_OPTIONS: ReadonlyArray<{ value: PayApp; label: string; title: string }> = [
  { value: "duitnow", label: "DuitNow", title: "DuitNow transfer to the phone number, from any bank app" },
  { value: "tng", label: "TnG eWallet", title: "Touch 'n Go eWallet transfer" },
  { value: "grabpay", label: "GrabPay", title: "GrabPay transfer" },
];

/** Where the payment page is served; the payment message's {payLink}. */
export const PAY_URL = (import.meta.env.VITE_PAY_URL ?? "").replace(/\/$/, "");
