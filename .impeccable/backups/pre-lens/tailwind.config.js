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
        vscode: {
          titlebar: '#141414',
          activitybar: '#121212',
          sidebar: '#181818',
          editor: '#1e1e1e',
          hover: '#2a2d2e',
          selection: '#04395e',
          border: '#262626',
          borderSubtle: '#1f1f1f',
          statusbar: '#141414',
          accent: '#007acc',
          accentHover: '#0098ff',
          input: '#121212',
          textMuted: '#858585',
          textNormal: '#cccccc',
          textActive: '#ffffff',
        },
        dark: {
          50: '#0d1117',
          100: '#161b22',
          200: '#21262d',
          300: '#30363d',
          primary: '#0d1117',
          secondary: '#161b22',
        },
        light: {
          50: '#ffffff',
          100: '#f6f8fa',
          200: '#e8edf1',
          300: '#d0d7de',
          primary: '#ffffff',
          secondary: '#f6f8fa',
        },
        obsidian: {
          base: '#0d1117',
          panel: '#161b22',
          surface: '#21262d',
          subtle: '#30363d',
          border: '#30363d',
          borderSubtle: '#21262d',
        }
      },
      fontFamily: {
        sans: ['Segoe UI', 'Cairo', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Monaco', 'Consolas', '"Courier New"', 'monospace'],
      },
      fontSize: {
        '2xs': '10px',
        'xs': '11.5px',
        'sm': '12.5px',
        'base': '13.5px',
      }
    },
  },
  plugins: [],
}
