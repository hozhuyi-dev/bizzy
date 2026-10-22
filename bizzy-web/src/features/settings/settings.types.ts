// Mirrors bizzy-lambda/internal/features/settings/api.go.

/** An app clients can pay her phone number with; mirrors settings.PayApp. */
export type PayApp = "duitnow" | "tng" | "grabpay";

export interface SettingsView {
  businessName: string;
  registrationNo: string;
  address: string;
  email: string;
  phone: string;
  bankName?: string;
  accountName?: string;
  accountNo?: string;
  /** What her DuitNow QR says, read from its image; the payment page draws it again. */
  duitNowQr?: string;
  /** The number clients pay to with payApps; blank is her phone. */
  payPhone?: string;
  payApps?: Array<PayApp>;
  /** Describes a session on a receipt line. */
  serviceName: string;
  /** Days ahead an unconfirmed session goes on the to-do list. */
  confirmAheadDays: number;
  /** Days ahead a follow-up goes on the to-do list. */
  followUpAheadDays: number;
  /** WhatsApp message asking to pay for a session; {placeholders} filled in. */
  paymentMessage: string;
  /** WhatsApp message with links to issued documents. */
  documentMessage: string;
}

/** What Settings still needs before documents print as they should; mirrors settings.GapsView. */
export interface SettingsGapsView {
  /** As the app asks for them: "your business name", "a phone number or email". Empty once set. */
  missing: Array<string>;
}
