import { describe, expect, it } from "vitest";
import { createSeedState } from "../data/seed";
import { MemoryStore, saveAppState } from "../data/storage";
import { STATE_VERSION } from "../data/types";
import { AppStateStore, storeReducer } from "./app-store";

const seed = () => createSeedState();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AppStateStore", () => {
  it("starts from the seeded state and persists every dispatch", async () => {
    const store = new MemoryStore();
    const app = new AppStateStore(store);
    expect(app.getSnapshot().bullets).toHaveLength(1);

    app.dispatch({ type: "setDistance", distanceM: 120 });
    await flush();

    expect(app.getSnapshot().distanceM).toBe(120);
    const reloaded = new AppStateStore(store);
    reloaded.hydrate();
    expect(reloaded.getSnapshot().distanceM).toBe(120);
  });

  it("keeps serving the seeded snapshot to the server renderer", () => {
    const app = new AppStateStore(new MemoryStore());
    const serverSnapshot = app.getServerSnapshot();
    app.dispatch({ type: "setDistance", distanceM: 300 });
    expect(app.getServerSnapshot()).toBe(serverSnapshot);
    expect(app.getServerSnapshot().distanceM).toBe(100);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const app = new AppStateStore(new MemoryStore());
    let calls = 0;
    const unsubscribe = app.subscribe(() => {
      calls += 1;
    });
    app.dispatch({ type: "setDistance", distanceM: 111 });
    expect(calls).toBe(1);
    unsubscribe();
    app.dispatch({ type: "setDistance", distanceM: 112 });
    expect(calls).toBe(1);
  });

  it("does not notify when an action changes nothing", () => {
    const app = new AppStateStore(new MemoryStore());
    let calls = 0;
    app.subscribe(() => {
      calls += 1;
    });
    app.dispatch({ type: "selectBullet", id: "does-not-exist" });
    expect(calls).toBe(0);
  });

  it("hydrates once from stored state", () => {
    const store = new MemoryStore();
    const saved = { ...seed(), distanceM: 175 };
    saveAppState(store, saved);

    const app = new AppStateStore(store);
    expect(app.getSnapshot().distanceM).toBe(100); // seeded until hydrated

    let calls = 0;
    app.subscribe(() => {
      calls += 1;
    });

    app.hydrate();
    app.hydrate();
    expect(app.getSnapshot().distanceM).toBe(175);
    expect(calls).toBe(1);
  });

  it("survives a corrupt stored blob without losing the session", () => {
    const store = new MemoryStore();
    store.set("pcp-ballistic-calculator/state", "{{{ not json");
    const app = new AppStateStore(store);
    app.hydrate();
    expect(app.getSnapshot().bullets).toHaveLength(1);
  });
});

