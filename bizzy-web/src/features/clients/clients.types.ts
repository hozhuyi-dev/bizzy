// Mirrors bizzy-lambda/internal/features/clients/model.go.
export interface Client {
  id: string;
  name: string;
  email?: string;
  /** Names she writes in the calendar; always includes the client's name. */
  aliases: Array<string>;
  defaultFeeCents?: number;
}

/** A new client has no id yet. */
export type SaveClientInput = Omit<Client, "id"> & { id?: string };
