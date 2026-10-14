import { airDensity, speedOfSoundMps, type Weather } from "../physics/atmosphere";
import {
  STANDARD_GRAVITY,
  type DropRow,
  type ShotConfig,
  type Trajectory,
  angularDropMrad,
  dropTable,
  sample,
  simulate,
} from "../physics/trajectory";
import type { Bullet } from "./types";

export function crossSectionAreaM2(caliberMm: number): number {
  const d = caliberMm / 1000;
  return (Math.PI / 4) * d * d;
}

export interface ShotEnvironment {
  /** Air the pellet flies through today. */
  weather: Weather;
  /** Bore centre to sight centre, millimetres — a property of the rig. */
  sightHeightMm: number;
}

/**
 * Bullet + rig + weather -> the SI configuration the integrator consumes.
 *
 * Sight height is deliberately part of the environment rather than the bullet:
 * it is the distance between the scope and the bore, which is the same for every
 * pellet you put in this rifle.
 */
export function toShotConfig(bullet: Bullet, env: ShotEnvironment): ShotConfig {
  return {
    muzzleVelocityMs: bullet.muzzleVelocityMs,
    ballisticCoefficientKgM2: bullet.ballisticCoefficientKgM2,
    sightHeightM: env.sightHeightMm / 1000,
    zeroDistanceM: bullet.zeroDistanceM,
    airDensityKgM3: airDensity(env.weather),
    gravityMps2: STANDARD_GRAVITY,
  };
}

/** Drag coefficient implied by the fitted BC - a useful physical sanity check. */
export function impliedDragCoefficient(bullet: Bullet): number {
  const area = crossSectionAreaM2(bullet.caliberMm);
  if (area <= 0) return Number.NaN;
  return bullet.massG / 1000 / (area * bullet.ballisticCoefficientKgM2);
}

export interface PreparedShot {
  bullet: Bullet;
  weather: Weather;
  sightHeightMm: number;
  config: ShotConfig;
  trajectory: Trajectory;
  airDensityKgM3: number;
  speedOfSoundMps: number;
}

export function prepareShot(
  bullet: Bullet,
  env: ShotEnvironment,
  maxRangeM: number,
): PreparedShot {
  const config = toShotConfig(bullet, env);
  const trajectory = simulate(config, maxRangeM);
  return {
    bullet,
    weather: env.weather,
    sightHeightMm: env.sightHeightMm,
    config,
    trajectory,
    airDensityKgM3: config.airDensityKgM3,
    speedOfSoundMps: speedOfSoundMps(env.weather.temperatureC),
  };
}

export interface ShotSummary {
  distanceM: number;
  reached: boolean;
  dropMrad: number;
  dropM: number;
  velocityMps: number;
  energyJ: number;
  mach: number;
  timeOfFlightS: number;
  flightAngleMrad: number;
}

export function summarizeShot(
  shot: PreparedShot,
  distanceM: number,
): ShotSummary {
  const point = sample(shot.trajectory, distanceM);
  if (!point) {
    return {
      distanceM,
      reached: false,
      dropMrad: Number.NaN,
      dropM: Number.NaN,
      velocityMps: Number.NaN,
      energyJ: Number.NaN,
      mach: Number.NaN,
      timeOfFlightS: Number.NaN,
      flightAngleMrad: Number.NaN,
    };
  }
  return {
    distanceM,
    reached: true,
    dropMrad: (point.y / distanceM) * 1000,
    dropM: point.y,
    velocityMps: point.v,
    energyJ: 0.5 * shot.bullet.massG * 0.001 * point.v * point.v,
    mach: point.v / shot.speedOfSoundMps,
    timeOfFlightS: point.t,
    flightAngleMrad: point.angleRad * 1000,
  };
}

export function dropAtMrad(shot: PreparedShot, distanceM: number): number | null {
  return angularDropMrad(shot.trajectory, distanceM);
}

export function buildRows(shot: PreparedShot, distancesM: number[]): DropRow[] {
  return dropTable(shot.trajectory, distancesM, shot.bullet.massG);
}
