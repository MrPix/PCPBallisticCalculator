/* PCP Ballistic Calculator service worker.
 *
 * Strategy:
 *   - HTML documents and Next.js navigation payloads: network-first, so an
 *     updated build is picked up as soon as there is a connection, with the
 *     cache (and finally the cached "/" shell) as the offline fallback.
 *   - Everything else same-origin (hashed JS/CSS/icons): stale-while-revalidate.
 *
 * The app itself stores all user data in localStorage and never calls a server,
 * so once the shell is cached it works with no signal at all.
 */

const VERSION = "pcp-ballistic-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const PRECACHE_ROUTES = ["/", "/bullets/", "/calibrate/", "/settings/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        PRECACHE_ROUTES.map(async (route) => {
          try {
            const response = await fetch(route, { cache: "reload" });
            if (response && response.ok) await cache.put(route, response);
          } catch {
            /* installing while offline is fine; the cache fills on first use */
          }
        }),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(url.pathname, { method: "GET" });
}

function isDocument(request, url) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) return true;
  return url.pathname.endsWith(".txt") || url.pathname.endsWith(".rsc");
}

async function networkFirst(request, allowShellFallback) {
  const cache = await caches.open(SHELL_CACHE);
  const key = cacheKey(request);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const type = response.headers.get("content-type") || "";
      if (type.includes("text/html") || type.includes("text/plain") || type.includes("javascript")) {
        await cache.put(key, response.clone());
      }
    }
    return response;
  } catch {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (allowShellFallback) {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    return new Response("Offline — this page has not been opened with a connection yet.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  const network = fetch(request, { cache: "reload" })
    .then(async (response) => {
      if (response && response.ok) await cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => undefined);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return new Response("Offline", {
    status: 504,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/__next") || url.pathname.startsWith("/__webpack")) return;

  if (isDocument(request, url)) {
    event.respondWith(networkFirst(request, true));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
