/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{html,tsx,ts}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: "#0a0e1a",
          1: "#0f1530",
          2: "#131c3d",
        },
        line: "#1c2a55",
        gold: {
          DEFAULT: "#ffc62a",
          deep: "#b78a13",
        },
        royal: "#2c4cff",
        ok: "#46d586",
        danger: "#ff5577",
        muted: "#9aa6c8",
        ink: "#e7ecff",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        gold: "0 0 0 1px #b78a13, 0 8px 24px rgba(255, 198, 42, 0.18)",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
