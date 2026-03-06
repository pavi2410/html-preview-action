import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  inlineOnly: false,
  noExternal: [/.*/],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  target: "node24",
  minify: true,
});
