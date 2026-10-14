"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Weather } from "../physics/atmosphere";
import type { DropMeasurement } from "../physics/fit";
import { createSeedState } from "../data/seed";
import {
  type AppState,
  type Bullet,
  type Settings,
} from "../data/types";
import {
  createBrowserStore,
  createId,
  loadAppState,
  saveAppState,
  sanitizeAppState,
  type KeyValueStore,
} from "../data/storage";

export type StoreAction =
  | { type: "hydrate"; state: AppState }
  | { type: "selectBullet"; id: string }
  | { type: "addBullet"; bullet: Omit<Bullet, "id" | "createdAt" | "updatedAt"> }
  | { type: "updateBullet"; id: string; patch: Partial<Omit<Bullet, "id">> }
  | { type: "duplicateBullet"; id: string }
  | { type: "deleteBullet"; id: string }
  | { type: "setWeather"; weather: Weather }
  | { type: "setSettings"; patch: Partial<Settings> }
  | { type: "setDistance"; distanceM: number }
  | { type: "setMeasurements"; measurements: DropMeasurement[] }
  | { type: "saveDope" }
  | { type: "clearDope" }
  | { type: "replaceState"; state: AppState }
  | { type: "reset" };

function nowIso(): string {
  return new Date().toISOString();
}

/** Pure state transition - the part that is unit tested. */
export function storeReducer(state: AppState, action: StoreAction): AppState {
  switch (action.type) {
    case "hydrate":
    case "replaceState":
      return action.state;
    case "reset":
      return createSeedState();
    case "selectBullet":
      return state.bullets.some((b) => b.id === action.id)
        ? { ...state, activeBulletId: action.id }
        : state;
    case "addBullet": {
      const bullet: Bullet = {
        ...action.bullet,
        id: createId(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, bullets: [...state.bullets, bullet], activeBulletId: bullet.id };
    }
    case "updateBullet": {
      const bullets = state.bullets.map((b) =>
        b.id === action.id ? { ...b, ...action.patch, id: b.id, updatedAt: nowIso() } : b,
      );
      return state.bullets.some((b) => b.id === action.id) ? { ...state, bullets } : state;
    }
    case "duplicateBullet": {
      const source = state.bullets.find((b) => b.id === action.id);
      if (!source) return state;
      const copy: Bullet = {
        ...source,
        id: createId(),
        name: `${source.name} (copy)`.slice(0, 60),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, bullets: [...state.bullets, copy], activeBulletId: copy.id };
    }
    case "deleteBullet": {
      const bullets = state.bullets.filter((b) => b.id !== action.id);
      if (bullets.length === 0) return state; // never allow an empty library
      const activeBulletId =
        state.activeBulletId === action.id ? bullets[0].id : state.activeBulletId;
      // A dope card belongs to one bullet; it must not follow the library around.
      const dope = state.dope && state.dope.bulletId === action.id ? null : state.dope;
      return { ...state, bullets, activeBulletId, dope };
    }
    case "setWeather":
      return { ...state, weather: action.weather };
    case "setSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case "setDistance":
      return { ...state, distanceM: action.distanceM };
    case "setMeasurements": {
      // Editing the drop list always restamps the card with the bullet and the
      // air you are editing it against, so a card can never silently describe
      // conditions the app is no longer showing.
      if (action.measurements.length === 0) return { ...state, dope: null };
      return {
        ...state,
        dope: {
          bulletId: state.activeBulletId,
          weather: { ...state.weather },
          measurements: action.measurements,
          savedAt: state.dope?.savedAt ?? nowIso(),
        },
      };
    }
    case "saveDope": {
      if (!state.dope) return state;
      return {
        ...state,
        dope: {
          ...state.dope,
          bulletId: state.activeBulletId,
          weather: { ...state.weather },
          savedAt: nowIso(),
        },
      };
    }
    case "clearDope":
      return state.dope === null ? state : { ...state, dope: null };
    default:
      return state;
  }
}

/**
 * External store.
 *
 * Using useSyncExternalStore instead of useState/useReducer is what makes the
 * static export hydrate cleanly: the server renders the seeded state
 * (getServerSnapshot), the browser renders the same thing for its first paint,
 * and only after hydration does localStorage replace it.
 */
export class AppStateStore {
  private state: AppState;
  private readonly seededState: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly persistTarget: KeyValueStore;
  private persistScheduled = false;
  private hydrated = false;

  constructor(persistTarget: KeyValueStore, initialState?: AppState) {
    this.persistTarget = persistTarget;
    this.seededState = initialState ?? createSeedState();
    this.state = this.seededState;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppState => this.state;

  getServerSnapshot = (): AppState => this.seededState;

  dispatch = (action: StoreAction): void => {
    const next = storeReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.schedulePersist();
    this.emit();
  };

  /** Reads localStorage once, after hydration. */
  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const stored = loadAppState(this.persistTarget);
    if (stored && stored !== this.state) {
      this.state = stored;
      this.emit();
    }
  }

  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      saveAppState(this.persistTarget, this.state);
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

interface StoreValue {
  state: AppState;
  dispatch: (action: StoreAction) => void;
  activeBullet: Bullet;
  patchActiveBullet: (patch: Partial<Omit<Bullet, "id">>) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: created once per mount, on the server it holds the seeded
  // state because localStorage is not available there.
  const [store] = useState(() => new AppStateStore(createBrowserStore()));

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    store.hydrate();
  }, [store]);

  const activeBullet = useMemo(
    () => state.bullets.find((b) => b.id === state.activeBulletId) ?? state.bullets[0],
    [state.bullets, state.activeBulletId],
  );

  const value = useMemo<StoreValue>(
    () => ({
      state,
      dispatch: store.dispatch,
      activeBullet,
      patchActiveBullet: (patch) => store.dispatch({ type: "updateBullet", id: activeBullet.id, patch }),
    }),
    [state, store, activeBullet],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useAppStore must be used inside AppStoreProvider");
  return ctx;
}

/** Validation used by the import flow before replacing the whole state. */
export function sanitizeForImport(raw: unknown): AppState | null {
  return sanitizeAppState(raw);
}
