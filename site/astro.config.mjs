import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  // Static output so the site can be deployed to Cloudflare Pages, GitHub Pages
  // or any static host without a server runtime.
  output: "static",
  // Build into site/dist; root .gitignore already ignores dist/ directories.
  outDir: "./dist",
  // The site is served from the root path of its own domain.
  base: "/",
  integrations: [
    tailwind({
      // Use the same Tailwind theme tokens as the app.
      configFile: "./tailwind.config.mjs",
    }),
  ],
});
