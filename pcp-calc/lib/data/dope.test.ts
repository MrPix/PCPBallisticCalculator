import { describe, expect, it } from "vitest";
import { airDensity, type Weather } from "../physics/atmosphere";
import { fitFromDrops } from "../physics/fit";
import { STANDARD_GRAVITY, angularDropMrad, simulate } from "../physics/trajectory";
import {
  createSeedBullet,
  createSeedState,
  SEED_MEASUREMENTS,
  SEED_SIGHT_HEIGHT_MM,
  SEED_WEATHER,
} from "./seed";
import { prepareShot, toShotConfig } from "./shot";
import {
  buildDopeModel,
  cardForBullet,
  correctedDrop,
  measuredDropMrad,
  sortedMeasurements,
} from "./dope";

const bullet = () => createSeedBullet();
const card = () => createSeedState().dope!;
const sightHeightMm = () => createSeedState().settings.sightHeightMm;
const env = (weather: Weather = SEED_WEATHER) => ({ weather, sightHeightMm: SEED_SIGHT_HEIGHT_MM });

describe("sortedMeasurements", () => {
  it("sorts by distance and averages repeats", () => {
    const sorted = sortedMeasurements([
      { distanceM: 150, dropMrad: -7 },
      { distanceM: 50, dropMrad: 0 },
      { distanceM: 100, dropMrad: -2.8 },
      { distanceM: 100, dropMrad: -3.0 },
    ]);
    expect(sorted.map((m) => m.distanceM)).toEqual([50, 100, 150]);
    expect(sorted[1].dropMrad).toBeCloseTo(-2.9, 6);
  });

  it("drops unusable rows", () => {
    expect(sortedMeasurements([{ distanceM: 0, dropMrad: -1 }, { distanceM: 100, dropMrad: NaN }])).toEqual([]);
  });
});

describe("the measured card reproduces the measured drop table", () => {
  // The whole point of the card: at the conditions it was shot in, the
  // calculator must report the shooter's own numbers, not the model's.
  const model = buildDopeModel(card(), bullet(), sightHeightMm())!;
  const today = prepareShot(bullet(), env(), 250);

  it("builds a residual for every measured range", () => {
    expect(model.residuals).toHaveLength(SEED_MEASUREMENTS.length);
    expect(model.minM).toBe(25);
    expect(model.maxM).toBe(200);
  });

  it("returns the measured value exactly at every measured range", () => {
    for (const m of SEED_MEASUREMENTS) {
      const c = correctedDrop(model, today, m.distanceM)!;
      expect(c.kind).toBe("measured");
      expect(c.correctedMrad).toBeCloseTo(m.dropMrad, 6);
      expect(c.correctionMrad).toBeCloseTo(m.dropMrad - c.modelMrad, 6);
    }
  });

  it("agrees with the raw card lookup", () => {
    for (const m of SEED_MEASUREMENTS) {
      expect(measuredDropMrad(card(), m.distanceM)).toBeCloseTo(m.dropMrad, 9);
    }
    expect(measuredDropMrad(card(), 137)).toBeNull();
  });

  it("the model alone does NOT reproduce the table, which is why the card exists", () => {
    // This is the discrepancy a shooter notices: the fitted model cannot pass
    // through every measured point because the table is not physically consistent.
    const traj = simulate(toShotConfig(bullet(), env()), 220);
    const modelAt100 = angularDropMrad(traj, 100)!;
    expect(modelAt100).toBeLessThan(-2.9); // model says more drop than measured
    expect(Math.abs(modelAt100 - -2.9)).toBeGreaterThan(0.05);
    expect(correctedDrop(model, today, 100)!.correctedMrad).toBeCloseTo(-2.9, 6);
  });
});

