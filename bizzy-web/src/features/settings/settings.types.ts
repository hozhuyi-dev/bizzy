// Mirrors bizzy-lambda/internal/features/settings/model.go.
export interface Settings {
  businessName: string;
  registrationNo: string;
  address: string;
  email: string;
  phone: string;
  bankName?: string;
  accountName?: string;
  accountNo?: string;
  /** Describes a session on a receipt line. */
  serviceName: string;
  /** The Google Calendar event colour that marks a home visit. */
  homeVisitColorId: string;
  /** Days ahead an unconfirmed session goes on the to-do list. */
  confirmAheadDays: number;
  /** Days ahead a follow-up goes on the to-do list. */
  followUpAheadDays: number;
  /** WhatsApp message asking to pay for a session; {placeholders} filled in. */
  paymentMessage: string;
  /** WhatsApp message with links to issued documents. */
  documentMessage: string;
}
