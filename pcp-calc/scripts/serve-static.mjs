/**
 * Minimal static file server for the `next build` output in ./out.
 *
 * `next start` is not available when `output: "export"` is set, so this exists
 * to preview the real production bundle locally:
 *
 *   npm run build && npm run start
 *
 * Any production static host (nginx, Caddy, IIS, a NAS, `python -m http.server`)
 * can serve the same folder; this script is only a convenience.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "out");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const clean = decoded.replace(/\.\.(\/|\\|$)/g, "");
  const absolute = join(ROOT, clean);
  if (absolute !== ROOT && !absolute.startsWith(ROOT + sep)) return null;
  return absolute;
}

async function fileOrIndex(absolute) {
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) {
      const indexPath = join(absolute, "index.html");
      const indexInfo = await stat(indexPath);
      return indexInfo.isDirectory() ? null : { path: indexPath, status: 200 };
    }
    return { path: absolute, status: 200 };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const absolute = safePath(req.url ?? "/");
  const found = absolute ? await fileOrIndex(absolute) : null;

  if (!found) {
    const notFound = join(ROOT, "404.html");
    try {
      const body = await readFile(notFound);
      res.writeHead(404, { "content-type": MIME[".html"] });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
    return;
  }

  const body = await readFile(found.path);
  const extension = extname(found.path).toLowerCase();
  const headers = {
    "content-type": MIME[extension] ?? "application/octet-stream",
    "cache-control": found.path.includes(`${sep}static${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
  if (extension === ".html") headers["content-type"] = MIME[".html"];
  if (found.path.endsWith("sw.js")) headers["service-worker-allowed"] = "/";

  res.writeHead(200, headers);
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ./out at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