describe("store reducer", () => {
  it("adds a bullet and makes it active", () => {
    const state = storeReducer(seed(), {
      type: "addBullet",
      bullet: {
        name: "H&N Baracuda",
        caliberMm: 4.52,
        massG: 0.69,
        ballisticCoefficientKgM2: 180,
        muzzleVelocityMs: 265,
        zeroDistanceM: 30,
        notes: "",
      },
    });
    expect(state.bullets).toHaveLength(2);
    expect(state.activeBulletId).toBe(state.bullets[1].id);
    expect(state.bullets[1].name).toBe("H&N Baracuda");
    expect(state.bullets[1].createdAt).toMatch(/T/);
  });

  it("patches a bullet without changing its id", () => {
    const state0 = seed();
    const id = state0.activeBulletId;
    const state = storeReducer(state0, {
      type: "updateBullet",
      id,
      patch: { ballisticCoefficientKgM2: 512, muzzleVelocityMs: 291 },
    });
    expect(state.bullets[0].id).toBe(id);
    expect(state.bullets[0].ballisticCoefficientKgM2).toBe(512);
    expect(state.bullets[0].muzzleVelocityMs).toBe(291);
    expect(state.bullets[0].name).toBe(state0.bullets[0].name);
  });

  it("ignores an update to a bullet that no longer exists", () => {
    const state = storeReducer(seed(), { type: "updateBullet", id: "ghost", patch: { massG: 2 } });
    expect(state.bullets[0].massG).toBe(1);
  });

  it("duplicates a bullet with a fresh id", () => {
    const state0 = seed();
    const state = storeReducer(state0, { type: "duplicateBullet", id: state0.activeBulletId });
    expect(state.bullets).toHaveLength(2);
    expect(state.bullets[1].id).not.toBe(state0.activeBulletId);
    expect(state.bullets[1].ballisticCoefficientKgM2).toBe(state0.bullets[0].ballisticCoefficientKgM2);
    expect(state.bullets[1].name).toMatch(/copy/);
    expect(state.activeBulletId).toBe(state.bullets[1].id);
  });

  it("deletes a bullet and re-points the active id", () => {
    let state = storeReducer(seed(), {
      type: "addBullet",
      bullet: {
        name: "Second",
        caliberMm: 4.5,
        massG: 0.55,
        ballisticCoefficientKgM2: 120,
        muzzleVelocityMs: 300,
        zeroDistanceM: 25,
        notes: "",
      },
    });
    const firstId = state.bullets[0].id;
    state = storeReducer(state, { type: "deleteBullet", id: firstId });
    expect(state.bullets).toHaveLength(1);
    expect(state.activeBulletId).toBe(state.bullets[0].id);
  });

  it("never allows the library to become empty", () => {
    const state0 = seed();
    const state = storeReducer(state0, { type: "deleteBullet", id: state0.activeBulletId });
    expect(state.bullets).toHaveLength(1);
    expect(state.activeBulletId).toBe(state0.activeBulletId);
  });

  it("ignores selecting an unknown bullet", () => {
    const state0 = seed();
    const state = storeReducer(state0, { type: "selectBullet", id: "nope" });
    expect(state.activeBulletId).toBe(state0.activeBulletId);
  });

  it("merges partial settings", () => {
    const state = storeReducer(seed(), { type: "setSettings", patch: { angularUnit: "moa" } });
    expect(state.settings.angularUnit).toBe("moa");
    expect(state.settings.unitSystem).toBe("metric");
    expect(state.settings.tableDistancesM).toEqual(
      seed().settings.tableDistancesM,
    );
  });

  it("stores distance and measurements", () => {
    let state = storeReducer(seed(), { type: "setDistance", distanceM: 137 });
    expect(state.distanceM).toBe(137);
    state = storeReducer(state, {
      type: "setMeasurements",
      measurements: [{ distanceM: 100, dropMrad: -3.4 }],
    });
    expect(state.dope!.measurements).toEqual([{ distanceM: 100, dropMrad: -3.4 }]);
    expect(state.dope!.bulletId).toBe(state.activeBulletId);
    expect(state.dope!.weather).toEqual(state.weather);
  });

  it("clears the card when every measurement row is removed", () => {
    const state = storeReducer(seed(), { type: "setMeasurements", measurements: [] });
    expect(state.dope).toBeNull();
  });

  it("stamps the card with the current weather and bullet on save", () => {
    let state = storeReducer(seed(), { type: "setWeather", weather: { temperatureC: 2, pressureHpa: 1025, humidityPct: 90 } });
    state = storeReducer(state, { type: "saveDope" });
    expect(state.dope!.weather).toEqual({ temperatureC: 2, pressureHpa: 1025, humidityPct: 90 });
    expect(state.dope!.bulletId).toBe(state.activeBulletId);
  });

  it("clears a card and drops it with its bullet", () => {
    const state0 = seed();
    const cleared = storeReducer(state0, { type: "clearDope" });
    expect(cleared.dope).toBeNull();
    expect(storeReducer(cleared, { type: "clearDope" })).toBe(cleared);

    const withCard = storeReducer(state0, {
      type: "setMeasurements",
      measurements: [{ distanceM: 100, dropMrad: -3 }],
    });
    const added = storeReducer(withCard, {
      type: "addBullet",
      bullet: { name: "Second", caliberMm: 4.5, massG: 0.9, ballisticCoefficientKgM2: 300, muzzleVelocityMs: 260, zeroDistanceM: 50, notes: "" },
    });
    // The card followed the bullet that was active when it was edited.
    expect(added.dope!.bulletId).toBe(withCard.activeBulletId);
    const deleted = storeReducer(added, { type: "deleteBullet", id: withCard.activeBulletId });
    expect(deleted.bullets.map((b) => b.id)).toEqual([added.activeBulletId]);
    expect(deleted.dope).toBeNull();

    // Deleting the only bullet is refused, so a card can never orphan itself.
    expect(storeReducer(withCard, { type: "deleteBullet", id: withCard.activeBulletId }).dope).not.toBeNull();
  });

  it("replaces the whole state on import", () => {
    const imported = { ...seed(), version: STATE_VERSION, distanceM: 60 };
    const state = storeReducer(seed(), { type: "replaceState", state: imported });
    expect(state.distanceM).toBe(60);
  });

  it("resets to the seeded state", () => {
    let state = storeReducer(seed(), { type: "setDistance", distanceM: 7 });
    state = storeReducer(state, { type: "updateBullet", id: state.activeBulletId, patch: { massG: 3 } });
    state = storeReducer(state, { type: "reset" });
    expect(state).toEqual(seed());
  });
});
