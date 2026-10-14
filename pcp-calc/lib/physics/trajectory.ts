/**
 * Point-mass trajectory with quadratic drag.
 *
 * Coordinate frame:
 *   x - distance along the line of sight (sight line), positive downrange
 *   y - height above the line of sight
 *   the muzzle starts at (0, -sightHeightM) and is elevated by the launch
 *   angle α above the sight line.  α is solved so that the projectile crosses
 *   the sight line exactly at the zero distance.
 *
 * Drag model:
 *   a_drag = -(rho * v / (2 * BC)) * vVec        with  BC = m / (Cd * A)  [kg/m2]
 *
 * Cd is treated as constant over the (subsonic) flight of a PCP pellet or slug,
 * which is why a single fitted "BC" number reproduces measured drop tables so
 * well.  See architecture.md.
 */

import { clamp } from "./atmosphere";

export const STANDARD_GRAVITY = 9.80665; // m/s2

export interface ShotConfig {
  /** Muzzle velocity, m/s. */
  muzzleVelocityMs: number;
  /** Ballistic coefficient, kg/m2 (= mass / (dragCoefficient * crossSectionArea)). */
  ballisticCoefficientKgM2: number;
  /** Distance between the bore axis and the sight line, metres. */
  sightHeightM: number;
  /** Zero distance, metres. */
  zeroDistanceM: number;
  /** Air density, kg/m3. */
  airDensityKgM3: number;
  /** Local gravity, m/s2. */
  gravityMps2: number;
}

export interface TrajectoryPoint {
  /** Downrange distance along the sight line, m. */
  x: number;
  /** Height above the sight line, m. */
  y: number;
  /** Time since firing, s. */
  t: number;
  /** Speed, m/s. */
  v: number;
  /** Flight-path angle relative to the sight line, rad. */
  angleRad: number;
}

export interface Trajectory {
  config: ShotConfig;
  launchAngleRad: number;
  points: TrajectoryPoint[];
  /** Furthest downrange distance reached by the integration. */
  maxDistanceM: number;
  /** Where the projectile falls back to muzzle height (y = -sightHeight), or null. */
  impactDistanceM: number | null;
  /** Highest point above the sight line. */
  apex: { distanceM: number; heightM: number };
  /** Distances where the trajectory crosses the sight line (first zero, second zero). */
  zeroCrossingsM: number[];
}

export class ZeroReachableError extends Error {
  constructor(zeroDistanceM: number) {
    super(
      `The projectile cannot reach the zero distance of ${zeroDistanceM} m with these parameters. ` +
        `Lower the zero distance, raise the muzzle velocity, or raise the ballistic coefficient.`,
    );
    this.name = "ZeroReachableError";
  }
}

/** k factor of the quadratic drag law: a = -k * v * vVec. */
export function dragFactor(airDensityKgM3: number, ballisticCoefficientKgM2: number): number {
  if (ballisticCoefficientKgM2 <= 0) {
    throw new RangeError("Ballistic coefficient must be positive.");
  }
  return (0.5 * airDensityKgM3) / ballisticCoefficientKgM2;
}

export interface IntegrateOptions {
  maxDistanceM: number;
  /** Target distance covered by one integration step (adaptive time step). */
  stepMeters?: number;
  /** Simulate even when the projectile drops far below the muzzle. */
  followDrop?: boolean;
}

/**
 * Classic RK4 integration with an adaptive time step chosen from distance, so
 * accuracy is uniform along the whole trajectory (drag-dominated flight slows
 * down and needs proportionally smaller time steps).
 */
