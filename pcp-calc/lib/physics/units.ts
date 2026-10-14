/**
 * Unit conversion + formatting.
 *
 * The physics engine always works in SI.  Only the presentation layer converts.
 * Distances are always entered and shown in metres (that is how PCP data is
 * taken in the field); hold-over, velocity, energy, mass and caliber follow the
 * selected unit system.
 */

export type UnitSystem = "metric" | "imperial";
export type AngularUnit = "mrad" | "moa";
export type PressureUnit = "hPa" | "kPa" | "mmHg" | "inHg" | "psi";
export type TemperatureUnit = "C" | "F";

export const MRAD_PER_MOA = (1 / 60) * (Math.PI / 180) * 1000; // 1 MOA = 1/60 degree, in mrad
export const MOA_PER_MRAD = 1 / MRAD_PER_MOA; // 3.43774677
export const DEGREE_PER_MRAD = (180 / Math.PI) / 1000;

export const INCH_PER_CM = 1 / 2.54;
export const FPS_PER_MPS = 3.280839895;
export const MPS_PER_FPS = 1 / FPS_PER_MPS;
export const FT_LBF_PER_JOULE = 0.7375621493;
export const GRAIN_PER_GRAM = 15.43235835;
export const INCH_PER_MM = 1 / 25.4;

export function mradToMoa(mrad: number): number {
  return mrad * MOA_PER_MRAD;
}
export function moaToMrad(moa: number): number {
  return moa * MRAD_PER_MOA;
}
export function mradToDegrees(mrad: number): number {
  return mrad * DEGREE_PER_MRAD;
}

/** Convert a value typed in `unit` to the canonical hPa used by the physics. */
export function pressureToHpa(value: number, unit: PressureUnit): number {
  switch (unit) {
    case "hPa":
      return value;
    case "kPa":
      return value * 10;
    case "mmHg":
      return value / 0.7500616827;
    case "inHg":
      return value / 0.0295299831;
    case "psi":
      return value / 0.0145037738;
  }
}

export function hpaToPressureUnit(hpa: number, unit: PressureUnit): number {
  switch (unit) {
    case "hPa":
      return hpa;
    case "kPa":
      return hpa / 10;
    case "mmHg":
      return hpa * 0.7500616827;
    case "inHg":
      return hpa * 0.0295299831;
    case "psi":
      return hpa * 0.0145037738;
  }
}

export function temperatureToCelsius(value: number, unit: TemperatureUnit): number {
  return unit === "C" ? value : (value - 32) * (5 / 9);
}

export function celsiusToTemperatureUnit(celsius: number, unit: TemperatureUnit): number {
  return unit === "C" ? celsius : celsius * (9 / 5) + 32;
}

export function metersToDisplayLength(meters: number, system: UnitSystem): { value: number; unit: string } {
  if (system === "metric") {
    return Math.abs(meters) >= 1
      ? { value: meters, unit: "m" }
      : { value: meters * 100, unit: "cm" };
  }
  return { value: meters * 100 * INCH_PER_CM, unit: "in" };
}

export function velocityToDisplay(mps: number, system: UnitSystem): { value: number; unit: string } {
  return system === "metric" ? { value: mps, unit: "m/s" } : { value: mps * FPS_PER_MPS, unit: "ft/s" };
}

export function energyToDisplay(joules: number, system: UnitSystem): { value: number; unit: string } {
  return system === "metric" ? { value: joules, unit: "J" } : { value: joules * FT_LBF_PER_JOULE, unit: "ft·lbf" };
}

export function massToDisplay(grams: number, system: UnitSystem): { value: number; unit: string } {
  return system === "metric" ? { value: grams, unit: "g" } : { value: grams * GRAIN_PER_GRAM, unit: "gr" };
}

export function caliberToDisplay(mm: number, system: UnitSystem): { value: number; unit: string } {
  return system === "metric" ? { value: mm, unit: "mm" } : { value: mm * INCH_PER_MM, unit: "in" };
}

/**
 * Angular value in the shooter's preferred angular unit.
 * `mrad` keeps the native value, `moa` converts it.
 */
export function angularToDisplay(mrad: number, unit: AngularUnit): { value: number; unit: string } {
  return unit === "mrad" ? { value: mrad, unit: "mrad" } : { value: mradToMoa(mrad), unit: "MOA" };
}

/**
 * How many turret clicks to dial.  `clickValue` is the click size expressed in
 * the turret's own angular unit (e.g. 0.1 mrad per click, or 0.25 MOA per click).
 */
export function clicksToDial(
  dropMrad: number,
  clickValue: number,
  clickUnit: AngularUnit,
): { clicks: number; clickValue: number; unit: string } | null {
  if (!Number.isFinite(clickValue) || clickValue <= 0) return null;
  const clickMrad = clickUnit === "mrad" ? clickValue : moaToMrad(clickValue);
  const angular = dropMrad;
  return {
    clicks: angular / clickMrad,
    clickValue,
    unit: clickUnit === "mrad" ? "mrad/click" : "MOA/click",
  };
}

export function formatFixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatSigned(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const s = value.toFixed(digits);
  return value > 0 ? `+${s}` : s;
}

export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toString();
}
