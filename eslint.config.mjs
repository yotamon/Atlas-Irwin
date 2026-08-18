import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Campaign detail is an async Server Component whose phase indicator is
    // intentionally evaluated at request time. The client-render purity rule
    // is not applicable to that one server-only clock read.
    files: ["app/studio/**/campaigns/*/page.tsx"],
    rules: {
      "react-hooks/purity": "off",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