export function integrate(
  config: ShotConfig,
  launchAngleRad: number,
  options: IntegrateOptions,
): TrajectoryPoint[] {
  const { maxDistanceM, stepMeters = 0.05, followDrop = false } = options;
  const k = dragFactor(config.airDensityKgM3, config.ballisticCoefficientKgM2);
  const g = config.gravityMps2;

  let x = 0;
  let y = -config.sightHeightM;
  let t = 0;
  let vx = config.muzzleVelocityMs * Math.cos(launchAngleRad);
  let vy = config.muzzleVelocityMs * Math.sin(launchAngleRad);

  const points: TrajectoryPoint[] = [
    { x, y, t, v: config.muzzleVelocityMs, angleRad: launchAngleRad },
  ];

  const floorY = -config.sightHeightM - (followDrop ? 1000 : 5);

  for (let guard = 0; guard < 500_000; guard++) {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.5) break;
    const dt = Math.min(stepMeters / speed, 0.002);

    const accel = (ax: number, ay: number): [number, number] => {
      const s = Math.hypot(ax, ay);
      return [-k * s * ax, -g - k * s * ay];
    };

    const a1 = accel(vx, vy);
    const a2 = accel(vx + (a1[0] * dt) / 2, vy + (a1[1] * dt) / 2);
    const a3 = accel(vx + (a2[0] * dt) / 2, vy + (a2[1] * dt) / 2);
    const a4 = accel(vx + a3[0] * dt, vy + a3[1] * dt);

    const dx = (dt * (vx + 2 * (vx + (a1[0] * dt) / 2) + 2 * (vx + (a2[0] * dt) / 2) + (vx + a3[0] * dt))) / 6;
    const dy = (dt * (vy + 2 * (vy + (a1[1] * dt) / 2) + 2 * (vy + (a2[1] * dt) / 2) + (vy + a3[1] * dt))) / 6;

    x += dx;
    y += dy;
    vx += (dt * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0])) / 6;
    vy += (dt * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1])) / 6;
    t += dt;

    const v = Math.hypot(vx, vy);
    points.push({ x, y, t, v, angleRad: Math.atan2(vy, vx) });

    if (x >= maxDistanceM) break;
    if (y < floorY) break;
  }

  return points;
}

export function interpolateAt(points: TrajectoryPoint[], distanceM: number): TrajectoryPoint | null {
  if (points.length === 0) return null;
  if (distanceM <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= distanceM) {
      const prev = points[i - 1];
      const next = points[i];
      const span = next.x - prev.x;
      const f = span > 0 ? (distanceM - prev.x) / span : 0;
      return {
        x: distanceM,
        y: prev.y + f * (next.y - prev.y),
        t: prev.t + f * (next.t - prev.t),
        v: prev.v + f * (next.v - prev.v),
        angleRad: prev.angleRad + f * (next.angleRad - prev.angleRad),
      };
    }
  }
  return null;
}

/** Height above the sight line at a given downrange distance (null if never reached). */
export function heightAt(points: TrajectoryPoint[], distanceM: number): number | null {
  const p = interpolateAt(points, distanceM);
  return p ? p.y : null;
}

/**
 * Launch angle (rad above the sight line) that makes the projectile cross the
 * sight line at the zero distance.
 *
 * y(zero; alpha) is monotonic and almost linear in alpha, so a bracketed secant
 * iteration converges in a handful of trajectory evaluations.  A bisection step
 * is used whenever the secant guess leaves the bracket, which keeps the method
 * safe for absurd inputs.
 */
export function solveLaunchAngle(config: ShotConfig, hintRad?: number): number {
  const z = Math.max(config.zeroDistanceM, 0.1);
  const heightAtZero = (alpha: number): number | null =>
    heightAt(integrate(config, alpha, { maxDistanceM: z + 0.5 }), z);

  // Vacuum estimate: good to a few mrad, and drag always pushes the real angle up.
  // When the caller is iterating (calibration), it passes the angle it used last
  // time, which turns this into a 3-4 evaluation problem instead of 10.
  const dropAtZero =
    (0.5 * config.gravityMps2 * z * z) / (config.muzzleVelocityMs * config.muzzleVelocityMs);
  const estimate =
    Number.isFinite(hintRad) && (hintRad as number) > -1
      ? (hintRad as number)
      : Math.atan2(config.sightHeightM + dropAtZero, z);

  let a = estimate - 0.005;
  let b = estimate + 0.005;
  // "did not reach the zero distance" is treated as "below the sight line".
  let fa = heightAtZero(a) ?? -1;
  let fb = heightAtZero(b) ?? -1;

  // Push the upper end up until the zero distance is actually reached and crossed.
  for (let attempt = 0; attempt < 60; attempt++) {
    if (fb >= 0) break;
    a = b;
    fa = fb;
    b = b + 0.02;
    fb = heightAtZero(b) ?? -1;
    if (b > 1.5) break;
  }
  if (fb < 0) {
    throw new ZeroReachableError(config.zeroDistanceM);
  }
  // Pull the lower end down if even it overshoots.
  for (let attempt = 0; attempt < 60 && fa > 0; attempt++) {
    b = a;
    fb = fa;
    a = a - 0.02;
    fa = heightAtZero(a) ?? -1;
  }

  for (let i = 0; i < 40; i++) {
    if (Math.abs(b - a) < 1e-11) break;
    const secant = fa === fb ? (a + b) / 2 : (a * fb - b * fa) / (fb - fa);
    const inside = secant > a && secant < b;
    const alpha = inside ? secant : (a + b) / 2;
    const value = heightAtZero(alpha) ?? -1;
    if (value < 0) {
      a = alpha;
      fa = value;
    } else {
      b = alpha;
      fb = value;
    }
  }
  return (a + b) / 2;
}

