/**
 * Parameter estimation: turning field measurements into a usable model.
 *
 * Most PCP shooters do not know a ballistic coefficient.  They do know how much
 * the pellet drops at a few ranges, because they just measured it on a target.
 * `fitFromDrops` inverts the trajectory model to find the BC (and optionally
 * muzzle velocity and sight height) that reproduces those measurements.
 *
 * Optimiser: damped Gauss-Newton on the drop residuals (finite-difference
 * Jacobian) followed by a bounded coordinate-descent polish.  Deterministic,
 * dependency-free, and fast enough to run on a phone the instant you type.
 */

import {
  type ShotConfig,
  type Trajectory,
  angularDropMrad,
  simulate,
  speedAtDistance,
} from "./trajectory";

export type FitParameter =
  | "ballisticCoefficientKgM2"
  | "muzzleVelocityMs"
  | "sightHeightM";

export interface DropMeasurement {
  distanceM: number;
  /** Angular drop in mrad: + = impact above point of aim, - = below. */
  dropMrad: number;
}

export interface FitResidual {
  distanceM: number;
  observedMrad: number;
  predictedMrad: number;
  errorMrad: number;
}

export interface FitResult {
  config: ShotConfig;
  residuals: FitResidual[];
  rmsMrad: number;
  meanAbsErrorMrad: number;
  maxAbsErrorMrad: number;
  iterations: number;
  success: boolean;
  message: string | null;
}

export const FIT_BOUNDS: Record<FitParameter, [number, number]> = {
  ballisticCoefficientKgM2: [10, 6000],
  muzzleVelocityMs: [30, 1500],
  sightHeightM: [0.002, 0.15],
};

const DEFAULT_FREE: FitParameter[] = ["ballisticCoefficientKgM2"];

/** Coarse integration while searching; the answer is re-checked at full accuracy. */
const SEARCH_STEP_METERS = 0.15;
const SCAN_STEP_METERS = 0.35;
const FINAL_STEP_METERS = 0.05;

interface Evaluation {
  sse: number;
  residuals: FitResidual[];
  launchAngleRad: number;
}

function evaluate(
  config: ShotConfig,
  measurements: DropMeasurement[],
  maxDistanceM: number,
  stepMeters: number,
  hint?: number,
): Evaluation | null {
  let traj: Trajectory;
  try {
    traj = simulate(config, maxDistanceM, stepMeters, hint);
  } catch {
    return null;
  }
  let sse = 0;
  const residuals: FitResidual[] = [];
  for (const m of measurements) {
    const predicted = angularDropMrad(traj, m.distanceM);
    if (predicted === null || !Number.isFinite(predicted)) return null;
    const error = predicted - m.dropMrad;
    residuals.push({
      distanceM: m.distanceM,
      observedMrad: m.dropMrad,
      predictedMrad: predicted,
      errorMrad: error,
    });
    sse += error * error;
  }
  return { sse, residuals, launchAngleRad: traj.launchAngleRad };
}

function applyParams(base: ShotConfig, free: FitParameter[], values: number[]): ShotConfig {
  const config: ShotConfig = { ...base };
  free.forEach((parameter, index) => {
    config[parameter] = values[index];
  });
  return config;
}

function clampToBounds(parameter: FitParameter, value: number): number {
  const [lo, hi] = FIT_BOUNDS[parameter];
  return Math.min(Math.max(value, lo), hi);
}

