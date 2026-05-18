import { defineConfig } from "wxt";
import { manifestConfig } from "./manifest.config";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: manifestConfig,
  srcDir: ".",
  outDir: "dist",
});
