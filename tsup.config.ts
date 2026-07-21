import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  dts: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
