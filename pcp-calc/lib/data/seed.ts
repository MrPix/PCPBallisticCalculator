import {
  SEED_TIMESTAMP,
  STATE_VERSION,
  type AppState,
  type Bullet,
  type Settings,
} from "./types";
import type { Weather } from "../physics/atmosphere";

/**
 * Default data taken from the first live range test:
 * .177 (4.52 mm) 1 g slug, 280 m/s, +15 C, 998 hPa, 63 % RH, zeroed at 50 m,
 * sight height 70 mm measured with a caliper.
 *
 * The ballistic coefficient here is not a catalogue number - it was fitted to
 * the measured drop table by `fitFromDrops` with the muzzle velocity held fixed
 * and the calipered sight height used. Re-run the calibration screen to re-fit
 * it against your own measurements.
 */
export const SEED_MEASUREMENTS = [
  { distanceM: 25, dropMrad: 0.6 },
  { distanceM: 50, dropMrad: 0 },
  { distanceM: 75, dropMrad: -1.1 },
  { distanceM: 100, dropMrad: -2.9 },
  { distanceM: 125, dropMrad: -4.8 },
  { distanceM: 150, dropMrad: -7.3 },
  { distanceM: 175, dropMrad: -9.5 },
  { distanceM: 200, dropMrad: -11.2 },
];

/** Conditions those drops were shot in. Corrections are relative to this. */
export const SEED_WEATHER: Weather = { temperatureC: 15, pressureHpa: 998, humidityPct: 63 };

/** Bore centre to scope centre, measured with a caliper on this rifle. */
export const SEED_SIGHT_HEIGHT_MM = 70;

export const SEED_SETTINGS: Settings = {
  unitSystem: "metric",
  angularUnit: "mrad",
  dropSource: "measured",
  clickValue: 0.1,
  clickUnit: "mrad",
  tableDistancesM: [25, 50, 75, 100, 125, 150, 175, 200],
  maxRangeM: 250,
  sightHeightMm: SEED_SIGHT_HEIGHT_MM,
  pressureUnit: "hPa",
  temperatureUnit: "C",
};

export function createSeedBullet(timestamp = SEED_TIMESTAMP): Bullet {
  return {
    id: "slug-177-1g",
    name: ".177 1 g slug (range test)",
    caliberMm: 4.52,
    massG: 1.0,
    ballisticCoefficientKgM2: 352.8,
    muzzleVelocityMs: 280,
    zeroDistanceM: 50,
    notes:
      "BC fitted from the 2026-10-13 drop test at +15 C / 998 hPa / 63 % RH, zero 50 m, " +
      "sight height 70 mm (calipered). Fit quality: 0.25 mrad RMS against the measured table.",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createSeedState(timestamp = SEED_TIMESTAMP): AppState {
  const bullet = createSeedBullet(timestamp);
  return {
    version: STATE_VERSION,
    bullets: [bullet],
    activeBulletId: bullet.id,
    weather: { ...SEED_WEATHER },
    settings: { ...SEED_SETTINGS },
    distanceM: 100,
    dope: {
      bulletId: bullet.id,
      weather: { ...SEED_WEATHER },
      measurements: SEED_MEASUREMENTS.map((m) => ({ ...m })),
      savedAt: timestamp,
    },
  };
}