function collectZeroCrossings(points: TrajectoryPoint[]): number[] {
  const crossings: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (prev.y < 0 !== next.y < 0) {
      const f = prev.y / (prev.y - next.y);
      crossings.push(prev.x + f * (next.x - prev.x));
    }
  }
  return crossings;
}

export function simulate(
  config: ShotConfig,
  maxDistanceM: number,
  stepMeters = 0.05,
  launchAngleHint?: number,
): Trajectory {
  const safeConfig: ShotConfig = {
    ...config,
    sightHeightM: Math.max(config.sightHeightM, 0),
    zeroDistanceM: Math.max(config.zeroDistanceM, 0.1),
  };
  const launchAngleRad = solveLaunchAngle(safeConfig, launchAngleHint);
  const points = integrate(safeConfig, launchAngleRad, {
    maxDistanceM,
    stepMeters,
    followDrop: true,
  });

  let apex = { distanceM: 0, heightM: -safeConfig.sightHeightM };
  for (const p of points) {
    if (p.y > apex.heightM) apex = { distanceM: p.x, heightM: p.y };
  }

  let impactDistanceM: number | null = null;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y <= -safeConfig.sightHeightM) {
      const prev = points[i - 1];
      const next = points[i];
      const f = prev.y === next.y ? 0 : (prev.y + safeConfig.sightHeightM) / (prev.y - next.y);
      impactDistanceM = prev.x + f * (next.x - prev.x);
      break;
    }
  }

  return {
    config: safeConfig,
    launchAngleRad,
    points,
    maxDistanceM: points.length ? points[points.length - 1].x : 0,
    impactDistanceM,
    apex,
    zeroCrossingsM: collectZeroCrossings(points),
  };
}

export function sample(traj: Trajectory, distanceM: number): TrajectoryPoint | null {
  return interpolateAt(traj.points, distanceM);
}

/** Speed at a downrange distance for a given launch angle (used by calibration). */
export function speedAtDistance(
  config: ShotConfig,
  launchAngleRad: number,
  distanceM: number,
): number | null {
  const points = integrate(config, launchAngleRad, {
    maxDistanceM: distanceM + 0.5,
    followDrop: true,
  });
  const p = interpolateAt(points, distanceM);
  return p ? p.v : null;
}

/**
 * Angular drop in milliradian, measured from the sight line.
 * Positive = impact ABOVE the point of aim, negative = below.
 * This is exactly the number a shooter dials on an elevation turret.
 */
export function angularDropMrad(traj: Trajectory, distanceM: number): number | null {
  const p = sample(traj, distanceM);
  if (!p || distanceM <= 0) return null;
  return (p.y / distanceM) * 1000;
}

/** Linear offset of the impact from the point of aim, metres (+ = above). */
export function linearDropM(traj: Trajectory, distanceM: number): number | null {
  const p = sample(traj, distanceM);
  return p ? p.y : null;
}

export interface DropRow {
  distanceM: number;
  dropMrad: number;
  dropLinearM: number;
  velocityMps: number;
  energyJ: number;
  timeOfFlightS: number;
  flightAngleMrad: number;
  reached: boolean;
}

export function dropTable(traj: Trajectory, distancesM: number[], massKg: number): DropRow[] {
  return distancesM.map((distanceM) => {
    const p = sample(traj, distanceM);
    if (!p) {
      return {
        distanceM,
        dropMrad: Number.NaN,
        dropLinearM: Number.NaN,
        velocityMps: Number.NaN,
        energyJ: Number.NaN,
        timeOfFlightS: Number.NaN,
        flightAngleMrad: Number.NaN,
        reached: false,
      };
    }
    return {
      distanceM,
      dropMrad: (p.y / distanceM) * 1000,
      dropLinearM: p.y,
      velocityMps: p.v,
      energyJ: 0.5 * massKg * p.v * p.v,
      timeOfFlightS: p.t,
      flightAngleMrad: p.angleRad * 1000,
      reached: true,
    };
  });
}

export function clampDistance(distanceM: number): number {
  return clamp(distanceM, 0.1, 2000);
}
