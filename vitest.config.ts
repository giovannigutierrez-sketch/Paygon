// Vitest configuration.
//
// We pass an inline (empty) PostCSS config so Vite does NOT auto-discover
// the repo-root postcss.config.js. That file (added by the UI scaffold)
// uses CommonJS module.exports while the package is ESM, and Vite's eager
// PostCSS loader chokes on it before any test runs. Test code never imports
// CSS, so an empty postcss config has no effect on test behavior.
//
// We also set test.css: false as a belt-and-braces — it instructs Vitest to
// skip CSS transformation pipelines for tests that happen to import CSS.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  test: {
    css: false,
  },
});
