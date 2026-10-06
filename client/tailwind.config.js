/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0B2545',
          dark: '#081C34',
          light: '#133660',
        },
        accent: {
          DEFAULT: '#1F6FEB',
          hover: '#1958BD',
          subtle: '#EBF3FE',
        },
        bg: {
          page: '#F5F7FA',
          card: '#FFFFFF',
          sidebar: '#0B2545',
        },
        border: {
          DEFAULT: '#E3E8EF',
          focus: '#1F6FEB',
        },
        text: {
          primary: '#1A2433',
          muted: '#5B6B7F',
        },
        status: {
          success: {
            DEFAULT: '#1E7F5C',
            bg: '#EAF6F0',
            border: '#BFE7D4',
          },
          warning: {
            DEFAULT: '#B7791F',
            bg: '#FEF8EA',
            border: '#F6E0A6',
          },
          error: {
            DEFAULT: '#B42318',
            bg: '#FDF2F2',
            border: '#F8C9C8',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '8px',
        lg: '8px',
      },
    },
  },
  plugins: [],
};
