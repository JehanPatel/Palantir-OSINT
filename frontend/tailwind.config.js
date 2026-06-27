/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dark: {
          900: "#0a0a0f",
          800: "#111118",
          700: "#1a1a25",
          600: "#252535",
          500: "#353550",
        },
        accent: {
          DEFAULT: "#00e5a0",
          glow: "#00e5a040",
          dim: "#00b87a",
        },
        cyber: {
          blue: "#4fc3f7",
          red: "#ff5252",
          amber: "#ffd740",
          purple: "#b388ff",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
    },
  },
  plugins: [],
};
