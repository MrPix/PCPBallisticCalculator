import { describe, expect, it } from "vitest";
import { airDensity } from "./atmosphere";
import {
  FIT_BOUNDS,
  type DropMeasurement,
  type FitParameter,
  type FitResult,
  ballisticCoefficientFromVelocity,
  fitFromDrops,
} from "./fit";
import { STANDARD_GRAVITY, type ShotConfig, angularDropMrad, simulate } from "./trajectory";
import { SEED_MEASUREMENTS, SEED_SIGHT_HEIGHT_MM, SEED_WEATHER, createSeedBullet } from "../data/seed";
import { toShotConfig } from "../data/shot";

const TEST_WEATHER = { temperatureC: 15, pressureHpa: 998, humidityPct: 63 };
const RHO = airDensity(TEST_WEATHER);

const TRUTH: ShotConfig = {
  muzzleVelocityMs: 280,
  ballisticCoefficientKgM2: 250,
  sightHeightM: 0.035,
  zeroDistanceM: 50,
  airDensityKgM3: RHO,
  gravityMps2: STANDARD_GRAVITY,
};

function measurementsFor(config: ShotConfig, distances: number[]): DropMeasurement[] {
  const traj = simulate(config, Math.max(...distances) * 1.05);
  return distances.map((distanceM) => ({
    distanceM,
    dropMrad: Number(angularDropMrad(traj, distanceM)!.toFixed(6)),
  }));
}

function rms(result: FitResult): number {
  return result.rmsMrad;
}

