/**
 * Where the app runs, as Cognito's callback and logout lists and the file
 * bucket's CORS want them.
 *
 * `siteOrigin` is the hosted app ("https://d123.cloudfront.net", a deploy-time
 * token in staging and production), first so it is Cognito's default
 * redirect. `extra` are the origins from the env file, each ending in "/"
 * (development's localhost).
 */
export function appUrls(
  siteOrigin: string | undefined,
  extra: { callbackUrls: Array<string>; logoutUrls: Array<string> },
) {
  const site = siteOrigin ? [`${siteOrigin}/`] : [];
  return {
    callbackUrls: [...site, ...extra.callbackUrls],
    logoutUrls: [...site, ...extra.logoutUrls],
    // "http://localhost:4200/" → "http://localhost:4200": CORS matches the
    // origin. The site's is already one, and a token new URL() can't parse.
    origins: [
      ...(siteOrigin ? [siteOrigin] : []),
      ...extra.callbackUrls.map((url) => new URL(url).origin),
    ],
  };
}
