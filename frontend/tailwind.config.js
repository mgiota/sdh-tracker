/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        elastic: {
          blue:  "#0077CC",
          pink:  "#F04E98",
          green: "#00BFB3",
        },
      },
    },
  },
  plugins: [],
};
