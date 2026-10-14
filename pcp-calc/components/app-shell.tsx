"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AppStoreProvider, useAppStore } from "@/lib/state/app-store";

const TABS = [
  { href: "/", label: "Calculator", short: "Calc" },
  { href: "/bullets", label: "Bullets", short: "Bullets" },
  { href: "/calibrate", label: "Calibrate", short: "Fit" },
  { href: "/settings", label: "Settings", short: "Setup" },
];

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Capacitor injects `window.Capacitor` into the WebView before any page script
 * runs, so this is safe to call from an effect. It is deliberately a property
 * probe rather than an import of `@capacitor/core`: the browser build should
 * not carry the native bridge just to answer one question.
 */
function isNativeApp(): boolean {
  const bridge = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return bridge?.isNativePlatform?.() === true;
}

/**
 * `navigator.onLine` is a live value rather than state, and subscribing to it is
 * the API React provides for exactly that. The server snapshot is `true` because
 * a prerendered page cannot know what the device will do later.
 */
function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * True only inside the Capacitor WebView. The server snapshot is false so the
 * prerendered markup is the same as the browser build, and React re-reads the
 * client snapshot when it hydrates.
 */
function useNativeShell(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => isNativeApp(),
    () => false,
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppStoreProvider>
      <Shell>{children}</Shell>
    </AppStoreProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activePath = normalizePath(pathname);
  const { state } = useAppStore();
  // In the APK the app is already on the device and never talks to a server, so
  // navigator.onLine - which Android WebView reports unreliably - would only
  // produce a pill that says the wrong thing.
  const native = useNativeShell();
  const online = useOnlineStatus();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (isNativeApp()) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* offline support is a bonus, never a failure */
    });
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-fg">
              PCP Ballistic Calculator
            </p>
            <p className="nums truncate text-xs text-muted">
              {state.bullets.find((b) => b.id === state.activeBulletId)?.name ?? ""}
              {" · "}
              {state.weather.temperatureC.toFixed(0)} °C · {state.weather.pressureHpa.toFixed(0)} hPa ·{" "}
              {state.weather.humidityPct.toFixed(0)} %
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${
              native
                ? "border-accent/40 bg-accent/10 text-accent"
                : online
                  ? "border-line text-muted"
                  : "border-warn/50 bg-warn/10 text-warn"
            }`}
          >
            {native ? "on device" : online ? "online" : "offline"}
          </span>
        </div>
        <nav className="mx-auto hidden max-w-4xl gap-1 px-4 pb-2 md:flex">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                activePath === normalizePath(tab.href) ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-4">{children}</main>

      <nav
        className="safe-bottom sticky bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur md:hidden"
        aria-label="Sections"
      >
        <div className="mx-auto grid max-w-4xl grid-cols-4 gap-1 px-2 pt-2">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={activePath === normalizePath(tab.href) ? "page" : undefined}
              className={`min-h-11 rounded-xl px-2 text-center text-xs font-medium ${
                activePath === normalizePath(tab.href) ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
              }`}
            >
              {tab.short}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
