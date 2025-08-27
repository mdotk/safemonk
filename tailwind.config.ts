import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // SafeMonk Design System
      fontFamily: {
        'sans': ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Oxygen-Sans', 'Ubuntu', 'Cantarell', '"Helvetica Neue"', 'sans-serif'],
        'mono': ['"SF Mono"', '"Menlo"', '"Consolas"', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      colors: {
        // Primary Action
        'action-green': '#00F5A0',
        
        // Neutral Charcoals (Backgrounds)
        'charcoal': {
          900: '#121217', // Main BG
          800: '#1A1B22', // Card BG
          700: '#24252D', // Input BG
          600: '#33343E', // Borders/Dividers
        },
        
        // Neutral Greys (Text & Icons)
        'grey': {
          100: '#F5F5F7', // Headings
          200: '#E1E1E6', // Subheadings
          300: '#C8C8CF', // Body Text
          500: '#8D8D93', // Subtle Text/Icons
        },
        
        // Functional Colors
        'warning-yellow': '#FFD60A',
        'info-blue': '#0A84FF',
        'danger-red': '#FF453A',
        
        // Semantic Mapping for shadcn/ui compatibility
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      spacing: {
        // Grid-based spacing system (8px base)
        '1': '8px',   // sm
        '2': '16px',  // md
        '3': '24px',  // lg
        '4': '32px',  // xl
        '6': '48px',  // 2xl
        '8': '64px',  // 3xl
      },
      maxWidth: {
        'container': '1140px',
      },
      fontSize: {
        // Custom type scale
        'h1': 'clamp(2.25rem, 5vw, 3rem)',
        'h2': 'clamp(1.5rem, 4vw, 2rem)',
        'h3': '1.25rem',
        'body': '1.0625rem', // 17px for optimal legibility
        'label': '0.875rem', // 14px
      },
      borderRadius: {
        'sharp': '6px',
        'card': '8px',
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 2px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 2px)',
      },
      transitionProperty: {
        'all': 'all',
      },
      transitionDuration: {
        '200': '0.2s',
      },
      transitionTimingFunction: {
        'ease': 'ease',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
}
export default config
