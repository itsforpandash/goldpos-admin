// Resolver hook so `node --experimental-strip-types` understands the
// tsconfig `paths` alias `@/* -> ./src/*` (provided by the Astro/Vite build) and
// the extensionless relative imports the project uses everywhere.
// Usage: node --experimental-strip-types --import ./tests/alias-hook.mjs tests/<file>.ts
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const ROOT = import.meta.dirname ? path.resolve(import.meta.dirname, "..") : process.cwd();

function tryFiles(basePath) {
  for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
    const candidate = basePath + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = tryFiles(path.join(ROOT, "src", specifier.slice(2)));
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
      const resolved = tryFiles(path.resolve(path.dirname(parentPath), specifier));
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    }
    return nextResolve(specifier, context);
  },
});