/** Gaussian elimination with partial pivoting; m is at most 3 here. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-14) return null;
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

function gaussNewton(
  start: ShotConfig,
  free: FitParameter[],
  measurements: DropMeasurement[],
  maxDistanceM: number,
): { config: ShotConfig; sse: number; iterations: number } | null {
  const m = free.length;
  let params = free.map((p) => start[p]);
  let hint: number | undefined;
  let current = evaluate(applyParams(start, free, params), measurements, maxDistanceM, SEARCH_STEP_METERS, hint);
  if (!current) return null;
  hint = current.launchAngleRad;

  let lambda = 1e-2;
  let iterations = 0;

  for (let iter = 0; iter < 40; iter++) {
    iterations++;
    const residuals = current.residuals;
    const n = residuals.length;
    if (n < m) break; // not enough information to move every parameter

    const jacobian: number[][] = residuals.map(() => new Array(m).fill(0));
    for (let i = 0; i < m; i++) {
      const h = Math.max(1e-4, Math.abs(params[i]) * 2e-3);
      const plusValue = clampToBounds(free[i], params[i] + h);
      const minusValue = clampToBounds(free[i], params[i] - h);
      const dh = plusValue - minusValue;
      if (dh === 0) return null;
      const plus = evaluate(
        applyParams(start, free, params.map((v, j) => (j === i ? plusValue : v))),
        measurements,
        maxDistanceM,
        SEARCH_STEP_METERS,
        hint,
      );
      const minus = evaluate(
        applyParams(start, free, params.map((v, j) => (j === i ? minusValue : v))),
        measurements,
        maxDistanceM,
        SEARCH_STEP_METERS,
        hint,
      );
      if (!plus || !minus) return null;
      for (let k = 0; k < n; k++) {
        jacobian[k][i] = (plus.residuals[k].predictedMrad - minus.residuals[k].predictedMrad) / dh;
      }
    }

    // Normal equations with Levenberg-Marquardt damping.
    const jtj: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    const jtr: number[] = new Array(m).fill(0);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < m; i++) {
        jtr[i] += jacobian[k][i] * residuals[k].errorMrad;
        for (let j = 0; j < m; j++) jtj[i][j] += jacobian[k][i] * jacobian[k][j];
      }
    }
    for (let i = 0; i < m; i++) jtj[i][i] *= 1 + lambda;

    const step = solveLinear(jtj, jtr.map((v) => -v));
    if (!step) break;

    const candidate = params.map((v, i) => clampToBounds(free[i], v + step[i]));
    const next = evaluate(applyParams(start, free, candidate), measurements, maxDistanceM, SEARCH_STEP_METERS, hint);
    if (next && next.sse < current.sse - 1e-12) {
      const moved = Math.max(...candidate.map((v, i) => Math.abs(v - params[i]) / Math.max(1e-6, Math.abs(v))));
      params = candidate;
      current = next;
      hint = next.launchAngleRad;
      lambda = Math.max(lambda * 0.25, 1e-10);
      if (moved < 1e-7) break;
    } else {
      lambda *= 6;
      if (lambda > 1e9) break;
    }
  }

  return { config: applyParams(start, free, params), sse: current.sse, iterations };
}

function initialStep(parameter: FitParameter, value: number): number {
  switch (parameter) {
    case "ballisticCoefficientKgM2":
      return Math.max(5, Math.abs(value) * 0.1);
    case "muzzleVelocityMs":
      return 4;
    case "sightHeightM":
      return 0.002;
  }
}

function coordinatePolish(
  start: ShotConfig,
  free: FitParameter[],
  measurements: DropMeasurement[],
  maxDistanceM: number,
): { config: ShotConfig; sse: number; iterations: number } | null {
  let best = { ...start };
  let hint: number | undefined;
  const first = evaluate(best, measurements, maxDistanceM, SEARCH_STEP_METERS, hint);
  if (!first) return null;
  let bestSse = first.sse;
  hint = first.launchAngleRad;
  let iterations = 0;

  for (let pass = 0; pass < 5; pass++) {
    let improved = false;
    for (const parameter of free) {
      const [lo, hi] = FIT_BOUNDS[parameter];
      const base = initialStep(parameter, best[parameter]);
      for (const sign of [1, -1]) {
        for (let step = base; step > base / 128; step /= 2) {
          iterations++;
          const next = best[parameter] + sign * step;
          if (next < lo || next > hi) continue;
          const candidate: ShotConfig = { ...best, [parameter]: next };
          const evaluated = evaluate(candidate, measurements, maxDistanceM, SEARCH_STEP_METERS, hint);
          if (evaluated && evaluated.sse < bestSse - 1e-12) {
            best = candidate;
            bestSse = evaluated.sse;
            hint = evaluated.launchAngleRad;
            improved = true;
            break;
          }
        }
      }
    }
    if (!improved) break;
  }

  return { config: best, sse: bestSse, iterations };
}

/** Log-spaced grid across the whole allowed range of one parameter. */
function logGrid(parameter: FitParameter, count: number): number[] {
  const [lo, hi] = FIT_BOUNDS[parameter];
  const ratio = hi / lo;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(lo * Math.pow(ratio, i / (count - 1)));
  }
  return values;
}

/**
 * Pick where to start the local optimisers.
 *
 * A cheap log-spaced scan across each free parameter finds a sane basin even
 * when the stored ballistic coefficient is wildly wrong (or missing), which is
 * exactly the situation a hand-loaded pellet starts in.
 */
function chooseStarts(
  base: ShotConfig,
  free: FitParameter[],
  measurements: DropMeasurement[],
  maxDistanceM: number,
): ShotConfig[] {
  const starts: ShotConfig[] = [{ ...base }];
  for (const parameter of free) {
    let bestStart: { config: ShotConfig; sse: number } | null = null;
    for (const value of logGrid(parameter, 16)) {
      const candidate = { ...base, [parameter]: clampToBounds(parameter, value) };
      const evaluated = evaluate(candidate, measurements, maxDistanceM, SCAN_STEP_METERS);
      if (!evaluated) continue;
      if (!bestStart || evaluated.sse < bestStart.sse) {
        bestStart = { config: candidate, sse: evaluated.sse };
      }
    }
    if (bestStart) starts.push(bestStart.config);
  }
  return starts;
}

function failedFit(base: ShotConfig, message: string, iterations = 0): FitResult {
  return {
    config: base,
    residuals: [],
    rmsMrad: Number.NaN,
    meanAbsErrorMrad: Number.NaN,
    maxAbsErrorMrad: Number.NaN,
    iterations,
    success: false,
    message,
  };
}

/**
 * Fit the shot model to measured drops.
 *
 * Only the parameters listed in `free` are adjusted; everything else is held at
 * the value the shooter measured (chronograph velocity, calipered sight height).
 * Holding at least one parameter fixed is what keeps the fit from wandering off
 * into an unphysical combination - BC and muzzle velocity trade off against each
 * other very easily when only drop data is available.
 */
