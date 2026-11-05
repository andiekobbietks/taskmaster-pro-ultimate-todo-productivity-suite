import rootConfig from "../tailwind.config.cjs";

// Re-use the exact brand colors, fonts and spacing from the main app.
// Only the content scan path is different because the marketing site has its
// own source tree.
export default {
  ...rootConfig,
  content: [
    "./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}",
  ],
};
