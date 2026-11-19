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
      fontFamily: {
        sans: ['Inter', 'var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
        // Stitch "Studio Obsidian" type roles
        'headline-xl': ['Manrope', 'sans-serif'],
        'headline-lg': ['Manrope', 'sans-serif'],
        'headline-md': ['Manrope', 'sans-serif'],
        'headline-sm': ['Manrope', 'sans-serif'],
        'body-lg': ['Inter', 'sans-serif'],
        'body-md': ['Inter', 'sans-serif'],
        'body-sm': ['Inter', 'sans-serif'],
        'label-md': ['Inter', 'sans-serif'],
        'label-sm': ['Inter', 'sans-serif'],
        caption: ['Inter', 'sans-serif'],
      },
      fontSize: {
        'headline-xl': ['40px', { lineHeight: '48px', letterSpacing: '-0.03em', fontWeight: '800' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['22px', { lineHeight: '28px', letterSpacing: '-0.015em', fontWeight: '700' }],
        'headline-sm': ['18px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'label-md': ['13px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '600' }],
        'label-sm': ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '700' }],
        caption: ['10px', { lineHeight: '12px', letterSpacing: '0.04em', fontWeight: '500' }],
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
        // Stitch "Studio Obsidian" palette (dark). Names match the design HTML.
        surface: '#131313',
        'surface-dim': '#131313',
        'surface-bright': '#3a3939',
        'surface-container-lowest': '#0e0e0e',
        'surface-container-low': '#1c1b1b',
        'surface-container': '#201f1f',
        'surface-container-high': '#2a2a2a',
        'surface-container-highest': '#353534',
        'surface-variant': '#353534',
        'surface-tint': '#ebc300',
        'on-surface': '#e5e2e1',
        'on-surface-variant': '#d0c6ab',
        'on-background': '#e5e2e1',
        outline: '#999077',
        'outline-variant': '#4d4632',
        'primary-container': '#ffd400',
        'on-primary': '#3b2f00',
        'on-primary-container': '#705c00',
        'primary-fixed': '#ffe177',
        'primary-fixed-dim': '#ebc300',
        'on-primary-fixed': '#231b00',
        'on-primary-fixed-variant': '#554500',
        'secondary-container': '#464747',
        'on-secondary': '#303031',
        'on-secondary-container': '#b6b5b5',
        'secondary-fixed': '#e4e2e2',
        'secondary-fixed-dim': '#c7c6c6',
        tertiary: '#cfffe3',
        'on-tertiary': '#003824',
        'tertiary-container': '#63f0b3',
        'on-tertiary-container': '#006b49',
        'tertiary-fixed': '#6ffbbe',
        'tertiary-fixed-dim': '#4edea3',
        'on-tertiary-fixed': '#002113',
        'on-tertiary-fixed-variant': '#005236',
        error: '#ffb4ab',
        'on-error': '#690005',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6',
        // The <alpha-value> placeholder enables Tailwind opacity modifiers like
        // bg-primary/90, bg-card/80, bg-destructive/10, etc.
        // Without it, hsl(var(--token)) can't accept an alpha channel at utility-class time.
  			background: '#131313',
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
  				DEFAULT: '#fff3d6',
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
