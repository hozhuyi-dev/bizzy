import type { DocumentRef } from "~/features/sessions/sessions.types";

// Mirrors bizzy-lambda/internal/features/packages/model.go.
export interface Package {
  id: string;
  clientId: string;
  sessions: number;
  /** The total paid, however it was written (10x85 or 10@850). */
  priceCents: number;
  purchasedAt: string;
  source: "calendar" | "app";
  note?: string;
  creditsUsed: number;
  removed?: boolean;
  drift?: string;
  invoice?: DocumentRef;
  receipt?: DocumentRef;
}

export interface SavePackageInput {
  id?: string;
  clientId: string;
  sessions: number;
  priceCents: number;
  purchasedAt: string;
  note: string;
}

export function creditsLeft(p: Package): number {
  return Math.max(p.sessions - p.creditsUsed, 0);
}
