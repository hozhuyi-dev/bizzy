import type { Settings } from "./settings.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SettingsService = {
  get: () => invoke<Settings>("settings.get"),
  save: (input: Settings) => invoke<Settings>("settings.save", input),
};
