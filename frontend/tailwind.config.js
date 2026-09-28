/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        hover: 'rgb(var(--hover) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--ink-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        white: 'rgb(var(--ink) / <alpha-value>)',
        slate: {
          50: 'rgb(var(--ink) / <alpha-value>)',
          100: 'rgb(var(--ink) / <alpha-value>)',
          200: 'rgb(var(--ink) / <alpha-value>)',
          300: 'rgb(var(--ink-secondary) / <alpha-value>)',
          400: 'rgb(var(--ink-muted) / <alpha-value>)',
          500: 'rgb(var(--ink-muted) / <alpha-value>)',
          600: 'rgb(var(--ink-muted) / <alpha-value>)',
          700: 'rgb(var(--line-strong) / <alpha-value>)',
          800: 'rgb(var(--surface) / <alpha-value>)',
          900: 'rgb(var(--panel) / <alpha-value>)',
          950: 'rgb(var(--on-accent) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Monaco', 'Consolas', '"Courier New"', 'monospace'],
      },
      fontSize: {
        '2xs': '10px',
        'xs': '12px',
        'sm': '14px',
        'base': '15px',
      }
    },
  },
  plugins: [],
}
