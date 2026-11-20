import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/agora-agent-uikit/dist/**/*.{js,mjs}",
  ],
  theme: {
  	extend: {
      // Open Sans for body and UI, Arimo for headings, Geist Mono only for
      // timestamps and codes. Numbers use tabular figures (globals.css).
      fontFamily: {
        sans: ['var(--font-open-sans)', 'system-ui', 'sans-serif'],
        heading: ['var(--font-arimo)', 'var(--font-open-sans)', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
        'headline-xl': ['var(--font-arimo)', 'sans-serif'],
        'headline-lg': ['var(--font-arimo)', 'sans-serif'],
        'headline-md': ['var(--font-arimo)', 'sans-serif'],
        'headline-sm': ['var(--font-arimo)', 'sans-serif'],
        'body-lg': ['var(--font-open-sans)', 'sans-serif'],
        'body-md': ['var(--font-open-sans)', 'sans-serif'],
        'body-sm': ['var(--font-open-sans)', 'sans-serif'],
        'label-md': ['var(--font-open-sans)', 'sans-serif'],
        'label-sm': ['var(--font-open-sans)', 'sans-serif'],
        caption: ['var(--font-open-sans)', 'sans-serif'],
      },
      // One type scale: headings 600 with slightly tight tracking, body 400.
      fontSize: {
        'headline-xl': ['34px', { lineHeight: '40px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'headline-lg': ['28px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-md': ['20px', { lineHeight: '28px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'headline-sm': ['16px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '18px', fontWeight: '400' }],
        'label-md': ['13px', { lineHeight: '16px', letterSpacing: '0', fontWeight: '500' }],
        'label-sm': ['11px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '500' }],
        caption: ['11px', { lineHeight: '14px', letterSpacing: '0.01em', fontWeight: '400' }],
      },
      // "bold" and heavier collapse to 600: no 800/900 anywhere.
      fontWeight: {
        bold: '600',
        extrabold: '600',
        black: '600',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.3)',
        DEFAULT: '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.2)',
        md: '0 1px 2px rgba(0,0,0,0.25), 0 4px 12px -4px rgba(0,0,0,0.35)',
        lg: '0 8px 24px -8px rgba(0,0,0,0.5)',
        xl: '0 16px 40px -12px rgba(0,0,0,0.6)',
        '2xl': '0 24px 64px -16px rgba(0,0,0,0.7)',
        inner: 'inset 0 1px 2px rgba(0,0,0,0.35)',
        popover: '0 0 0 1px rgba(255,255,255,0.06), 0 16px 48px -12px rgba(0,0,0,0.7)',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      spacing: {
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2rem',
        'space-2xl': '3rem',
        margin: '2rem',
        gutter: '1.5rem',
        'gutter-sm': '1rem',
        'gutter-lg': '2rem',
        'margin-mobile': '1rem',
      },
  		colors: {
        // Tatva dark palette: neutral near-black surfaces, one yellow accent (the logo's).
        surface: '#0e0e10',
        'surface-dim': '#0e0e10',
        'surface-bright': '#2e2e33',
        'surface-container-lowest': '#0a0a0b',
        'surface-container-low': '#141416',
        'surface-container': '#18181b',
        'surface-container-high': '#1f1f23',
        'surface-container-highest': '#27272b',
        'surface-variant': '#27272b',
        'surface-tint': '#fef105',
        hairline: 'rgba(255,255,255,0.07)',
        'hairline-strong': 'rgba(255,255,255,0.12)',
        'on-surface': '#ededef',
        'on-surface-variant': '#9b9ba3',
        'on-background': '#ededef',
        outline: '#6b6b74',
        'outline-variant': '#2c2c31',
        'primary-container': '#fef105',
        'on-primary': '#0a0a0a',
        'on-primary-container': '#3d3a00',
        'primary-fixed': '#fff67a',
        'primary-fixed-dim': '#e6da00',
        'on-primary-fixed': '#0a0a0a',
        'on-primary-fixed-variant': '#4a4600',
        'secondary-container': '#3a3a40',
        'on-secondary': '#26262b',
        'on-secondary-container': '#b4b4bb',
        'secondary-fixed': '#e4e4e7',
        'secondary-fixed-dim': '#c4c4ca',
        tertiary: '#b9f5d8',
        'on-tertiary': '#003824',
        'tertiary-container': '#4ade9b',
        'on-tertiary-container': '#00573a',
        'tertiary-fixed': '#5ee6a8',
        'tertiary-fixed-dim': '#3ccf8e',
        'on-tertiary-fixed': '#002113',
        'on-tertiary-fixed-variant': '#005236',
        error: '#ff8f85',
        'on-error': '#4a0004',
        'error-container': '#5c1414',
        'on-error-container': '#ffdad6',
        // The <alpha-value> placeholder enables Tailwind opacity modifiers like
        // bg-primary/90, bg-card/80, bg-destructive/10, etc.
        // Without it, hsl(var(--token)) can't accept an alpha channel at utility-class time.
  			background: '#0e0e10',
  			foreground: 'hsl(var(--foreground) / <alpha-value>)',
  			card: {
  				DEFAULT: 'hsl(var(--card) / <alpha-value>)',
  				foreground: 'hsl(var(--card-foreground) / <alpha-value>)'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
  				foreground: 'hsl(var(--popover-foreground) / <alpha-value>)'
  			},
  			primary: {
  				DEFAULT: '#fff9a8',
  				foreground: 'hsl(var(--primary-foreground) / <alpha-value>)'
  			},
  			secondary: {
  				DEFAULT: '#c7c6c6',
  				foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
  				foreground: 'hsl(var(--muted-foreground) / <alpha-value>)'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
  				foreground: 'hsl(var(--accent-foreground) / <alpha-value>)'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
  				foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)'
  			},
  			border: 'hsl(var(--border) / <alpha-value>)',
  			input: 'hsl(var(--input) / <alpha-value>)',
  			ring: 'hsl(var(--ring) / <alpha-value>)',
  			chart: {
  				'1': 'hsl(var(--chart-1) / <alpha-value>)',
  				'2': 'hsl(var(--chart-2) / <alpha-value>)',
  				'3': 'hsl(var(--chart-3) / <alpha-value>)',
  				'4': 'hsl(var(--chart-4) / <alpha-value>)',
  				'5': 'hsl(var(--chart-5) / <alpha-value>)'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background) / <alpha-value>)',
  				foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
  				primary: 'hsl(var(--sidebar-primary) / <alpha-value>)',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground) / <alpha-value>)',
  				accent: 'hsl(var(--sidebar-accent) / <alpha-value>)',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground) / <alpha-value>)',
  				border: 'hsl(var(--sidebar-border) / <alpha-value>)',
  				ring: 'hsl(var(--sidebar-ring) / <alpha-value>)'
  			}
  		},
  		borderRadius: {
  			DEFAULT: '0.25rem',
  			'2xl': '1rem',
  			xl: '0.75rem',
  			lg: '0.5rem',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
