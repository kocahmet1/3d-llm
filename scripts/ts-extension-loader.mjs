/**
 * Tiny ESM loader so audit scripts can import the app's TypeScript modules with
 * their normal extensionless specifiers. Node strips the types itself; this
 * hook only teaches the resolver that "./processShared" means
 * "./processShared.ts".
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".mjs"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
    const target = new URL(specifier, base);
    if (!existsSync(fileURLToPath(target))) {
      for (const suffix of CANDIDATES) {
        const candidate = new URL(specifier + suffix, base);
        if (existsSync(fileURLToPath(candidate))) {
          const typescript = /\.tsx?$/.test(candidate.pathname);
          return {
            url: candidate.href,
            shortCircuit: true,
            format: typescript ? "module-typescript" : "module",
          };
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
