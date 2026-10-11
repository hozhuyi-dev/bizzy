import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ThemeService, useTheme } from "../../theme.service";
import type { ThemePreference } from "../../theme.service";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

const OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: unknown }>;

/** Light, dark or the device's setting. Applies at once, on this device only. */
export function AppearanceSettings() {
  const { preference } = useTheme();

  return (
    <Tabs
      value={preference}
      onValueChange={(value) => ThemeService.setPreference(value as ThemePreference)}
    >
      <TabsList>
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value}>
            <Icon /> {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
