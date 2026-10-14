import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Wraps the static export in `out/` in a real Android APK.
 *
 * Why this exists: the PWA route needs a secure context (HTTPS or localhost)
 * before a service worker will register, which means a server and a network on
 * the day you install it. An APK has no server and no origin to get wrong — it
 * is the file you carry into the field.
 *
 * `webDir: "out"` is the same folder `next build` produces for static hosting,
 * so one build feeds both the web deploy and the APK.
 */
const config: CapacitorConfig = {
  appId: "com.pcpballistic.calc",
  appName: "PCP Ballistic",
  webDir: "out",

  // Capacitor normally serves the app from its own local server on
  // https://localhost. Everything here is already in the APK and the app never
  // makes a network request, so let the WebView read the bundled files
  // directly instead of routing through that server.
  android: {
    webContentsDebuggingEnabled: false,
  },

  loggingBehavior: "debug",
};

export default config;
