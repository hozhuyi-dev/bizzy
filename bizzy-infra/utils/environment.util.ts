/**
 * The deployment environments this project recognises.
 *
 * Anything outside this list is a typo rather than a new environment, and an
 * unvalidated one fails quietly in two ways: the app would synthesize a fresh
 * pair of stacks under the misspelled name, and `environment === "production"`
 * checks -- bucket retention in lib/common/web/cloudfront.ts, for one -- would
 * take the non-production branch on what was meant to be production.
 */
export const ENVIRONMENTS = ["development", "staging", "production"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Resolves the target environment, defaulting to development when unset.
 *
 * An empty string counts as unset: CI interpolates `vars.ENVIRONMENT`
 * unconditionally, so an unconfigured repository variable arrives as "" rather
 * than undefined, and `??` alone would let it through to produce stack names
 * like `bizzy--web`.
 */
export function resolveEnvironment(
  value: string | undefined = process.env.ENVIRONMENT,
): Environment {
  const trimmed = value?.trim();

  if (!trimmed) return "development";

  if (!(ENVIRONMENTS as ReadonlyArray<string>).includes(trimmed)) {
    throw new Error(
      `Unknown ENVIRONMENT "${trimmed}". Expected one of: ${ENVIRONMENTS.join(", ")}.`,
    );
  }

  return trimmed as Environment;
}
