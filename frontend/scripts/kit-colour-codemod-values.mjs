#!/usr/bin/env node
/**
 * P2 colour codemod, pass 2 — rewrites quoted hex VALUES (not Tailwind
 * classes; pass 1 did those) that sit on a recognisable property name:
 * `fill: '#2563EB'`, `stroke="#CBD5E1"`, `color: '#DC2626'`,
 * `borderColor: '#E2E8F0'`, `backgroundColor: '#F1F5F9'`, `tint="#EFF6FF"`,
 * `iconBg="#EFF6FF"`, `iconColor="#2563EB"`.
 *
 * These are status/role maps, recharts/reactflow props, and inline
 * `style={{...}}` objects — a raw colour value is required there (no
 * className to put a token class on), so the kit token is written as a
 * `var(--token)` CSS custom-property string per the kit's own convention
 * (chart series read var(--chart-N) the same way).
 *
 * Does NOT touch: array literals with no property key (chart-series
 * arrays like `const PIE = ['#2563EB', '#16A34A', ...]` are hand-mapped
 * to --chart-1.."6" in order, by hand, not here — order matters and a
 * script can't know which array is a chart series vs a tag-colour array);
 * rgba(...); lib/install-settings.ts; lib/org-chart-colors.ts.
 *
 * Usage: node scripts/kit-colour-codemod-values.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

const EXCLUDE_FILES = new Set([
  join(ROOT, "lib", "install-settings.ts"),
  join(ROOT, "lib", "org-chart-colors.ts"),
]);

// Reuse of the class-codemod's three role tables (kept in sync by hand;
// see audit/colour-map.md, which is the source of truth for both scripts).
const TEXT = {
  "0F172A": "text-primary", "1E293B": "text-primary", "172554": "text-primary",
  "374151": "text-secondary", "475569": "text-secondary", "334155": "text-secondary",
  "64748B": "text-muted", "94A3B8": "text-muted", "6B7280": "text-secondary",
  "2563EB": "primary-text", "1D4ED8": "primary-text", "1E40AF": "primary-text", "3B82F6": "primary-text", "1E3A8A": "primary-text",
  "16A34A": "success", "15803D": "success", "166534": "success", "047857": "success", "059669": "success", "22C55E": "success", "65A30D": "success",
  "D97706": "warning", "92400E": "warning", "B45309": "warning", "A16207": "warning", "CA8A04": "warning", "9A3412": "warning", "78350F": "warning", "713F12": "warning", "854D0E": "warning", "C2410C": "warning",
  "DC2626": "danger", "B91C1C": "danger", "991B1B": "danger", "EF4444": "danger", "E11D48": "danger", "BE123C": "danger", "7F1D1D": "danger",
  "7C3AED": "text-secondary", "8B5CF6": "text-secondary", "4C1D95": "text-secondary", "5B21B6": "text-secondary", "6D28D9": "text-secondary",
  "4338CA": "text-secondary", "3730A3": "text-secondary", "9333EA": "text-secondary", "DB2777": "text-secondary", "BE185D": "text-secondary",
  "EC519E": "text-secondary", "0891B2": "text-secondary", "0E7490": "text-secondary", "0369A1": "text-secondary", "0EA5E9": "text-secondary",
  "F59E0B": "text-secondary", "FBBF24": "text-secondary", "EA580C": "text-secondary", "4F46E5": "text-secondary", "2E1065": "text-secondary",
};

const FILL = {
  "EFF6FF": "primary-subtle", "DBEAFE": "primary-subtle", "F0F9FF": "primary-subtle", "E0E7FF": "primary-subtle", "EEF2FF": "primary-subtle",
  "2563EB": "primary", "1D4ED8": "primary-hover", "1E40AF": "primary-pressed", "3B82F6": "primary-ring", "93C5FD": "primary-border",
  "F8FAFC": "surface-sunken", "F8FAFF": "surface-sunken", "F8FBFF": "surface-sunken", "FAFAFA": "surface-sunken", "FAFBFC": "surface-sunken", "FBFCFE": "surface-sunken", "FCFDFE": "surface-sunken",
  "F1F5F9": "surface-control", "F3F4F6": "surface-control", "E5E7EB": "surface-control", "EEF1F5": "surface-control", "EEF2F7": "surface-control", "EEF2F8": "surface-control", "E8EDF3": "surface-control", "E9EEF4": "surface-control",
  "E2E8F0": "surface-control-pressed", "CBD5E1": "surface-control-pressed",
  "DCFCE7": "success-bg", "D1FAE5": "success-bg", "A7F3D0": "success-bg", "ECFDF5": "success-bg", "F0FDF4": "success-bg", "BBF7D0": "success-bg",
  "FEF3C7": "warning-bg", "FEF9C3": "warning-bg", "FEFCE8": "warning-bg", "FFFBEB": "warning-bg", "FED7AA": "warning-bg", "FFF7ED": "warning-bg", "FDE68A": "warning-bg",
  "FEE2E2": "danger-bg", "FEF2F2": "danger-bg", "FFE4E6": "danger-bg", "FFF1F2": "danger-bg", "FFF5F5": "danger-bg", "FBCFE8": "danger-bg", "FDF2F8": "danger-bg", "FECDD3": "danger-bg", "FECACA": "danger-bg",
  "E0F2FE": "surface-control", "BAE6FD": "surface-control", "F3E8FF": "surface-control", "F5F3FF": "surface-control", "EDE9FE": "surface-control", "FDF4FF": "surface-control", "E9D5FF": "surface-control",
  "DC2626": "danger", "B91C1C": "danger-hover", "991B1B": "danger-pressed", "EF4444": "danger", "E11D48": "danger", "BE123C": "danger-pressed",
  "16A34A": "success", "15803D": "success", "166534": "success", "047857": "success", "059669": "success", "22C55E": "success", "65A30D": "success",
  "D97706": "warning", "92400E": "warning", "B45309": "warning", "A16207": "warning", "CA8A04": "warning", "9A3412": "warning", "78350F": "warning", "713F12": "warning", "854D0E": "warning", "C2410C": "warning",
  "7C3AED": "text-secondary", "8B5CF6": "text-secondary", "4C1D95": "text-secondary", "5B21B6": "text-secondary", "6D28D9": "text-secondary",
  "4338CA": "text-secondary", "3730A3": "text-secondary", "9333EA": "text-secondary", "DB2777": "text-secondary", "BE185D": "text-secondary",
  "EC519E": "text-secondary", "0891B2": "text-secondary", "0E7490": "text-secondary", "0369A1": "text-secondary", "0EA5E9": "text-secondary",
  "F59E0B": "text-secondary", "FBBF24": "text-secondary", "EA580C": "text-secondary", "6B7280": "text-secondary",
  "FFFFFF": "surface", "FFF": "surface",
};

const BORDER = {
  "2563EB": "primary", "1D4ED8": "primary-hover", "3B82F6": "primary-ring", "BFDBFE": "primary-border", "93C5FD": "primary-border",
  "E2E8F0": "border-light", "CBD5E1": "border", "94A3B8": "border-strong", "64748B": "border-strong", "334155": "border-strong",
  "86EFAC": "success-border", "BBF7D0": "success-border", "A7F3D0": "success-border",
  "FCD34D": "warning-border", "FDE68A": "warning-border", "FED7AA": "warning-border", "F59E0B": "warning-border", "B45309": "warning-border", "CA8A04": "warning-border",
  "FCA5A5": "danger-border", "FECACA": "danger-border", "FEE2E2": "danger-border", "FECDD3": "danger-border", "FBCFE8": "danger-border",
  "F1F5F9": "border-light", "F8FAFC": "border-light", "BAE6FD": "border-light", "DDD6FE": "border-light", "E9D5FF": "border-light", "EEF2F7": "border-light", "E5E7EB": "border-light", "E9EEF4": "border-light",
  "DBEAFE": "primary-border", "7C3AED": "border-light",
  "FFFFFF": "border-light", "FFF": "border-light",
};

const KEY_ROLE = {
  fill: FILL, backgroundColor: FILL, background: FILL, bg: FILL, iconBg: FILL, tint: FILL, stripe: FILL, maskColor: FILL,
  stroke: BORDER, strokeColor: BORDER, border: BORDER, borderColor: BORDER,
  color: TEXT, fg: TEXT, iconColor: TEXT, textColor: TEXT, nodeColor: TEXT,
};

const KEYS = Object.keys(KEY_ROLE).sort((a, b) => b.length - a.length).join("|");
// key: '#hex'  |  key="#hex"  |  key: "#hex"
const RE = new RegExp(`\\b(${KEYS})(\\s*[:=]\\s*)(['"])#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})\\3`, "g");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(name))) out.push(p);
  }
  return out;
}

function rewriteFile(path) {
  if (EXCLUDE_FILES.has(path)) return { changed: false, flagged: 0 };
  const src = readFileSync(path, "utf8");
  let flagged = 0;
  let any = false;
  const next = src.replace(RE, (whole, key, sep, quote, hex) => {
    const map = KEY_ROLE[key];
    const tok = map[hex.toUpperCase()];
    if (!tok) {
      flagged++;
      return whole;
    }
    any = true;
    return `${key}${sep}${quote}var(--${tok})${quote}`;
  });
  if (any && !DRY) writeFileSync(path, next, "utf8");
  return { changed: any, flagged };
}

const files = [];
for (const dir of ["app", "components", "lib"]) {
  try { walk(join(ROOT, dir), files); } catch {}
}

let changedFiles = 0, totalFlagged = 0;
for (const f of files) {
  const { changed, flagged } = rewriteFile(f);
  if (changed) changedFiles++;
  totalFlagged += flagged;
}
console.log(`${changedFiles} files rewritten${DRY ? " (dry run)" : ""}`);
console.log(`${totalFlagged} key:#hex pairs left in place (hex not in the role map)`);
