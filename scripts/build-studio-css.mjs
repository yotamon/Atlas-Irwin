import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "app/studio/design-system/legacy-compat.generated.css");

const legacySources = [
  "app/studio/studio.css",
  "app/studio/studio-v2.css",
  "app/studio/studio-v2-workflows.css",
  "app/studio/release-workspace-v2.css",
  "app/studio/release-growth.css",
  "app/studio/growth-os.css",
  "app/studio/growth-import.css",
  "app/studio/video-director.css",
  "app/studio/video-director-states.css",
  "app/studio/video-director-refinements.css",
  "app/studio/ai-control.css",
  "app/studio/distribution.css",
  "app/studio/distribution-release.css",
  "app/studio/sites-domains.css",
  "app/studio/ensemblis-shell.css",
  "app/studio/ensemblis-screens.css",
  "app/studio/ux-polish.css",
  "app/studio/music-polish.css",
  "app/studio/release-polish.css",
  "app/studio/create-polish.css",
  "app/studio/growth-polish.css",
  "app/studio/paid-growth-polish.css",
  "app/studio/audience-polish.css",
  "app/studio/library-polish.css",
  "app/studio/inbox-polish.css",
  "app/studio/object-workspace-polish.css",
  "app/studio/production-polish.css",
  "app/studio/responsive-polish.css",
  "app/studio/onboarding.css",
];

const palette = [
  ["--en-black", [0, 0, 0]],
  ["--en-bg", [8, 11, 9]],
  ["--en-bg-elevated", [12, 17, 14]],
  ["--en-surface", [16, 23, 19]],
  ["--en-surface-raised", [21, 30, 25]],
  ["--en-surface-hover", [26, 37, 30]],
  ["--en-line", [37, 48, 42]],
  ["--en-line-strong", [53, 68, 59]],
  ["--en-subtle", [111, 124, 116]],
  ["--en-muted", [154, 167, 159]],
  ["--en-accent", [183, 243, 106]],
  ["--en-accent-strong", [211, 255, 153]],
  ["--en-violet", [138, 124, 255]],
  ["--en-mint", [92, 225, 198]],
  ["--en-danger", [255, 120, 108]],
  ["--en-warning", [234, 179, 8]],
  ["--en-ink", [246, 248, 244]],
  ["--en-white", [255, 255, 255]],
];

const legacyVarMap = [
  ["--s-surface-2", "--en-surface-raised"],
  ["--s-surface", "--en-surface"],
  ["--s-bg", "--en-bg"],
  ["--s-ink", "--en-ink"],
  ["--s-muted", "--en-muted"],
  ["--s-line", "--en-line"],
  ["--s-accent", "--en-accent"],
  ["--s-coral", "--en-danger"],
  ["--s-teal", "--en-mint"],
  ["--studio-surface", "--en-surface"],
  ["--muted-foreground", "--en-muted"],
  ["--foreground", "--en-ink"],
  ["--border", "--en-line"],
  ["--card", "--en-surface"],
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nearestToken(r, g, b) {
  let best = palette[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const [cr, cg, cb] = candidate[1];
    const next = (r - cr) ** 2 * 2 + (g - cg) ** 2 * 4 + (b - cb) ** 2;
    if (next < distance) {
      best = candidate;
      distance = next;
    }
  }
  return best[0];
}

function tokenColor(r, g, b, alpha = 1) {
  const token = nearestToken(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
  if (alpha >= 0.999) return `var(${token})`;
  if (alpha <= 0.001) return "transparent";
  return `color-mix(in srgb, var(${token}) ${Math.round(alpha * 1000) / 10}%, transparent)`;
}

function parseHex(value) {
  const hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const values = hex.split("").map((part) => Number.parseInt(part + part, 16));
    return [values[0], values[1], values[2], hex.length === 4 ? values[3] / 255 : 1];
  }
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const saturation = clamp(s / 100, 0, 1);
  const lightness = clamp(l / 100, 0, 1);
  if (saturation === 0) {
    const gray = Math.round(lightness * 255);
    return [gray, gray, gray];
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (input) => {
    let value = input;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    Math.round(channel(hue + 1 / 3) * 255),
    Math.round(channel(hue) * 255),
    Math.round(channel(hue - 1 / 3) * 255),
  ];
}

function normalizeColors(css) {
  let result = css.replace(/#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})\b/g, (value) => {
    const [r, g, b, a] = parseHex(value);
    return tokenColor(r, g, b, a);
  });
  result = result.replace(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)/gi,
    (_match, r, g, b, alpha) => tokenColor(Number(r), Number(g), Number(b), alpha === undefined ? 1 : Number(alpha)));
  result = result.replace(/rgb\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s*\/\s*(\d*\.?\d+)%?)?\s*\)/gi,
    (_match, r, g, b, alpha) => tokenColor(Number(r), Number(g), Number(b), alpha === undefined ? 1 : Number(alpha) > 1 ? Number(alpha) / 100 : Number(alpha)));
  result = result.replace(/hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%(?:\s*,\s*(\d*\.?\d+))?\s*\)/gi,
    (_match, h, s, l, alpha) => {
      const [r, g, b] = hslToRgb(Number(h), Number(s), Number(l));
      return tokenColor(r, g, b, alpha === undefined ? 1 : Number(alpha));
    });
  result = result.replace(/(?<=[:(,\s])black(?=[\s,)%/;])/gi, "var(--en-black)");
  result = result.replace(/(?<=[:(,\s])white(?=[\s,)%/;])/gi, "var(--en-white)");
  return result;
}

