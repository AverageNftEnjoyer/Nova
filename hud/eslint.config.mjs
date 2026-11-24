import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".tmp/**",
      ".tmp-validation-tests/**",
    ],
  },
  ...nextVitals,
  ...nextTypeScript,
  {
    // Electron main/preload are CommonJS by design (package "type" is not module for these files).
    files: ["electron/**/*.js", "scripts/after-pack.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