describe("fitFromDrops", () => {
  it("recovers a synthetic ballistic coefficient when velocity and sight height are known", () => {
    const distances = [25, 50, 75, 100, 125, 150, 175, 200];
    const data = measurementsFor(TRUTH, distances);
    const start: ShotConfig = { ...TRUTH, ballisticCoefficientKgM2: 120 }; // deliberately wrong
    const result = fitFromDrops(start, data, ["ballisticCoefficientKgM2"]);
    expect(result.success).toBe(true);
    expect(result.config.ballisticCoefficientKgM2).toBeCloseTo(TRUTH.ballisticCoefficientKgM2, -1);
    expect(result.config.ballisticCoefficientKgM2 / TRUTH.ballisticCoefficientKgM2).toBeGreaterThan(0.98);
    expect(result.config.ballisticCoefficientKgM2 / TRUTH.ballisticCoefficientKgM2).toBeLessThan(1.02);
    expect(rms(result)).toBeLessThan(0.02);
  });

  it("recovers BC and muzzle velocity together when both are free", () => {
    const data = measurementsFor(TRUTH, [25, 50, 100, 150, 200]);
    const start: ShotConfig = { ...TRUTH, ballisticCoefficientKgM2: 400, muzzleVelocityMs: 240 };
    const free: FitParameter[] = ["ballisticCoefficientKgM2", "muzzleVelocityMs"];
    const result = fitFromDrops(start, data, free);
    expect(result.success).toBe(true);
    expect(rms(result)).toBeLessThan(0.05);
    expect(result.config.muzzleVelocityMs).toBeGreaterThan(200);
    expect(result.config.muzzleVelocityMs).toBeLessThan(360);
  });

  it("tolerates measurement noise", () => {
    const clean = measurementsFor(TRUTH, [25, 50, 75, 100, 125, 150, 175, 200]);
    const noisy = clean.map((m, i) => ({
      distanceM: m.distanceM,
      dropMrad: m.dropMrad + (i % 2 === 0 ? 0.3 : -0.3),
    }));
    const result = fitFromDrops({ ...TRUTH, ballisticCoefficientKgM2: 150 }, noisy, [
      "ballisticCoefficientKgM2",
    ]);
    expect(result.success).toBe(true);
    const ratio = result.config.ballisticCoefficientKgM2 / TRUTH.ballisticCoefficientKgM2;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it("reports residuals for every measurement", () => {
    const data = measurementsFor(TRUTH, [50, 100, 200]);
    const result = fitFromDrops(TRUTH, data, ["ballisticCoefficientKgM2"]);
    expect(result.residuals).toHaveLength(3);
    for (const r of result.residuals) {
      expect(r.errorMrad).toBeCloseTo(0, 2);
      expect(r.observedMrad).toBeCloseTo(r.predictedMrad, 2);
    }
    expect(result.maxAbsErrorMrad).toBeLessThan(0.05);
  });

  it("fails cleanly when there is nothing to fit", () => {
    const result = fitFromDrops(TRUTH, [], ["ballisticCoefficientKgM2"]);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/at least one/i);
  });

  it("ignores unusable rows instead of poisoning the fit", () => {
    const data = measurementsFor(TRUTH, [50, 100, 150]);
    const broken: DropMeasurement[] = [
      ...data,
      { distanceM: Number.NaN, dropMrad: 1 },
      { distanceM: 0, dropMrad: 1 },
      { distanceM: 120, dropMrad: Number.NaN },
    ];
    const result = fitFromDrops({ ...TRUTH, ballisticCoefficientKgM2: 150 }, broken, [
      "ballisticCoefficientKgM2",
    ]);
    expect(result.success).toBe(true);
    expect(result.residuals).toHaveLength(3);
  });

  it("keeps fitted parameters inside physical bounds", () => {
    const data = measurementsFor(TRUTH, [50, 100, 200]);
    const result = fitFromDrops(
      { ...TRUTH, ballisticCoefficientKgM2: FIT_BOUNDS.ballisticCoefficientKgM2[0] },
      data,
      ["ballisticCoefficientKgM2", "muzzleVelocityMs", "sightHeightM"],
    );
    expect(result.success).toBe(true);
    for (const [key, [lo, hi]] of Object.entries(FIT_BOUNDS)) {
      const value = result.config[key as keyof ShotConfig] as number;
      expect(value).toBeGreaterThanOrEqual(lo);
      expect(value).toBeLessThanOrEqual(hi);
    }
  });

  it("recovers from a completely wrong starting ballistic coefficient", () => {
    const data = measurementsFor(TRUTH, [50, 100, 150, 200]);
    const result = fitFromDrops({ ...TRUTH, ballisticCoefficientKgM2: 10 }, data, [
      "ballisticCoefficientKgM2",
    ]);
    expect(result.success).toBe(true);
    expect(result.config.ballisticCoefficientKgM2 / 250).toBeGreaterThan(0.97);
    expect(result.config.ballisticCoefficientKgM2 / 250).toBeLessThan(1.03);
  });

  it("runs fast enough to fire on every keystroke on a phone", () => {
    const started = performance.now();
    const result = fitFromDrops({ ...TRUTH, ballisticCoefficientKgM2: 10 }, SEED_MEASUREMENTS, [
      "ballisticCoefficientKgM2",
    ]);
    const elapsedMs = performance.now() - started;
    expect(result.success).toBe(true);
    expect(elapsedMs).toBeLessThan(1500);
  });

  it("reports a helpful message when the model cannot reach the measured distances", () => {
    const data = measurementsFor(TRUTH, [50, 100, 200]);
    const hopeless: ShotConfig = { ...TRUTH, muzzleVelocityMs: 3, ballisticCoefficientKgM2: 12 };
    const result = fitFromDrops(hopeless, data, ["ballisticCoefficientKgM2"]);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/could not reach/i);
  });
});

describe("calibration from a single range", () => {
  it("re-zeroing on a different day only needs one measured hold-over", () => {
    // A dirty barrel / different pellet lot changes the BC from 250 to 300.
    const newDay: ShotConfig = { ...TRUTH, ballisticCoefficientKgM2: 300 };
    const data = measurementsFor(newDay, [50, 100]); // zero + one measured drop
    const result = fitFromDrops({ ...TRUTH }, data, ["ballisticCoefficientKgM2"]);
    expect(result.success).toBe(true);
    expect(result.config.ballisticCoefficientKgM2).toBeCloseTo(300, -1);

    // The recalibrated model must predict the far end of the scale.
    const predicted = simulate(result.config, 220);
    const truth = simulate(newDay, 220);
    expect(Math.abs(angularDropMrad(predicted, 200)! - angularDropMrad(truth, 200)!)).toBeLessThan(0.1);
  });
});

