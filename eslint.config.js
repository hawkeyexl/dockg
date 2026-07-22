// Flat config (ESLint 10). Deliberately close to typescript-eslint's
// `recommended` — this repo's quality bar is carried by types, tests, and the
// determinism gate, so lint exists to catch the classes of mistake those miss,
// not to relitigate style. Formatting is Prettier's job; eslint-config-prettier
// switches off every rule that would fight it.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Generated, vendored, or byte-pinned. `test/fixtures` in particular holds
    // the corpus, the golden graph, and a deliberately-CRLF file — none of it
    // is source, and rewriting any of it would break the determinism gate.
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".tmp/**",
      "test/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS files run on Node and need its globals declared. TypeScript
    // sources don't: typescript-eslint's eslint-recommended turns off no-undef
    // there, because the compiler already resolves those names.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // commitlint.config.cjs is CommonJS by extension, outside the package's
    // "type": "module" default.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    files: ["**/*.ts"],
    rules: {
      // Unused args are meaningful in this codebase's interface-conforming
      // callbacks (exec seams, visitor signatures); allow the `_` convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  prettier,
);
