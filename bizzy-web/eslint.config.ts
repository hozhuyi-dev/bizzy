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
];

export default config;
