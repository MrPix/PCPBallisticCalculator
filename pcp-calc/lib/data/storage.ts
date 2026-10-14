import { airDensity, type Weather } from "../physics/atmosphere";
import type { DropMeasurement } from "../physics/fit";
import { createSeedState, SEED_SETTINGS } from "./seed";
import {
  SEED_TIMESTAMP,
  STATE_VERSION,
  STORAGE_KEY,
  type AppState,
  type Bullet,
  type DopeCard,
  type Settings,
} from "./types";

/**
 * Storage is behind a tiny key/value interface so the persistence layer can be
 * unit tested without a browser and so the app can later be swapped to IndexedDB
 * or a REST backend without touching the UI.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

/** localStorage-backed store that is safe to import during server rendering. */
export function createBrowserStore(): KeyValueStore {
  const backend =
    typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined"
      ? globalThis.localStorage
      : null;
  return {
    get(key) {
      if (!backend) return null;
      try {
        return backend.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      // No localStorage (SSR, private mode, quota): the app still works from
      // the in-memory React state, it just will not survive a reload.
      if (!backend) return;
      try {
        backend.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
    remove(key) {
      if (!backend) return;
      try {
        backend.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export function createId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function str(value: unknown, fallback: string, maxLength = 120): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, maxLength);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function sanitizeBullet(raw: unknown): Bullet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const bc = num(r.ballisticCoefficientKgM2, NaN, 10, 6000);
  const velocity = num(r.muzzleVelocityMs, NaN, 30, 1500);
  if (!Number.isFinite(bc) || !Number.isFinite(velocity)) return null;
  const now = new Date().toISOString();
  return {
    id: str(r.id, createId(), 64),
    name: str(r.name, "Untitled bullet", 60),
    caliberMm: num(r.caliberMm, 4.5, 3, 12),
    massG: num(r.massG, 0.7, 0.1, 10),
    ballisticCoefficientKgM2: bc,
    muzzleVelocityMs: velocity,
    zeroDistanceM: num(r.zeroDistanceM, 50, 1, 500),
    notes: typeof r.notes === "string" ? r.notes.slice(0, 500) : "",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : now,
  };
}

export function sanitizeSettings(raw: unknown, fallbackSightHeightMm?: number): Settings {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const distancesRaw = Array.isArray(r.tableDistancesM) ? r.tableDistancesM : SEED_SETTINGS.tableDistancesM;
  const distances = distancesRaw
    .map((d) => num(d, NaN, 1, 1000))
    .filter((d) => Number.isFinite(d))
    .slice(0, 24);
  return {
    unitSystem: oneOf(r.unitSystem, ["metric", "imperial"] as const, "metric"),
    angularUnit: oneOf(r.angularUnit, ["mrad", "moa"] as const, "mrad"),
    dropSource: oneOf(r.dropSource, ["measured", "model"] as const, "measured"),
    clickValue: num(r.clickValue, SEED_SETTINGS.clickValue, 0, 10),
    clickUnit: oneOf(r.clickUnit, ["mrad", "moa"] as const, "mrad"),
    tableDistancesM: distances.length > 0 ? distances : [...SEED_SETTINGS.tableDistancesM],
    maxRangeM: num(r.maxRangeM, 250, 10, 1000),
    // Version 2 kept sight height on each bullet; the first one found is the
    // best available guess for the rig it was measured on.
    sightHeightMm: num(
      r.sightHeightMm,
      Number.isFinite(fallbackSightHeightMm) ? (fallbackSightHeightMm as number) : SEED_SETTINGS.sightHeightMm,
      2,
      150,
    ),
    pressureUnit: oneOf(r.pressureUnit, ["hPa", "kPa", "mmHg", "inHg", "psi"] as const, "hPa"),
    temperatureUnit: oneOf(r.temperatureUnit, ["C", "F"] as const, "C"),
  };
}

export function sanitizeWeather(raw: unknown): Weather {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    temperatureC: num(r.temperatureC, 15, -40, 60),
    pressureHpa: num(r.pressureHpa, 998, 600, 1110),
    humidityPct: num(r.humidityPct, 63, 0, 100),
  };
}

function sanitizeMeasurements(raw: unknown): DropMeasurement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (typeof m !== "object" || m === null) return null;
      const r = m as Record<string, unknown>;
      const distanceM = num(r.distanceM, NaN, 1, 1000);
      const dropMrad = num(r.dropMrad, NaN, -200, 200);
      if (!Number.isFinite(distanceM) || !Number.isFinite(dropMrad)) return null;
      return { distanceM, dropMrad };
    })
    .filter((m): m is DropMeasurement => m !== null)
    .slice(0, 40);
}

/** A stored dope card, or null when it holds nothing usable. */
export function sanitizeDope(raw: unknown, fallbackBulletId: string): DopeCard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const measurements = sanitizeMeasurements(r.measurements);
  if (measurements.length === 0) return null;
  return {
    bulletId: str(r.bulletId, fallbackBulletId, 64),
    weather: sanitizeWeather(r.weather),
    measurements,
    savedAt: typeof r.savedAt === "string" && r.savedAt.length > 0 ? r.savedAt : SEED_TIMESTAMP,
  };
}

