import { defineConfig } from "@vite-pwa/assets-generator/config";

/** public/app-icon.svg's background, which pads the maskable icon to the same colour. */
const ICON_BACKGROUND = "#e39a1c";

/**
 * The installed app's icons, generated from public/app-icon.svg into public/
 * by `pnpm pwa:icons` and committed, so a build doesn't need the generator.
 * The source is already a full-bleed icon, so none is padded but the
 * maskable one: Android's launcher crops that to a circle or squircle, so
 * the bee shrinks into its safe zone. iOS takes the apple one.
 */
export default defineConfig({
  preset: {
    transparent: { sizes: [192, 512], padding: 0, favicons: [] },
    maskable: { sizes: [512], padding: 0.15, resizeOptions: { background: ICON_BACKGROUND } },
    apple: { sizes: [180], padding: 0 },
  },
  images: ["public/app-icon.svg"],
});
