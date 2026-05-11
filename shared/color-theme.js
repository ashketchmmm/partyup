const STORAGE_KEY = "partyup-color-theme";

export const DEFAULT_COLOR_THEME = {
  pageBg: "#b9b9e0",
  headerBg: "#090824",
  accent: "#d5e6ff",
};

function normalizeHex(c) {
  if (!c || typeof c !== "string") return null;
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return null;
}

export function loadColorTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COLOR_THEME };
    const o = JSON.parse(raw);
    return {
      pageBg: normalizeHex(o.pageBg) ?? DEFAULT_COLOR_THEME.pageBg,
      headerBg: normalizeHex(o.headerBg) ?? DEFAULT_COLOR_THEME.headerBg,
      accent: normalizeHex(o.accent) ?? DEFAULT_COLOR_THEME.accent,
    };
  } catch {
    return { ...DEFAULT_COLOR_THEME };
  }
}

export function saveColorTheme(partial) {
  const next = { ...loadColorTheme(), ...partial };
  if (typeof next.pageBg === "string") next.pageBg = normalizeHex(next.pageBg) ?? DEFAULT_COLOR_THEME.pageBg;
  if (typeof next.headerBg === "string")
    next.headerBg = normalizeHex(next.headerBg) ?? DEFAULT_COLOR_THEME.headerBg;
  if (typeof next.accent === "string") next.accent = normalizeHex(next.accent) ?? DEFAULT_COLOR_THEME.accent;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG relative luminance for sRGB (0–1). */
function relativeLuminance({ r, g, b }) {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Black or white text for readability on a solid background color. */
export function foregroundForBackground(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#0a0a0a";
  const L = relativeLuminance(rgb);
  return L > 0.45 ? "#0a0a0a" : "#ffffff";
}

/** Matches `color-mix(in srgb, accent 70%, #ffffff)` used in CSS for hover tints. */
function accentHoverRgb(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { r: 213, g: 230, b: 255 };
  const w = 0.3;
  return {
    r: Math.round(rgb.r * (1 - w) + 255 * w),
    g: Math.round(rgb.g * (1 - w) + 255 * w),
    b: Math.round(rgb.b * (1 - w) + 255 * w),
  };
}

/** Apply theme to `:root` (uses fallbacks from `style.css` :root if unset). */
export function applyColorTheme(theme) {
  if (typeof document === "undefined") return;
  const t = { ...DEFAULT_COLOR_THEME, ...theme };
  const root = document.documentElement;
  root.style.setProperty("--partyup-page-bg", t.pageBg);
  root.style.setProperty("--partyup-header-bg", t.headerBg);
  root.style.setProperty("--partyup-accent", t.accent);
  root.style.setProperty("--partyup-on-accent", foregroundForBackground(t.accent));
  root.style.setProperty("--partyup-on-accent-hover", foregroundForBackground(accentHoverRgb(t.accent)));
  /** Text/icons on the header bar (follows header luminance, not accent). */
  root.style.setProperty("--partyup-on-header", foregroundForBackground(t.headerBg));
}

export function initColorThemeFromStorage() {
  applyColorTheme(loadColorTheme());
}

/** Clears saved overrides and reapplies built-in defaults. */
export function resetColorThemeToDefaults() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  applyColorTheme(DEFAULT_COLOR_THEME);
  return { ...DEFAULT_COLOR_THEME };
}
