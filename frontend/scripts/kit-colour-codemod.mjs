#!/usr/bin/env node
/**
 * P2 colour codemod — rewrites Tailwind arbitrary-hex class names
 * (`bg-[#2563EB]`, `hover:text-[#1D4ED8]`, `border-[#E2E8F0]/40`, ...) to the
 * kit's token classes (`bg-primary`, `hover:text-primary-text`,
 * `border-border-light/40`). The map it drives on is `audit/colour-map.md`
 * (hex -> token, split by role: TEXT / FILL / BORDER) — keep the two in sync.
 *
 * What it does NOT touch (by design, see audit/colour-map.md "Left as data"
 * and "Pure black/white"):
 *   - lib/install-settings.ts, lib/org-chart-colors.ts
 *   - arbitrary-PROPERTY forms ([background-color:#2563EB]), inline
 *     style={{...}}, recharts/SVG fill|stroke PROPS (not classes), rgba(...)
 *   - plain #fff/#000 text-on-status-pill and any #000 background (flagged,
 *     not rewritten — see FLAG_ONLY below)
 * Those are the hand pass (task 5's "what the class-codemod can't").
 *
 * Usage: node scripts/kit-colour-codemod.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

const EXCLUDE_FILES = new Set([
  join(ROOT, "lib", "install-settings.ts"),
  join(ROOT, "lib", "org-chart-colors.ts"),
]);

function norm(hex) {
  return hex.toUpperCase();
}

/* ---- Role maps (hex, uppercase, no '#') -> kit token name ---- */

const TEXT = {
  "0F172A": "text-primary",
  "1E293B": "text-primary",
  "172554": "text-primary",
  "374151": "text-secondary",
  "475569": "text-secondary",
  "334155": "text-secondary",
  "64748B": "text-muted",
  "94A3B8": "text-muted",
  "6B7280": "text-muted",
  "2563EB": "primary-text",
  "1D4ED8": "primary-text",
  "1E40AF": "primary-text",
  "3B82F6": "primary-text",
  "16A34A": "success",
  "15803D": "success",
  "166534": "success",
  "047857": "success",
  "059669": "success",
  "22C55E": "success",
  "65A30D": "success",
  "D97706": "warning",
  "92400E": "warning",
  "B45309": "warning",
  "A16207": "warning",
  "CA8A04": "warning",
  "9A3412": "warning",
  "78350F": "warning",
  "713F12": "warning",
  "854D0E": "warning",
  "C2410C": "warning",
  "DC2626": "danger",
  "B91C1C": "danger",
  "991B1B": "danger",
  "EF4444": "danger",
  "E11D48": "danger",
  "BE123C": "danger",
  // decorative hues used as plain text: treated as neutral (D8 extended)
  "7C3AED": "text-secondary",
  "8B5CF6": "text-secondary",
  "4C1D95": "text-secondary",
  "5B21B6": "text-secondary",
  "6D28D9": "text-secondary",
  "4338CA": "text-secondary",
  "3730A3": "text-secondary",
  "9333EA": "text-secondary",
  "DB2777": "text-secondary",
  "BE185D": "text-secondary",
  "EC519E": "text-secondary",
  "0891B2": "text-secondary",
  "0E7490": "text-secondary",
  "0369A1": "text-secondary",
  "0EA5E9": "text-secondary",
  "F59E0B": "text-secondary",
  "FBBF24": "text-secondary",
  "EA580C": "text-secondary",
};

const FILL = {
  "EFF6FF": "primary-subtle",
  "DBEAFE": "primary-subtle",
  "F0F9FF": "primary-subtle",
  "E0E7FF": "primary-subtle",
  "EEF2FF": "primary-subtle",
  "2563EB": "primary",
  "1D4ED8": "primary-hover",
  "1E40AF": "primary-pressed",
  "3B82F6": "primary-ring",
  "F8FAFC": "surface-sunken",
  "F8FAFF": "surface-sunken",
  "F8FBFF": "surface-sunken",
  "FAFAFA": "surface-sunken",
  "FAFBFC": "surface-sunken",
  "FBFCFE": "surface-sunken",
  "FCFDFE": "surface-sunken",
  "F1F5F9": "surface-control",
  "F3F4F6": "surface-control",
  "E5E7EB": "surface-control",
  "EEF1F5": "surface-control",
  "EEF2F7": "surface-control",
  "EEF2F8": "surface-control",
  "E8EDF3": "surface-control",
  "E9EEF4": "surface-control",
  "E2E8F0": "surface-control-pressed",
  "CBD5E1": "surface-control-pressed",
  "DCFCE7": "success-bg",
  "D1FAE5": "success-bg",
  "A7F3D0": "success-bg",
  "ECFDF5": "success-bg",
  "F0FDF4": "success-bg",
  "BBF7D0": "success-bg",
  "FEF3C7": "warning-bg",
  "FEF9C3": "warning-bg",
  "FEFCE8": "warning-bg",
  "FFFBEB": "warning-bg",
  "FED7AA": "warning-bg",
  "FFF7ED": "warning-bg",
  "FEE2E2": "danger-bg",
  "FEF2F2": "danger-bg",
  "FFE4E6": "danger-bg",
  "FFF1F2": "danger-bg",
  "FFF5F5": "danger-bg",
  "FBCFE8": "danger-bg",
  "FDF2F8": "danger-bg",
  "FECDD3": "danger-bg",
  // decorative pastels (info/violet/etc.) -> neutral fill (D8 extended)
  "E0F2FE": "surface-control",
  "BAE6FD": "surface-control",
  "F3E8FF": "surface-control",
  "F5F3FF": "surface-control",
  "EDE9FE": "surface-control",
  "FDF4FF": "surface-control",
  "E9D5FF": "surface-control",
};

