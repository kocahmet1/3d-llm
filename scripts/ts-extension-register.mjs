/** Registers the extensionless-TypeScript resolver hook for audit scripts. */
import { register } from "node:module";

register("./ts-extension-loader.mjs", import.meta.url);
