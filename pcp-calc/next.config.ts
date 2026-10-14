import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The whole app is client-side physics + localStorage, so it builds to a
  // folder of static files that can be served by anything (nginx, Caddy, IIS,
  // a phone, a NAS) and needs no Node process at runtime.
  //
  // `output: "export"` is incompatible with Cache Components / PPR, which is
  // why those flags from the create-next-app template are not used here.
  output: "export",

  // Emits /bullets/index.html instead of /bullets.html so that any static
  // file server (nginx, Caddy, IIS, `python -m http.server`) resolves it
  // without custom rewrite rules.
  trailingSlash: true,

  experimental: {
    agentFeedback: true,
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
