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
  /** Number template per document type, e.g. { receipt: "RCP-{seq:4}" }. */
  numbering: Record<string, string>;
}

/** Google Calendar's event colours, by colorId. */
export const EVENT_COLOURS = [
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "8", name: "Graphite", hex: "#616161" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "11", name: "Tomato", hex: "#d50000" },
] as const;
