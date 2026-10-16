/**
 * Tailwind configuration.
 *
 * Extracted verbatim from the inline `tailwind.config = { … }` that used to sit
 * in index.html and run inside the Play CDN. It is now read at build time by
 * the Tailwind CLI, which is what lets us drop the CDN entirely.
 *
 * `.cjs` rather than `.js` because package.json declares `"type": "module"`,
 * so a plain .js file here would be parsed as ESM and `module.exports` would
 * throw.
 *
 * `content` is what Tailwind scans for class names — anything referenced only
 * from JS strings will be dropped from the compiled CSS, so it must cover the
 * JSX source and the HTML shell.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./public/index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EEF0FB",
          100: "#DDE0F7",
          200: "#B9C0EF",
          500: "#7B85DC",
          600: "#5E6AD2",
          700: "#4A56C0",
          800: "#3A45A8",
          900: "#2A3284",
        },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
