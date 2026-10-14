import type { Weather } from "../physics/atmosphere";
import type { DropMeasurement } from "../physics/fit";
import type {
  AngularUnit,
  PressureUnit,
  TemperatureUnit,
  UnitSystem,
} from "../physics/units";

/** `measured` = your dope card corrected to today's air; `model` = pure physics. */
export type DropSource = "measured" | "model";

export interface Bullet {
  id: string;
  name: string;
  /** Caliber in millimetres (.177 = 4.5 mm). */
  caliberMm: number;
  /** Bullet mass in grams. */
  massG: number;
  /** Fitted ballistic coefficient, kg/m2. */
  ballisticCoefficientKgM2: number;
  /** Muzzle velocity, m/s. */
  muzzleVelocityMs: number;
  /** Zero distance, metres. */
  zeroDistanceM: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A measured dope card: hold-over the shooter actually observed, together with
 * the conditions it was observed in.
 *
 * The physics model is used for the *shape* of the trajectory and for correcting
 * it to today's air; the card is what makes the calculator agree with the target.
 */
export interface DopeCard {
  /** Bullet these drops were shot with. */
  bulletId: string;
  /** Weather at the moment they were shot - corrections are relative to this. */
  weather: Weather;
  measurements: DropMeasurement[];
  savedAt: string;
}

export interface Settings {
  unitSystem: UnitSystem;
  angularUnit: AngularUnit;
  /** Which hold-over the calculator shows as the headline number. */
  dropSource: DropSource;
  /** Turret click size in `clickUnit`; 0 disables the click helper. */
  clickValue: number;
  clickUnit: AngularUnit;
  /** Distances used by the drop table. */
  tableDistancesM: number[];
  /** How far the trajectory is integrated / charted. */
  maxRangeM: number;
  /**
   * Bore centre to sight centre, millimetres.
   *
   * A property of the rifle and scope, not of the pellet: every bullet on this
   * rifle shares one number. It is the most influential input in the model, so
   * it is measured with a caliper and entered once here.
   */
  sightHeightMm: number;
  pressureUnit: PressureUnit;
  temperatureUnit: TemperatureUnit;
}

export interface AppState {
  version: number;
  bullets: Bullet[];
  activeBulletId: string;
  weather: Weather;
  settings: Settings;
  /** Distance currently selected on the calculator. */
  distanceM: number;
  /** Measured hold-over card, or null if nothing has been measured yet. */
  dope: DopeCard | null;
}

/**
 * 1 -> 2: `measurements` became `dope`, which also records the weather and the
 * bullet the measurements belong to.
 * 2 -> 3: sight height moved from each bullet to Settings, because it belongs to
 * the rifle and scope, not to the pellet.
 * Older files are migrated on load.
 */
export const STATE_VERSION = 3;
export const STORAGE_KEY = "pcp-ballistic-calculator/state";

/**
 * Fixed on purpose: the static export prerenders the seeded state on the server
 * and the browser must render the same markup before localStorage is read,
 * otherwise hydration rewrites the whole page.
 */
export const SEED_TIMESTAMP = "2026-10-13T18:00:00.000Z";