describe("no physical trajectory reproduces the measured table", () => {
  it("the measured increments violate the convexity of angular drop", () => {
    // Beyond the zero, angular drop must get more negative at an increasing
    // rate: each 25 m step must drop more than the previous one.
    const beyond = SEED_MEASUREMENTS.filter((m) => m.distanceM >= 50);
    const increments: number[] = [];
    for (let i = 1; i < beyond.length; i++) increments.push(beyond[i].dropMrad - beyond[i - 1].dropMrad);

    const violations: number[] = [];
    for (let i = 1; i < increments.length; i++) {
      if (increments[i] > increments[i - 1]) violations.push(i);
    }
    expect(violations.length).toBeGreaterThan(0);
  });

  it("every physical trajectory in this model family obeys that convexity", () => {
    const rho = airDensity(SEED_WEATHER);
    let evaluated = 0;
    for (const bc of [50, 100, 200, 422.3, 900, 2000, 6000]) {
      for (const v0 of [150, 200, 280, 400, 600]) {
        for (const h of [0.01, 0.04, 0.12]) {
          for (const z of [25, 50, 100]) {
            try {
              const traj = simulate(
                {
                  muzzleVelocityMs: v0,
                  ballisticCoefficientKgM2: bc,
                  sightHeightM: h,
                  zeroDistanceM: z,
                  airDensityKgM3: rho,
                  gravityMps2: STANDARD_GRAVITY,
                },
                220,
              );
              const distances = [25, 50, 75, 100, 125, 150, 175, 200].filter((d) => d >= z);
              if (distances.length < 4) continue;
              const values = distances.map((d) => angularDropMrad(traj, d)!);
              if (values.some(Number.isNaN) || values.some((v) => v > 0)) continue;
              evaluated++;
              const inc: number[] = [];
              for (let i = 1; i < values.length; i++) inc.push(values[i] - values[i - 1]);
              for (let i = 1; i < inc.length; i++) {
                expect(inc[i]).toBeLessThanOrEqual(inc[i - 1] + 1e-9);
              }
            } catch {
              /* a zero the pellet cannot reach is not a counterexample */
            }
          }
        }
      }
    }
    expect(evaluated).toBeGreaterThan(150);
  });

  it("the best least-squares fit still cannot reach -2.90 at 100 m", () => {
    const base = toShotConfig(bullet(), env());
    const best = fitFromDrops(base, SEED_MEASUREMENTS, [
      "ballisticCoefficientKgM2",
      "muzzleVelocityMs",
      "sightHeightM",
    ]);
    expect(best.success).toBe(true);
    const at100 = best.residuals.find((r) => r.distanceM === 100)!;
    expect(at100.predictedMrad).toBeLessThan(-2.9);
    // Even with three free parameters the fit floor is set by the data itself.
    expect(best.rmsMrad).toBeGreaterThan(0.15);
  });
});

describe("corrections between conditions", () => {
  const model = buildDopeModel(card(), bullet(), sightHeightMm())!;

  it("interpolates between measured ranges", () => {
    const today = prepareShot(bullet(), env(), 250);
    const c = correctedDrop(model, today, 137)!;
    expect(c.kind).toBe("interpolated");
    // 137 m lies between 125 and 150, so the correction lies between theirs.
    const r125 = model.residuals.find((r) => r.distanceM === 125)!.correctionMrad;
    const r150 = model.residuals.find((r) => r.distanceM === 150)!.correctionMrad;
    expect(c.correctionMrad).toBeGreaterThan(Math.min(r125, r150));
    expect(c.correctionMrad).toBeLessThan(Math.max(r125, r150));
  });

  it("holds the nearest offset outside the measured span", () => {
    const today = prepareShot(bullet(), env(), 250);
    const beyond = correctedDrop(model, today, 250)!;
    const before = correctedDrop(model, today, 10)!;
    expect(beyond.kind).toBe("extrapolated");
    expect(before.kind).toBe("extrapolated");
    expect(beyond.correctionMrad).toBeCloseTo(model.residuals[model.residuals.length - 1].correctionMrad, 9);
    expect(before.correctionMrad).toBeCloseTo(model.residuals[0].correctionMrad, 9);
  });

  it("a colder day shifts the corrected hold-over the same way it shifts the model", () => {
    const warm = prepareShot(bullet(), env(), 250);
    const cold = prepareShot(bullet(), env({ temperatureC: 0, pressureHpa: 1020, humidityPct: 80 }), 250);

    const warmModel = angularDropMrad(warm.trajectory, 150)!;
    const coldModel = angularDropMrad(cold.trajectory, 150)!;
    expect(coldModel).toBeLessThan(warmModel); // denser air -> more drop

    const warmCard = correctedDrop(model, warm, 150)!;
    const coldCard = correctedDrop(model, cold, 150)!;
    // The card keeps its own measured level at its own conditions...
    expect(warmCard.correctedMrad).toBeCloseTo(-7.3, 6);
    // ...and follows the model when the air changes.
    expect(coldCard.correctedMrad).toBeLessThan(warmCard.correctedMrad);
    expect(
      coldCard.correctedMrad - warmCard.correctedMrad,
    ).toBeCloseTo(coldModel - warmModel, 9);
  });

  it("returns null for a distance the pellet never reaches", () => {
    const shortBullet = { ...bullet(), muzzleVelocityMs: 60, ballisticCoefficientKgM2: 20 };
    const short = prepareShot(shortBullet, env(), 120);
    expect(correctedDrop(model, short, 500)).toBeNull();
  });
});

describe("card ownership", () => {
  it("is only usable for the bullet it was shot with", () => {
    const c = card();
    expect(cardForBullet(c, c.bulletId)).toBe(c);
    expect(cardForBullet(c, "another-bullet")).toBeNull();
    expect(cardForBullet(null, "any")).toBeNull();
    expect(
      cardForBullet({ ...c, measurements: [] }, c.bulletId),
    ).toBeNull();
  });

  it("refuses to build a model from an empty or unreachable card", () => {
    expect(buildDopeModel({ ...card(), measurements: [] }, bullet(), sightHeightMm())).toBeNull();
    const hopeless = { ...bullet(), muzzleVelocityMs: 20 };
    expect(buildDopeModel(card(), hopeless, sightHeightMm())).toBeNull();
  });
});
