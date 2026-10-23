import { tanstackConfig } from "@tanstack/eslint-config";
import pluginRouter from "@tanstack/eslint-plugin-router";
import pluginQuery from "@tanstack/eslint-plugin-query";
import pluginReactHooks from "eslint-plugin-react-hooks";
import type { Linter } from "eslint";

const config: Array<Linter.Config> = [
  // shadcn components are generated; keeping them as generated lets
  // `shadcn add --overwrite` update them cleanly.
  { ignores: ["dist/**", "src/routeTree.gen.ts", "src/components/ui/**"] },
  ...tanstackConfig,
  // tanstackConfig sets `project: true` without a root, which resolves
  // against ESLint's working directory: the repo root or a sibling package
  // when run from an editor.
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  ...pluginRouter.configs["flat/recommended"],
  ...pluginQuery.configs["flat/recommended"],
  pluginReactHooks.configs.flat.recommended,
  // The web's layers, as the README lays them out: shared code builds on no
  // feature, and components reach data only through query, mutation and hook.
  {
    files: ["src/components/shared/**", "src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["~/features/*"], message: "Shared code builds on no feature: move it to core, or pass it in." }] },
      ],
    },
  },
  {
    files: ["src/features/**/*.component.tsx", "src/routes/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/*.service"],
              message: "Components reach data through a query, mutation or hook, never a service.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
