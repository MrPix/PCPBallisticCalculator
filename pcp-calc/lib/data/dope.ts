/**
 * Measured hold-over ("dope card") with the physics model as its correction term.
 *
 * A shooter's own drop measurements are the most accurate ballistic data that
 * exists for that rifle - more accurate than any fitted model, because they
 * include every error the model leaves out. The model cannot be bent to pass
 * through every measured point (a drop table that is not physically consistent
 * has no trajectory that reproduces it), so instead of trying:
 *
 *     corrected(d) = model_today(d) + residual(d)
 *     residual(d)  = measured(d) - model_reference(d)
 *
 * The model supplies the *shape* of the curve and the translation between the
 * conditions you measured in and the conditions you are shooting in today; the
 * card supplies the absolute level. At the reference weather the correction is
 * exact by construction, so the calculator reports your own numbers.
 *
 * Residuals are interpolated linearly between measured ranges and held constant
 * outside the measured span, which keeps extrapolation honest: beyond the last
 * measured range the number is the model's, shifted by the nearest measured
 * offset.
 */

import { type Weather } from "../physics/atmosphere";
import { type DropMeasurement } from "../physics/fit";
import { dropAtMrad, prepareShot, type PreparedShot } from "./shot";
import type { Bullet, DopeCard } from "./types";

export type DropKind = "measured" | "interpolated" | "extrapolated";

export interface DopeCorrection {
  distanceM: number;
  /** What the physics model says for today's air. */
  modelMrad: number;
  /** measured - model, at the conditions the card was shot in. */
  correctionMrad: number;
  /** What to actually hold/dial. */
  correctedMrad: number;
  kind: DropKind;
}

export interface DopeModel {
  bulletId: string;
  referenceWeather: Weather;
  sightHeightMm: number;
  residuals: { distanceM: number; correctionMrad: number }[];
  minM: number;
  maxM: number;
}

/** Sorted by distance, with repeated distances averaged into a single point. */
export function sortedMeasurements(list: DropMeasurement[]): DropMeasurement[] {
  const byDistance = new Map<number, { sum: number; n: number }>();
  for (const m of list) {
    if (!Number.isFinite(m.distanceM) || !Number.isFinite(m.dropMrad) || m.distanceM <= 0) continue;
    const key = Math.round(m.distanceM * 10) / 10;
    const acc = byDistance.get(key) ?? { sum: 0, n: 0 };
    acc.sum += m.dropMrad;
    acc.n += 1;
    byDistance.set(key, acc);
  }
  return [...byDistance.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([distanceM, { sum, n }]) => ({ distanceM, dropMrad: sum / n }));
}

/**
 * Turn a card + bullet into residuals. Returns null when the card cannot be
 * used (no usable rows, or the model cannot even reach the measured ranges).
 */
export function buildDopeModel(
  card: DopeCard,
  bullet: Bullet,
  sightHeightMm: number,
): DopeModel | null {
  const measurements = sortedMeasurements(card.measurements);
  if (measurements.length === 0) return null;

  const lastDistanceM = measurements[measurements.length - 1].distanceM;
  let reference: PreparedShot;
  try {
    reference = prepareShot(
      bullet,
      { weather: card.weather, sightHeightMm },
      Math.max(lastDistanceM * 1.05, lastDistanceM + 5),
    );
  } catch {
    return null;
  }

  const residuals: { distanceM: number; correctionMrad: number }[] = [];
  for (const m of measurements) {
    const predicted = dropAtMrad(reference, m.distanceM);
    if (predicted === null || !Number.isFinite(predicted)) continue;
    residuals.push({ distanceM: m.distanceM, correctionMrad: m.dropMrad - predicted });
  }
  if (residuals.length === 0) return null;

  return {
    bulletId: card.bulletId,
    referenceWeather: card.weather,
    sightHeightMm,
    residuals,
    minM: residuals[0].distanceM,
    maxM: residuals[residuals.length - 1].distanceM,
  };
}

function interpolateResidual(
  residuals: { distanceM: number; correctionMrad: number }[],
  distanceM: number,
): { correctionMrad: number; kind: DropKind } {
  const first = residuals[0];
  const last = residuals[residuals.length - 1];

  if (distanceM <= first.distanceM) {
    return {
      correctionMrad: first.correctionMrad,
      kind: distanceM === first.distanceM ? "measured" : "extrapolated",
    };
  }
  if (distanceM >= last.distanceM) {
    return {
      correctionMrad: last.correctionMrad,
      kind: distanceM === last.distanceM ? "measured" : "extrapolated",
    };
  }
  for (let i = 1; i < residuals.length; i++) {
    const prev = residuals[i - 1];
    const next = residuals[i];
    if (next.distanceM < distanceM) continue;
    const span = next.distanceM - prev.distanceM;
    if (span <= 0) return { correctionMrad: next.correctionMrad, kind: "measured" };
    const f = (distanceM - prev.distanceM) / span;
    const exact =
      Math.abs(distanceM - prev.distanceM) < 1e-9 || Math.abs(distanceM - next.distanceM) < 1e-9;
    return {
      correctionMrad: prev.correctionMrad + f * (next.correctionMrad - prev.correctionMrad),
      kind: exact ? "measured" : "interpolated",
    };
  }
  return { correctionMrad: last.correctionMrad, kind: "extrapolated" };
}

/**
 * Hold-over for a distance, using the card as the absolute reference and the
 * model as the correction between the card's weather and today's.
 */
export function correctedDrop(
  model: DopeModel,
  today: PreparedShot,
  distanceM: number,
): DopeCorrection | null {
  if (!(distanceM > 0)) return null;
  const modelMrad = dropAtMrad(today, distanceM);
  if (modelMrad === null || !Number.isFinite(modelMrad)) return null;
  const { correctionMrad, kind } = interpolateResidual(model.residuals, distanceM);
  return {
    distanceM,
    modelMrad,
    correctionMrad,
    correctedMrad: modelMrad + correctionMrad,
    kind,
  };
}

/** The raw measured value at a distance, if the card has one there. */
export function measuredDropMrad(card: DopeCard, distanceM: number): number | null {
  for (const m of sortedMeasurements(card.measurements)) {
    if (Math.abs(m.distanceM - distanceM) < 0.05) return m.dropMrad;
  }
  return null;
}

/** A card is only usable for the bullet it was shot with. */
export function cardForBullet(card: DopeCard | null, bulletId: string): DopeCard | null {
  if (!card) return null;
  if (card.bulletId !== bulletId) return null;
  if (card.measurements.length === 0) return null;
  return card;
}

export function describeWeather(weather: Weather): string {
  return `${weather.temperatureC.toFixed(0)} °C / ${weather.pressureHpa.toFixed(0)} hPa / ${weather.humidityPct.toFixed(0)} %`;
}

export const KIND_LABEL: Record<DropKind, string> = {
  measured: "measured at this range",
  interpolated: "interpolated between measured ranges",
  extrapolated: "model, shifted by the nearest measured offset",
};
