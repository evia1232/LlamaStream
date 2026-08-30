/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        spotify: {
          black: '#000000',
          dark: '#121212',
          gray: '#181818',
          lightgray: '#282828',
          hover: '#2a2a2a',
          green: '#1db954',
          'green-hover': '#1ed760',
          text: '#b3b3b3',
          white: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Circular', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