function normalizeLegacyVariables(css) {
  let result = css;
  for (const [legacy, canonical] of legacyVarMap) {
    result = result.replace(new RegExp(`${escapeRegExp(legacy)}(?![\\w-])`, "g"), canonical);
  }
  return result.replaceAll("var(--font-heading)", "var(--font-body)");
}

function stripTokenDeclarations(css) {
  return css
    .replace(/^\s*--(?:s|en)-[\w-]+\s*:[^;]+;\s*$/gm, "")
    .replace(/^\s*--font-heading\s*:[^;]+;\s*$/gm, "");
}

function normalizeChromeGeometry(css) {
  return css.replace(/border-radius\s*:\s*([^;]+);/gi, (_match, value) => {
    const normalized = value.replace(/(\d*\.?\d+)(px|rem)\b/g, (match, amount, unit) => {
      const numeric = Number(amount);
      const rem = unit === "px" ? numeric / 16 : numeric;
      if (numeric === 0) return "0";
      if (unit === "px" && numeric >= 100) return "var(--en-radius-pill)";
      if (rem <= 0.5) return "var(--en-radius-xs)";
      if (rem <= 0.72) return "var(--en-radius-sm)";
      if (rem <= 0.98) return "var(--en-radius)";
      if (rem <= 1.3) return "var(--en-radius-lg)";
      if (rem <= 1.8) return "var(--en-radius-xl)";
      return match;
    });
    return `border-radius: ${normalized};`;
  });
}

function assertCompiledCss(css) {
  const inspectable = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const forbidden = [
    [/#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})\b/, "raw hex color"],
    [/rgba?\(\s*\d/i, "raw rgb color"],
    [/hsla?\(\s*-?\d/i, "raw hsl color"],
    [/--s-/, "legacy --s-* token"],
    [/--studio-surface(?![\w-])/, "legacy --studio-surface token"],
    [/--(?:border|card|foreground|muted-foreground)(?![\w-])/, "generic non-Ensemblis chrome token"],
    [/(?:^|[:(,\s])(?:black|white)(?=[\s,)%/;])/i, "named raw color"],
  ];
  for (const [pattern, label] of forbidden) {
    const match = inspectable.match(pattern);
    if (match) throw new Error(`Studio CSS compiler left ${label}: ${match[0]}`);
  }
  if (/^\s*--en-[\w-]+\s*:/m.test(inspectable)) {
    throw new Error("Compiled compatibility CSS attempted to declare canonical --en-* tokens");
  }
}

const chunks = [];
for (const source of legacySources) {
  let css = await readFile(resolve(root, source), "utf8");
  css = normalizeLegacyVariables(css);
  css = stripTokenDeclarations(css);
  css = normalizeColors(css);
  css = normalizeChromeGeometry(css);
  chunks.push(`\n/* compatibility source: ${source} */\n${css.trim()}\n`);
}

const output = `/* AUTO-GENERATED by scripts/build-studio-css.mjs. DO NOT EDIT.\n   Compatibility layout lives in the lowest cascade layer and has no independent color values. */\n${chunks.join("\n")}`;
assertCompiledCss(output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`Compiled ${legacySources.length} Studio compatibility stylesheets into the Ensemblis token system.`);
