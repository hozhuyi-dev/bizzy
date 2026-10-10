import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import type { Linter } from "eslint";

const config: Array<Linter.Config> = [
  { ignores: ["dist/**", "cdk.out/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
];

export default config;
