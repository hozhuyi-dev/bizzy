import { describe, expect, test } from "vitest";
import { appUrls } from "../utils/app-urls.util";

const localhost = {
  callbackUrls: ["http://localhost:4200/"],
  logoutUrls: ["http://localhost:4200/"],
};

describe("appUrls", () => {
  test("puts the site first, so it is Cognito's default redirect", () => {
    expect(appUrls("https://d123.cloudfront.net", localhost)).toEqual({
      callbackUrls: ["https://d123.cloudfront.net/", "http://localhost:4200/"],
      logoutUrls: ["https://d123.cloudfront.net/", "http://localhost:4200/"],
      origins: ["https://d123.cloudfront.net", "http://localhost:4200"],
    });
  });

  test("allows a site with nothing from the env file", () => {
    expect(appUrls("https://d123.cloudfront.net", { callbackUrls: [], logoutUrls: [] }).callbackUrls).toEqual([
      "https://d123.cloudfront.net/",
    ]);
  });

  test("keeps only the env file's without a site", () => {
    expect(appUrls(undefined, localhost)).toEqual({ ...localhost, origins: ["http://localhost:4200"] });
  });
});