describe("ballisticCoefficientFromVelocity", () => {
  it("derives BC from a muzzle + at-range chronograph pair", () => {
    const traj = simulate(TRUTH, 120);
    const v100 = traj.points.find((p) => p.x >= 100)!.v;
    const { ballisticCoefficientKgM2, message } = ballisticCoefficientFromVelocity({
      muzzleVelocityMps: 280,
      measuredVelocityMps: v100,
      distanceM: 100,
      airDensityKgM3: RHO,
    });
    expect(message).toBeNull();
    expect(ballisticCoefficientKgM2 / 250).toBeGreaterThan(0.97);
    expect(ballisticCoefficientKgM2 / 250).toBeLessThan(1.03);
  });

  it("refuses a reading that is faster than the muzzle", () => {
    const { ballisticCoefficientKgM2, message } = ballisticCoefficientFromVelocity({
      muzzleVelocityMps: 280,
      measuredVelocityMps: 290,
      distanceM: 100,
      airDensityKgM3: RHO,
    });
    expect(Number.isNaN(ballisticCoefficientKgM2)).toBe(true);
    expect(message).toMatch(/lower than the muzzle/);
  });

  it("refuses a reading that no physical projectile could produce", () => {
    const { ballisticCoefficientKgM2, message } = ballisticCoefficientFromVelocity({
      muzzleVelocityMps: 280,
      measuredVelocityMps: 279.99,
      distanceM: 400,
      airDensityKgM3: RHO,
    });
    expect(message).not.toBeNull();
    expect(ballisticCoefficientKgM2).toBeLessThanOrEqual(FIT_BOUNDS.ballisticCoefficientKgM2[1]);
  });
});

describe("regression against the real range test", () => {
  // Built from the seed itself, so this suite can never drift away from the
  // bullet and rig the app actually ships with (BC 352.8, calipered 70 mm).
  const seeded: ShotConfig = toShotConfig(createSeedBullet(), {
    weather: SEED_WEATHER,
    sightHeightMm: SEED_SIGHT_HEIGHT_MM,
  });

  it("uses the rig as configured on the Settings screen", () => {
    expect(seeded.sightHeightM).toBeCloseTo(0.07, 9);
    expect(seeded.muzzleVelocityMs).toBe(280);
    expect(seeded.zeroDistanceM).toBe(50);
    expect(seeded.ballisticCoefficientKgM2).toBeCloseTo(352.8, 1);
  });

  it("the seeded bullet reproduces the measured drop table", () => {
    const traj = simulate(seeded, 220);
    const errors = SEED_MEASUREMENTS.map((m) => angularDropMrad(traj, m.distanceM)! - m.dropMrad);
    const rmsValue = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
    expect(rmsValue).toBeLessThan(0.35);
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(0.5);
  });

  it("fitting the measured table lands on the seeded ballistic coefficient", () => {
    const result = fitFromDrops({ ...seeded, ballisticCoefficientKgM2: 150 }, SEED_MEASUREMENTS, [
      "ballisticCoefficientKgM2",
    ]);
    expect(result.success).toBe(true);
    expect(result.config.ballisticCoefficientKgM2).toBeGreaterThan(340);
    expect(result.config.ballisticCoefficientKgM2).toBeLessThan(370);
    expect(result.config.sightHeightM).toBeCloseTo(seeded.sightHeightM, 9);
    expect(result.rmsMrad).toBeLessThan(0.3);
  });

  it("the measured table is consistent with a subsonic slug that keeps most of its velocity", () => {
    const traj = simulate(seeded, 220);
    const v200 = traj.points.find((p) => p.x >= 200)!.v;
    expect(v200).toBeGreaterThan(170);
    expect(v200).toBeLessThan(250);
    expect(v200 / 280).toBeGreaterThan(0.6);
  });
});
