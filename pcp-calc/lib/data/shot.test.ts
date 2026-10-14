import { describe, expect, it } from "vitest";
import { ZeroReachableError } from "../physics/trajectory";
import { createSeedBullet, createSeedState, SEED_SIGHT_HEIGHT_MM, SEED_WEATHER } from "./seed";
import {
  buildRows,
  crossSectionAreaM2,
  impliedDragCoefficient,
  prepareShot,
  summarizeShot,
  toShotConfig,
} from "./shot";
import { STATE_VERSION } from "./types";

const WEATHER = { temperatureC: 15, pressureHpa: 998, humidityPct: 63 };
const ENV = { weather: SEED_WEATHER, sightHeightMm: SEED_SIGHT_HEIGHT_MM };

describe("toShotConfig", () => {
  it("converts the UI units into the SI units the integrator wants", () => {
    const bullet = createSeedBullet();
    const config = toShotConfig(bullet, { weather: WEATHER, sightHeightMm: 70 });
    // Sight height comes from the rig (Settings), not from the bullet.
    expect(config.sightHeightM).toBeCloseTo(0.07, 9);
    expect(config.zeroDistanceM).toBe(50);
    expect(config.muzzleVelocityMs).toBe(280);
    expect(config.ballisticCoefficientKgM2).toBeCloseTo(352.8, 6);
    expect(config.airDensityKgM3).toBeCloseTo(1.2017, 3);
    expect(config.gravityMps2).toBeCloseTo(9.80665, 6);
  });

  it("a different sight height really does change the trajectory", () => {
    const bullet = createSeedBullet();
    const low = toShotConfig(bullet, { weather: WEATHER, sightHeightMm: 40 });
    const high = toShotConfig(bullet, { weather: WEATHER, sightHeightMm: 70 });
    expect(high.sightHeightM).toBeGreaterThan(low.sightHeightM);
    // A taller scope means a bigger launch angle to hit the same zero.
    expect(high.zeroDistanceM).toBe(low.zeroDistanceM);
  });
});

describe("impliedDragCoefficient", () => {
  it("is mass / (area * BC)", () => {
    const bullet = createSeedBullet();
    const area = crossSectionAreaM2(bullet.caliberMm);
    expect(area).toBeCloseTo(1.6046e-5, 9);
    expect(impliedDragCoefficient(bullet)).toBeCloseTo(
      bullet.massG / 1000 / (area * bullet.ballisticCoefficientKgM2),
      9,
    );
  });

  it("stays in the physically sensible band for a fitted .177 slug", () => {
    const cd = impliedDragCoefficient(createSeedBullet());
    expect(cd).toBeGreaterThan(0.05);
    expect(cd).toBeLessThan(1.5);
  });
});

describe("prepareShot / summarizeShot", () => {
  const bullet = createSeedBullet();
  const shot = prepareShot(bullet, ENV, 250);

  it("summarises the seeded slug at 100 m", () => {
    const s = summarizeShot(shot, 100);
    expect(s.reached).toBe(true);
    expect(s.dropMrad).toBeGreaterThan(-4);
    expect(s.dropMrad).toBeLessThan(-2.5);
    expect(s.velocityMps).toBeGreaterThan(225);
    expect(s.velocityMps).toBeLessThan(260);
    expect(s.energyJ).toBeGreaterThan(25);
    expect(s.energyJ).toBeLessThan(35);
    expect(s.mach).toBeGreaterThan(0.6);
    expect(s.mach).toBeLessThan(0.95);
    expect(s.timeOfFlightS).toBeGreaterThan(0.3);
    expect(s.timeOfFlightS).toBeLessThan(0.5);
  });

  it("is zero at the zero distance", () => {
    expect(summarizeShot(shot, 50).dropMrad).toBeCloseTo(0, 1);
  });

  it("reports an unreached distance instead of a bogus number", () => {
    const s = summarizeShot(shot, 5000);
    expect(s.reached).toBe(false);
    expect(Number.isNaN(s.dropMrad)).toBe(true);
  });

  it("builds a drop table for the configured distances", () => {
    const rows = buildRows(shot, [25, 50, 100, 200]);
    expect(rows).toHaveLength(4);
    expect(rows[0].distanceM).toBe(25);
    expect(rows[0].dropMrad).toBeGreaterThan(0); // 25 m: above the point of aim
    expect(rows[1].dropMrad).toBeCloseTo(0, 1); // 50 m: the zero
    expect(rows[3].dropMrad).toBeLessThan(rows[2].dropMrad);
    for (const row of rows) {
      expect(row.reached).toBe(true);
      expect(row.energyJ).toBeGreaterThan(0);
    }
  });

  it("reports drop-table energy in joules for the bullet's real mass", () => {
    // Bullet.massG is grams; the drop table must convert to kg or every energy
    // column comes out 1000x too large.
    const rows = buildRows(shot, [100]);
    const v = rows[0].velocityMps;
    expect(rows[0].energyJ).toBeCloseTo(0.5 * (bullet.massG / 1000) * v * v, 6);
    expect(rows[0].energyJ).toBeCloseTo(summarizeShot(shot, 100).energyJ, 6);
    // A 1 g subsonic slug is tens of joules, not tens of kilojoules.
    expect(rows[0].energyJ).toBeLessThan(100);
  });

  it("propagates an impossible zero as a typed error", () => {
    const impossible = { ...bullet, muzzleVelocityMs: 20, zeroDistanceM: 400 };
    expect(() => prepareShot(impossible, ENV, 250)).toThrow(ZeroReachableError);
  });
});

describe("seed state", () => {
  it("is a valid, self-consistent starting point", () => {
    const state = createSeedState();
    expect(state.version).toBe(STATE_VERSION);
    expect(state.bullets).toHaveLength(1);
    expect(state.activeBulletId).toBe(state.bullets[0].id);
    expect(state.dope!.measurements.length).toBeGreaterThanOrEqual(3);
    expect(state.settings.tableDistancesM).toContain(100);
    expect(state.distanceM).toBe(100);
  });

  it("carries the measured range-test conditions", () => {
    const state = createSeedState();
    expect(state.weather).toEqual({ temperatureC: 15, pressureHpa: 998, humidityPct: 63 });
    expect(state.dope!.measurements.find((m) => m.distanceM === 50)?.dropMrad).toBe(0);
    expect(state.dope!.measurements.find((m) => m.distanceM === 200)?.dropMrad).toBe(-11.2);
    expect(state.dope!.bulletId).toBe(state.activeBulletId);
    expect(state.dope!.weather).toEqual(state.weather);
  });
});