const BORDER = {
  "2563EB": "primary",
  "1D4ED8": "primary-hover",
  "3B82F6": "primary-ring",
  "BFDBFE": "primary-border",
  "93C5FD": "primary-border",
  "E2E8F0": "border-light",
  "CBD5E1": "border",
  "94A3B8": "border-strong",
  "86EFAC": "success-border",
  "BBF7D0": "success-border",
  "FCD34D": "warning-border",
  "FDE68A": "warning-border",
  "FCA5A5": "danger-border",
  "FECACA": "danger-border",
};

// Pure white -> surface for a fill/border; text handled case by case (flag).
const WHITE_FILL = { FFFFFF: "surface", FFF: "surface" };
const WHITE_BORDER = { FFFFFF: "border-light", FFF: "border-light" };

// Prefixes that read the TEXT map.
const TEXT_PREFIXES = ["text", "placeholder", "decoration", "caret"];
// Prefixes that read the FILL map.
const FILL_PREFIXES = ["bg", "divide", "from", "via", "to", "fill"];
// Prefixes that read the BORDER map.
const BORDER_PREFIXES = ["border", "border-t", "border-b", "border-l", "border-r", "ring", "ring-offset", "outline", "accent", "stroke"];

const ALL_PREFIXES = [...new Set([...TEXT_PREFIXES, ...FILL_PREFIXES, ...BORDER_PREFIXES])]
  .sort((a, b) => b.length - a.length); // longest first (border-l before border)

// variant prefixes that may precede the utility, e.g. hover:, group-hover:,
// data-[state=open]:, lg:, dark: (unused but harmless if present).
const VARIANT = `(?:[a-zA-Z0-9-]+:|\\[[^\\]]+\\]:)*`;

function tokenFor(prefix, hex) {
  const hu = norm(hex);
  if (TEXT_PREFIXES.includes(prefix)) {
    if (hu === "FFFFFF" || hu === "FFF") return null; // flagged, hand pass
    if (hu === "000" || hu === "000000") return null;
    return TEXT[hu];
  }
  if (FILL_PREFIXES.includes(prefix)) {
    if (hu === "FFFFFF" || hu === "FFF") return WHITE_FILL[hu];
    if (hu === "000" || hu === "000000") return null;
    return FILL[hu];
  }
  if (BORDER_PREFIXES.includes(prefix)) {
    if (hu === "FFFFFF" || hu === "FFF") return WHITE_BORDER[hu];
    return BORDER[hu];
  }
  return undefined;
}

// Matches e.g. `hover:bg-[#2563EB]/10` or `!border-l-[#E2E8F0]`
const CLASS_RE = new RegExp(
  `(${VARIANT})(!?)(${ALL_PREFIXES.join("|")})-\\[#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\\](\\/\\d{1,3})?(!?)`,
  "g"
);

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
  const next = src.replace(CLASS_RE, (whole, variant, bang1, prefix, hex, opacity, bang2) => {
    const tok = tokenFor(prefix, hex);
    if (tok === undefined) {
      flagged++;
      return whole; // unknown hex for this role: leave in place, counted
    }
    if (tok === null) {
      flagged++;
      return whole; // deliberately flagged (pure black/white text, pure black bg)
    }
    any = true;
    return `${variant}${bang1}${prefix}-${tok}${opacity ?? ""}${bang2}`;
  });
  if (any && !DRY) writeFileSync(path, next, "utf8");
  return { changed: any, flagged };
}

const files = [];
for (const dir of ["app", "components", "lib"]) {
  try {
    walk(join(ROOT, dir), files);
  } catch {}
}

let changedFiles = 0;
let totalFlagged = 0;
for (const f of files) {
  const { changed, flagged } = rewriteFile(f);
  if (changed) changedFiles++;
  totalFlagged += flagged;
}

console.log(`${changedFiles} files rewritten${DRY ? " (dry run)" : ""}`);
console.log(`${totalFlagged} arbitrary-hex classes left in place (unknown hex for its role, or a flagged pure black/white — hand pass)`);
