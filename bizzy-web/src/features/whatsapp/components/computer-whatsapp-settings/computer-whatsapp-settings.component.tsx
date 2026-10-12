import { AppWindowIcon, GlobeIcon } from "lucide-react";
import { setComputerWhatsApp, useComputerWhatsApp } from "../../whatsapp.preference";
import type { ComputerWhatsApp } from "../../whatsapp.preference";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

const OPTIONS = [
  { value: "web", label: "Browser", icon: GlobeIcon },
  { value: "desktop", label: "Desktop app", icon: AppWindowIcon },
] as const satisfies ReadonlyArray<{ value: ComputerWhatsApp; label: string; icon: unknown }>;

/** WhatsApp Web or the desktop app. Applies at once, on this computer only. */
export function ComputerWhatsAppSettings() {
  const choice = useComputerWhatsApp();

  return (
    <Tabs value={choice} onValueChange={(value) => setComputerWhatsApp(value as ComputerWhatsApp)}>
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
