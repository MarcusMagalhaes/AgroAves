/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff8e6',
          100: '#ffecb8',
          200: '#ffdd85',
          300: '#ffcc4d',
          400: '#ffbb1f',
          500: '#f5a600',
          600: '#d98b00',
          700: '#b06d00',
          800: '#7a4b00',
          900: '#4d2f00',
        },
        leaf: {
          50: '#eefaf0',
          100: '#d4f2da',
          200: '#a9e4b6',
          300: '#73d08b',
          400: '#3fb663',
          500: '#249a4a',
          600: '#187b3a',
          700: '#136130',
          800: '#104d28',
          900: '#0c3b1f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