export function fitFromDrops(
  base: ShotConfig,
  measurements: DropMeasurement[],
  free: FitParameter[] = DEFAULT_FREE,
): FitResult {
  const usable = measurements.filter(
    (m) => Number.isFinite(m.distanceM) && m.distanceM > 0 && Number.isFinite(m.dropMrad),
  );
  if (usable.length === 0) {
    return failedFit(base, "Enter at least one distance and drop measurement.");
  }

  const maxDistanceM = Math.max(...usable.map((m) => m.distanceM)) * 1.05;
  const freeList = free.length > 0 ? free : DEFAULT_FREE;
  const starts = chooseStarts(base, freeList, usable, maxDistanceM);

  let best: { config: ShotConfig; sse: number; iterations: number } | null = null;
  let unreachable = false;

  for (const start of starts) {
    const result = gaussNewton(start, freeList, usable, maxDistanceM);
    if (!result) {
      unreachable = true;
      continue;
    }
    if (!best || result.sse < best.sse - 1e-12) {
      best = result;
    }
  }

  // Polish the winner with a bounded coordinate descent: Gauss-Newton is fast
  // but can stall when BC and muzzle velocity trade off against each other.
  if (best) {
    const polished = coordinatePolish(best.config, freeList, usable, maxDistanceM);
    if (polished && polished.sse < best.sse - 1e-12) {
      best = {
        config: polished.config,
        sse: polished.sse,
        iterations: best.iterations + polished.iterations,
      };
    }
  }

  if (!best) {
    return failedFit(
      base,
      unreachable
        ? "The model could not reach the measured distances with these parameters. Check muzzle velocity, ballistic coefficient and zero distance."
        : "Fit failed.",
      0,
    );
  }

  const final = evaluate(best.config, usable, maxDistanceM, FINAL_STEP_METERS);
  if (!final) return failedFit(base, "Fit failed.", best.iterations);
  const n = final.residuals.length;
  return {
    config: best.config,
    residuals: final.residuals,
    rmsMrad: Math.sqrt(final.sse / n),
    meanAbsErrorMrad: final.residuals.reduce((a, r) => a + Math.abs(r.errorMrad), 0) / n,
    maxAbsErrorMrad: final.residuals.reduce((a, r) => Math.max(a, Math.abs(r.errorMrad)), 0),
    iterations: best.iterations,
    success: true,
    message: null,
  };
}

/**
 * Ballistic coefficient from two chronograph readings (muzzle + at range).
 *
 * For quadratic drag, speed decays exponentially with path length:
 * v(s) = v0 * exp(-k*s), k = rho / (2*BC).  The trajectory model is then
 * re-solved so the number matches what the calculator actually uses.
 */
export function ballisticCoefficientFromVelocity(options: {
  muzzleVelocityMps: number;
  measuredVelocityMps: number;
  distanceM: number;
  airDensityKgM3: number;
}): { ballisticCoefficientKgM2: number; message: string | null } {
  const { muzzleVelocityMps, measuredVelocityMps, distanceM, airDensityKgM3 } = options;

  if (!(muzzleVelocityMps > 0 && measuredVelocityMps > 0 && distanceM > 0)) {
    return { ballisticCoefficientKgM2: NaN, message: "Velocity and distance must be positive." };
  }
  if (measuredVelocityMps >= muzzleVelocityMps) {
    return {
      ballisticCoefficientKgM2: NaN,
      message: "The at-range velocity must be lower than the muzzle velocity.",
    };
  }

  const configFor = (bc: number): ShotConfig => ({
    muzzleVelocityMs: muzzleVelocityMps,
    ballisticCoefficientKgM2: bc,
    sightHeightM: 0.02,
    zeroDistanceM: 0.1,
    airDensityKgM3,
    gravityMps2: 9.80665,
  });

  // Speed at the measured range, for a flat shot (the launch angle of a few
  // mrad changes the path length by well under 0.1 %, so it is negligible).
  const speedAt = (bc: number): number | null =>
    speedAtDistance(configFor(bc), 0, distanceM);

  const [loBound, hiBound] = FIT_BOUNDS.ballisticCoefficientKgM2;
  const speedAtHigh = speedAt(hiBound); // least drag -> fastest arrival
  if (speedAtHigh === null || speedAtHigh < measuredVelocityMps) {
    return {
      ballisticCoefficientKgM2: hiBound,
      message: "Even a near-frictionless projectile cannot keep that much velocity. Check the readings.",
    };
  }
  const speedAtLow = speedAt(loBound);
  if (speedAtLow !== null && speedAtLow > measuredVelocityMps) {
    return {
      ballisticCoefficientKgM2: loBound,
      message: "Even the draggiest allowed projectile keeps less velocity than that. Check the readings.",
    };
  }

  let lo = loBound;
  let hi = hiBound;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = speedAt(mid);
    if (v === null || v < measuredVelocityMps) lo = mid;
    else hi = mid;
  }
  return { ballisticCoefficientKgM2: (lo + hi) / 2, message: null };
}
