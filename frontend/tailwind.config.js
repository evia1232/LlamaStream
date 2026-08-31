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
          highlight: '#333333',
          hover: '#1a1a1a',
          green: '#1db954',
          'green-hover': '#1ed760',
          text: '#b3b3b3',
          'text-subdued': '#a7a7a7',
          white: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Circular', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
        '3xl': ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.04em' }],
        '4xl': ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.04em' }],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        black: '900',
      },
      letterSpacing: {
        tight: '-0.04em',
        snug: '-0.02em',
        caps: '0.08em',
      },
      boxShadow: {
        card: '0 8px 24px rgba(0, 0, 0, 0.5)',
        'play-btn': '0 8px 16px rgba(0, 0, 0, 0.45)',
      },
      borderRadius: {
        spotify: '4px',
        'spotify-lg': '8px',
      },
    },
  },
  plugins: [],
};
