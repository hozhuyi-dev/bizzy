import type { SettingsGapsView, SettingsView } from "./settings.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SettingsService = {
  get: () => invoke<SettingsView>("settings.get"),
  gaps: () => invoke<SettingsGapsView>("settings.gaps"),
  save: (input: SettingsView) => invoke<SettingsView>("settings.save", input),
};
