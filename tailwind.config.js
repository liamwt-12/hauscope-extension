/** @type {import('tailwindcss').Config} */
export default {
  prefix: "hsc-",
  content: [
    "./entrypoints/**/*.{ts,tsx,html}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#f5f4f0",
        ink: "#1a1a1a",
        forest: "#2c4a3e",
        muted: "#9a9a8e",
        mint: "#b6e3c6",
        amber: "#c8963e",
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', "Georgia", "serif"],
        sans: ['"DM Sans"', "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
