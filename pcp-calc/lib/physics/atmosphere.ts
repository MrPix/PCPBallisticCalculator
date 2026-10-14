/**
 * Atmospheric model.
 *
 * Air density is computed from temperature, barometric pressure and relative
 * humidity using the ideal-gas law applied to a two-component mixture
 * (dry air + water vapour).  This is the same CIPAC/ITMA style approach used
 * by powder/ballistics standards bodies.
 *
 *   rho = Pd / (Rd * T) + Pv / (Rv * T)
 *
 * where Pd = P - Pv, Pv = RH * Psat(T) and T is absolute temperature in kelvin.
 */

export interface Weather {
  /** Degrees Celsius. */
  temperatureC: number;
  /** Absolute barometric pressure in hectopascal (= millibar). */
  pressureHpa: number;
  /** Relative humidity, 0..100 (%). */
  humidityPct: number;
}

export const DRY_AIR_GAS_CONSTANT = 287.052; // J/(kg*K)
export const WATER_VAPOR_GAS_CONSTANT = 461.495; // J/(kg*K)
export const ISA_SEA_LEVEL_PRESSURE_HPA = 1013.25;
export const ISA_SEA_LEVEL_TEMPERATURE_C = 15;
export const ISA_SEA_LEVEL_DENSITY_KG_M3 = 1.225;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Saturation vapour pressure of water (Pa), Magnus / Alduch-Eskandari-Kanda
 * formulation.  Valid roughly for -20 .. 100 C, which covers every realistic
 * shooting condition.  Below 0 C we use the supercooled-water curve, which is
 * what CIPAC does as well.
 */
export function saturationWaterPressurePa(temperatureC: number): number {
  return 610.78 * Math.exp((17.27 * temperatureC) / (temperatureC + 237.3));
}

export function waterVaporPressurePa(weather: Weather): number {
  const rh = clamp(weather.humidityPct, 0, 100) / 100;
  return rh * saturationWaterPressurePa(weather.temperatureC);
}

/** Density of moist air in kg/m3. */
export function airDensity(weather: Weather): number {
  const temperatureK = weather.temperatureC + 273.15;
  const pressurePa = weather.pressureHpa * 100;
  const vaporPa = waterVaporPressurePa(weather);
  const dryPa = Math.max(pressurePa - vaporPa, 0);
  return (
    dryPa / (DRY_AIR_GAS_CONSTANT * temperatureK) +
    vaporPa / (WATER_VAPOR_GAS_CONSTANT * temperatureK)
  );
}

/** Density relative to ISA sea level (a handy "thin air" multiplier). */
export function densityFactor(weather: Weather): number {
  return airDensity(weather) / ISA_SEA_LEVEL_DENSITY_KG_M3;
}

/** Approximate speed of sound (m/s) in dry air. */
export function speedOfSoundMps(temperatureC: number): number {
  return 331.3 * Math.sqrt(1 + temperatureC / 273.15);
}

export interface ValidationIssue {
  field: keyof Weather;
  message: string;
}

/** Field-level sanity checks so a typo (998 kPa typed as hPa) is caught. */
export function validateWeather(weather: Weather): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isFinite(weather.temperatureC) || weather.temperatureC < -40 || weather.temperatureC > 60) {
    issues.push({ field: "temperatureC", message: "Temperature must be between -40 and 60 °C." });
  }
  if (!Number.isFinite(weather.pressureHpa) || weather.pressureHpa < 600 || weather.pressureHpa > 1110) {
    issues.push({
      field: "pressureHpa",
      message:
        "Pressure must be between 600 and 1110 hPa (mbar). Sea level weather is 950-1040 hPa — did you enter kPa?",
    });
  }
  if (!Number.isFinite(weather.humidityPct) || weather.humidityPct < 0 || weather.humidityPct > 100) {
    issues.push({ field: "humidityPct", message: "Humidity must be between 0 and 100 %." });
  }
  return issues;
}
