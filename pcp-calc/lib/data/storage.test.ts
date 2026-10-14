import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  clearAppState,
  createId,
  exportStateJson,
  importStateJson,
  loadAppState,
  loadOrSeedState,
  sanitizeAppState,
  sanitizeBullet,
  sanitizeSettings,
  sanitizeWeather,
  saveAppState,
} from "./storage";
import { STATE_VERSION, STORAGE_KEY, type AppState, type Bullet } from "./types";

function bulletFixture(overrides: Partial<Bullet> = {}): Bullet {
  return {
    id: "b1",
    name: "Test slug",
    caliberMm: 4.52,
    massG: 1,
    ballisticCoefficientKgM2: 400,
    muzzleVelocityMs: 280,
    zeroDistanceM: 50,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stateFixture(): AppState {
  return {
    version: STATE_VERSION,
    bullets: [bulletFixture()],
    activeBulletId: "b1",
    weather: { temperatureC: 12, pressureHpa: 1002, humidityPct: 40 },
    settings: {
      unitSystem: "imperial",
      angularUnit: "moa",
      dropSource: "model",
      clickValue: 0.25,
      clickUnit: "moa",
      tableDistancesM: [30, 60, 90],
      maxRangeM: 200,
      sightHeightMm: 70,
      pressureUnit: "inHg",
      temperatureUnit: "F",
    },
    distanceM: 120,
    dope: {
      bulletId: "b1",
      weather: { temperatureC: 12, pressureHpa: 1002, humidityPct: 40 },
      measurements: [{ distanceM: 100, dropMrad: -3 }],
      savedAt: "2026-01-02T00:00:00.000Z",
    },
  };
}

describe("MemoryStore", () => {
  it("gets, sets and removes", () => {
    const store = new MemoryStore();
    expect(store.get("k")).toBeNull();
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
    store.remove("k");
    expect(store.get("k")).toBeNull();
  });
});

describe("persistence", () => {
  it("round-trips the whole app state", () => {
    const store = new MemoryStore();
    const state = stateFixture();
    saveAppState(store, state);
    const loaded = loadAppState(store);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(state);
  });

  it("returns null when nothing is stored", () => {
    expect(loadAppState(new MemoryStore())).toBeNull();
  });

  it("returns null instead of throwing on corrupt JSON", () => {
    const store = new MemoryStore();
    store.set(STORAGE_KEY, "{not json");
    expect(loadAppState(store)).toBeNull();
  });

  it("falls back to the seeded state", () => {
    const state = loadOrSeedState(new MemoryStore());
    expect(state.bullets.length).toBeGreaterThan(0);
    expect(state.activeBulletId).toBe(state.bullets[0].id);
    expect(state.weather).toEqual({ temperatureC: 15, pressureHpa: 998, humidityPct: 63 });
  });

  it("clears stored state", () => {
    const store = new MemoryStore();
    saveAppState(store, stateFixture());
    clearAppState(store);
    expect(loadAppState(store)).toBeNull();
  });

  it("uses a distinct key so other apps on the same origin cannot collide", () => {
    const store = new MemoryStore();
    store.set("something-else", "x");
    saveAppState(store, stateFixture());
    expect(store.get("something-else")).toBe("x");
    expect(loadAppState(store)).not.toBeNull();
  });
});

describe("sanitisation", () => {
  it("rejects non-objects and states without bullets", () => {
    expect(sanitizeAppState(null)).toBeNull();
    expect(sanitizeAppState("hello")).toBeNull();
    expect(sanitizeAppState({ bullets: [] })).toBeNull();
    expect(sanitizeAppState({ bullets: [null, 42] })).toBeNull();
  });

  it("clamps out-of-range numbers to safe values", () => {
    const state = sanitizeAppState({
      bullets: [bulletFixture({ ballisticCoefficientKgM2: 999999, muzzleVelocityMs: -5 })],
      weather: { temperatureC: 500, pressureHpa: 998000, humidityPct: 250 },
      settings: { unitSystem: "flat-earther", angularUnit: "moa", clickValue: -1, maxRangeM: 0, sightHeightMm: 9999 },
      distanceM: -3,
    });
    expect(state).not.toBeNull();
    const bullet = state!.bullets[0];
    expect(state!.bullets.length).toBe(1);
    expect(bullet.ballisticCoefficientKgM2).toBe(6000);
    expect(bullet.muzzleVelocityMs).toBe(30);
    expect(state!.settings.sightHeightMm).toBe(150);
    expect(state!.weather.temperatureC).toBeLessThanOrEqual(60);
    expect(state!.weather.pressureHpa).toBeLessThanOrEqual(1110);
    expect(state!.weather.humidityPct).toBeLessThanOrEqual(100);
    expect(state!.settings.unitSystem).toBe("metric");
    expect(state!.settings.clickValue).toBeGreaterThanOrEqual(0);
    expect(state!.settings.maxRangeM).toBeGreaterThanOrEqual(10);
    expect(state!.distanceM).toBeGreaterThanOrEqual(1);
  });

  it("drops a bullet whose BC or velocity is not a number", () => {
    expect(sanitizeBullet(bulletFixture({ ballisticCoefficientKgM2: Number.NaN }))).toBeNull();
    expect(sanitizeBullet(bulletFixture({ muzzleVelocityMs: "not a number" as unknown as number }))).toBeNull();
    expect(sanitizeBullet(bulletFixture({ ballisticCoefficientKgM2: undefined as unknown as number }))).toBeNull();
  });

  it("fills defaults for a minimal bullet", () => {
    const bullet = sanitizeBullet({ ballisticCoefficientKgM2: 300, muzzleVelocityMs: 250 });
    expect(bullet).not.toBeNull();
    expect(bullet!.name).toBe("Untitled bullet");
    expect(bullet!.caliberMm).toBe(4.5);
    expect(bullet!.zeroDistanceM).toBe(50);
    expect(bullet!.id).toMatch(/^[a-z0-9-]+$/i);
  });

  it("de-duplicates bullet ids and repairs a dangling active bullet id", () => {
    const state = sanitizeAppState({
      bullets: [bulletFixture({ id: "dup" }), bulletFixture({ id: "dup", name: "Second" }), bulletFixture({ id: "other" })],
      activeBulletId: "does-not-exist",
    });
    expect(state!.bullets.map((b) => b.id)).toEqual(["dup", "other"]);
    expect(state!.activeBulletId).toBe("dup");
  });

  it("keeps only valid measurement rows", () => {
    const state = sanitizeAppState({
      bullets: [bulletFixture()],
      dope: {
        bulletId: "b1",
        weather: { temperatureC: 12, pressureHpa: 1002, humidityPct: 40 },
        measurements: [
          { distanceM: 100, dropMrad: -3 },
          { distanceM: "abc", dropMrad: -3 },
          { distanceM: 100, dropMrad: "x" },
          null,
        ],
      },
    });
    expect(state!.dope!.measurements).toEqual([{ distanceM: 100, dropMrad: -3 }]);
  });

  it("migrates a version 2 per-bullet sight height into Settings", () => {
    const state = sanitizeAppState({
      version: 2,
      bullets: [
        { ...bulletFixture(), id: "b1", sightHeightMm: 70 },
        { ...bulletFixture(), id: "b2", sightHeightMm: 25 },
      ],
      activeBulletId: "b1",
      settings: { unitSystem: "metric", angularUnit: "mrad", maxRangeM: 250 },
    });
    expect(state!.version).toBe(STATE_VERSION);
    // The active bullet's rig measurement wins.
    expect(state!.settings.sightHeightMm).toBe(70);
  });

  it("falls back to the first bullet's sight height when the active one has none", () => {
    const state = sanitizeAppState({
      version: 2,
      bullets: [{ ...bulletFixture(), id: "b1", sightHeightMm: 55 }],
      activeBulletId: "missing",
    });
    expect(state!.settings.sightHeightMm).toBe(55);
  });

  it("keeps a version 3 sight height from Settings untouched", () => {
    const state = sanitizeAppState({
      version: 3,
      bullets: [bulletFixture()],
      settings: { sightHeightMm: 62 },
    });
    expect(state!.settings.sightHeightMm).toBe(62);
  });

  it("migrates a version 1 measurement list into a dope card", () => {
    const state = sanitizeAppState({
      version: 1,
      bullets: [bulletFixture()],
      weather: { temperatureC: 8, pressureHpa: 1015, humidityPct: 20 },
      measurements: [
        { distanceM: 50, dropMrad: 0 },
        { distanceM: 100, dropMrad: -3.1 },
      ],
    });
    expect(state!.version).toBe(STATE_VERSION);
    expect(state!.dope).not.toBeNull();
    expect(state!.dope!.bulletId).toBe("b1");
    expect(state!.dope!.weather).toEqual({ temperatureC: 8, pressureHpa: 1015, humidityPct: 20 });
    expect(state!.dope!.measurements).toHaveLength(2);
  });

  it("drops a card that belongs to no usable bullet only by keeping it as-is", () => {
    const state = sanitizeAppState({
      bullets: [bulletFixture()],
      dope: {
        bulletId: "ghost-bullet",
        weather: { temperatureC: 12, pressureHpa: 1002, humidityPct: 40 },
        measurements: [{ distanceM: 100, dropMrad: -3 }],
        savedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    // The card survives; the UI decides it is not usable for the active bullet.
    expect(state!.dope!.bulletId).toBe("ghost-bullet");
  });

  it("has no card when there are no usable measurements", () => {
    const state = sanitizeAppState({
      bullets: [bulletFixture()],
      dope: { bulletId: "b1", measurements: [{ distanceM: "nope", dropMrad: 1 }] },
    });
    expect(state!.dope).toBeNull();
  });

  it("sanitises settings and weather independently", () => {
    expect(sanitizeSettings(undefined).unitSystem).toBe("metric");
    expect(sanitizeSettings({ tableDistancesM: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250] }).tableDistancesM).toHaveLength(24);
    expect(sanitizeSettings({ tableDistancesM: ["nope", 5000] }).tableDistancesM).toEqual([1000]);
    expect(sanitizeSettings({ tableDistancesM: [] }).tableDistancesM).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
    expect(sanitizeWeather(undefined)).toEqual({ temperatureC: 15, pressureHpa: 998, humidityPct: 63 });
  });
});

describe("import / export", () => {
  it("exports and re-imports without loss", () => {
    const state = stateFixture();
    const json = exportStateJson(state);
    const { state: restored, error } = importStateJson(json);
    expect(error).toBeNull();
    expect(restored).toEqual(state);
  });

  it("reports a readable error for bad JSON", () => {
    const { state, error } = importStateJson("not json at all");
    expect(state).toBeNull();
    expect(error).toMatch(/valid JSON/);
  });

  it("reports a readable error for JSON that has no bullets", () => {
    const { state, error } = importStateJson(JSON.stringify({ hello: "world" }));
    expect(state).toBeNull();
    expect(error).toMatch(/bullets/);
  });

  it("accepts a hand-written bullet file", () => {
    const { state, error } = importStateJson(
      JSON.stringify({ bullets: [{ name: "My slug", ballisticCoefficientKgM2: 350, muzzleVelocityMs: 290 }] }),
    );
    expect(error).toBeNull();
    expect(state!.bullets[0].name).toBe("My slug");
    expect(state!.activeBulletId).toBe(state!.bullets[0].id);
  });
});

describe("createId", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createId()));
    expect(ids.size).toBe(200);
  });
});
