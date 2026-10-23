import { artFor } from "./bee-art.component";
import { QUIPS } from "~/core/constants/quips.constant";

const drawn = (quip: string) => artFor(quip)?.name;

describe("artFor", () => {
  test("draws what a quip names", () => {
    expect(drawn("Counting the honey…")).toBe("BeeArtJar");
    expect(drawn("Gathering pollen…")).toBe("BeeArtFlower");
    expect(drawn("Warming up the hive…")).toBe("BeeArtHive");
    expect(drawn("This page flew off.")).toBe("BeeArtLoop");
    expect(drawn("Not a drop of honey.")).toBe("BeeArtDrop");
  });

  test("goes by the first thing named", () => {
    expect(drawn("Searched the whole hive.")).toBe("BeeArtSearch");
    expect(drawn("Waking the bees…")).toBe("BeeArtSleeping");
    expect(drawn("Checked every cell. Nothing.")).toBe("BeeArtSearch");
  });

  test("leaves one that names nothing drawn to its pool", () => {
    expect(drawn("The paper trail starts here.")).toBeUndefined();
  });

  test("pairs most quips the empty, loading and not-found states show", () => {
    const shown = [...QUIPS.loading, ...QUIPS.notFound, ...QUIPS.packages, ...QUIPS.search];
    const paired = shown.filter((quip) => artFor(quip) !== undefined);
    expect(paired.length / shown.length).toBeGreaterThan(0.6);
  });
});