/** Defensive parse: anything stored or imported is re-validated before use. */
export function sanitizeAppState(raw: unknown): AppState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const bullets = Array.isArray(r.bullets)
    ? r.bullets.map(sanitizeBullet).filter((b): b is Bullet => b !== null)
    : [];
  if (bullets.length === 0) return null;

  const activeId = str(r.activeBulletId, bullets[0].id, 64);
  const active = bullets.some((b) => b.id === activeId) ? activeId : bullets[0].id;
  const seen = new Set<string>();
  const uniqueBullets = bullets.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });

  const weather = sanitizeWeather(r.weather);

  // Version 2 stored sight height per bullet. Take the active bullet's value
  // (or the first available one) as the rig measurement.
  const legacySightHeights = Array.isArray(r.bullets)
    ? r.bullets
        .map((b) =>
          typeof b === "object" && b !== null ? Number((b as Record<string, unknown>).sightHeightMm) : NaN,
        )
        .filter((v) => Number.isFinite(v) && v >= 2 && v <= 150)
    : [];
  const legacyActiveSightHeight = Array.isArray(r.bullets)
    ? r.bullets.find(
        (b) =>
          typeof b === "object" &&
          b !== null &&
          (b as Record<string, unknown>).id === active &&
          Number.isFinite(Number((b as Record<string, unknown>).sightHeightMm)),
      )
    : undefined;
  const fallbackSightHeightMm =
    legacyActiveSightHeight !== undefined
      ? Number((legacyActiveSightHeight as Record<string, unknown>).sightHeightMm)
      : legacySightHeights[0];

  let dope = sanitizeDope(r.dope, active);
  if (!dope && Array.isArray(r.measurements)) {
    // Version 1 stored a bare measurement list with no conditions attached.
    // The stored weather is the best available guess for when they were shot.
    dope = sanitizeDope(
      { measurements: r.measurements, weather, bulletId: active, savedAt: SEED_TIMESTAMP },
      active,
    );
  }

  return {
    version: STATE_VERSION,
    bullets: uniqueBullets,
    activeBulletId: active,
    weather,
    settings: sanitizeSettings(r.settings, fallbackSightHeightMm),
    distanceM: num(r.distanceM, 100, 1, 1000),
    dope,
  };
}

export function loadAppState(store: KeyValueStore, key = STORAGE_KEY): AppState | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    return sanitizeAppState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadOrSeedState(store: KeyValueStore, key = STORAGE_KEY): AppState {
  return loadAppState(store, key) ?? createSeedState();
}

export function saveAppState(store: KeyValueStore, state: AppState, key = STORAGE_KEY): void {
  store.set(key, JSON.stringify(state));
}

export function clearAppState(store: KeyValueStore, key = STORAGE_KEY): void {
  store.remove(key);
}

export function exportStateJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importStateJson(json: string): { state: AppState | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { state: null, error: "That is not valid JSON." };
  }
  const state = sanitizeAppState(parsed);
  if (!state) return { state: null, error: "No usable bullets found in that file." };
  return { state, error: null };
}

/** Human-readable summary of the air the pellet is actually flying through. */
export function describeAir(weather: Weather): string {
  return `${airDensity(weather).toFixed(4)} kg/m3`;
}
