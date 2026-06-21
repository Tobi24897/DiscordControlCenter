/** @type {import('tailwindcss').Config} */
//
// Semantic dark-theme tokens copied verbatim from PortfolioManager so both
// tools share one design language:
//
//   surface.page      #0a0b0f   page background, outer shell
//   surface.panel     #111318   top-level panel cards
//   surface.card      #0d0e13   inset cards / list rows
//   surface.input     #1a1d29   form inputs / interactive surfaces
//   border.subtle     #2a2d3a   primary border across the dark UI
//
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          page: '#0a0b0f',
          panel: '#111318',
          card: '#0d0e13',
          input: '#1a1d29',
        },
        border: {
          subtle: '#2a2d3a',
        },
      },
    },
  },
  plugins: [],
};
