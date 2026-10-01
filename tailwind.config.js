/** @type {import('tailwindcss').Config} */
// Paleta da logomarca: vermelho #C0101E (brand) e azul-marinho #0A1F4F (leaf, cor primária)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1f2',
          100: '#ffe0e2',
          200: '#ffc5c9',
          300: '#ff9aa1',
          400: '#f55f6b',
          500: '#e02b3b',
          600: '#c0101e',
          700: '#a00c19',
          800: '#850d18',
          900: '#6e0f18',
        },
        leaf: {
          50: '#eef3fb',
          100: '#d9e3f5',
          200: '#b4c6ea',
          300: '#86a3da',
          400: '#5a7cc4',
          500: '#3a5ca6',
          600: '#27448a',
          700: '#1b3470',
          800: '#122658',
          900: '#0a1f4f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
