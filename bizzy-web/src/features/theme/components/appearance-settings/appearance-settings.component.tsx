import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "../../theme.hook";
import type { ThemePreference } from "../../theme.constant";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

const OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: unknown }>;

/** Light, dark or the device's setting. Applies at once, on this device only. */
export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();

  return (
    <Tabs
      value={preference}
      onValueChange={(value) => setPreference(value as ThemePreference)}
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
