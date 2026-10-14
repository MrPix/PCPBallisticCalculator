import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The generated Android project. It holds no source we maintain - only
    // Gradle files and a copy of ./out - and ESLint would otherwise lint
    // Next's own minified chunks twice over.
    "android/**",
  ]),
]);

export default eslintConfig;
