import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#2563EB", hover: "#1D4ED8", light: "#EFF6FF" },
        success: "#16A34A",
        warning: "#D97706",
        danger: { DEFAULT: "#DC2626", hover: "#B91C1C" },
        info: "#0891B2",
        sidebar: { DEFAULT: "#0F172A", hover: "#1E293B", divider: "#1E293B" },
        border: "#E2E8F0",
        input: "#CBD5E1",
        heading: "#0F172A",
        body: "#1E293B",
        secondary: "#475569",
        muted: "#94A3B8",
        label: "#374151",
        helper: "#64748B",
        // The phone layout's tokens (FRONTEND_RULES_PHONE.md section 41). Each
        // reads a CSS variable that app/globals.css defines ONLY under
        // html[data-layout="phone"] (the PHONE BRAND BLOCK), so these classes
        // mean nothing on desktop and no desktop colour above changes. Used by
        // components/phone only, e.g. bg-phone-primary, text-phone-text-secondary.
        phone: {
          primary: "var(--primary)",
          "primary-hover": "var(--primary-hover)",
          "primary-pressed": "var(--primary-pressed)",
          "primary-ring": "var(--primary-ring)",
          "primary-subtle": "var(--primary-subtle)",
          "primary-border": "var(--primary-border)",
          "primary-foreground": "var(--primary-foreground)",
          "primary-text": "var(--primary-text)",
          "on-brand": "var(--on-brand)",
          "on-brand-hover": "var(--on-brand-hover)",
          "on-brand-pressed": "var(--on-brand-pressed)",
          success: "var(--success)",
          "success-bg": "var(--success-bg)",
          "success-border": "var(--success-border)",
          warning: "var(--warning)",
          "warning-bg": "var(--warning-bg)",
          "warning-border": "var(--warning-border)",
          danger: "var(--danger)",
          "danger-bg": "var(--danger-bg)",
          "danger-border": "var(--danger-border)",
          "on-danger": "var(--on-danger)",
          info: "var(--info)",
          "info-bg": "var(--info-bg)",
          "info-border": "var(--info-border)",
          "text-primary": "var(--text-primary)",
          "text-body": "var(--text-body)",
          "text-secondary": "var(--text-secondary)",
          "text-muted": "var(--text-muted)",
          surface: "var(--surface)",
          "surface-sunken": "var(--surface-sunken)",
          "surface-control": "var(--surface-control)",
          "surface-control-pressed": "var(--surface-control-pressed)",
          "border-light": "var(--border-light)",
          border: "var(--border)",
          "border-strong": "var(--border-strong)",
          backdrop: "var(--backdrop)",
        },
      },
      borderRadius: {
        card: "12px",
        btn: "8px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        // Phone bottom sheets (41.8 rule 2); the variable is phone-scoped.
        "phone-dialog": "var(--shadow-dialog)",
      },
      fontSize: {
        h1: ["28px", { fontWeight: "700" }],
        h2: ["22px", { fontWeight: "600" }],
        h3: ["18px", { fontWeight: "600" }],
        body: ["15px", { fontWeight: "400" }],
        small: ["13px", { fontWeight: "400" }],
        label: ["14px", { fontWeight: "500" }],
        // The phone type table (FRONTEND_RULES_PHONE.md 41.9), read from the
        // phone layout's --type-* tokens (rem, so they grow with the phone's
        // text-size setting). The two bar sizes are fixed px on purpose: the
        // 56px app bar and tab bar never grow (41.4 rules 1 and 12).
        "phone-page-title": ["var(--type-page-title)", { lineHeight: "1.25" }],
        "phone-section": ["var(--type-section)", { lineHeight: "1.3" }],
        "phone-card-heading": ["var(--type-card-heading)", { lineHeight: "1.4" }],
        "phone-body": ["var(--type-body)", { lineHeight: "1.6" }],
        "phone-label": ["var(--type-label)", { lineHeight: "1.5" }],
        "phone-meta": ["var(--type-meta)", { lineHeight: "1.5" }],
        "phone-bar-title": ["20px", { lineHeight: "1.3" }],
        "phone-bar-label": ["12px", { lineHeight: "1.5" }],
      },
      keyframes: {
        "fade-rise": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 0.5s cubic-bezier(0.2,0.7,0.2,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
