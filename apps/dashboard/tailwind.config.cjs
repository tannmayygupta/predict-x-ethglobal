/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@predictx/ui/tailwind-preset")],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
};
