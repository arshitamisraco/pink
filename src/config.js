// All tunables live here. Vite hot-reloads on save, so just edit + look.

function hslToRgb255(h, s, l) {
  // h: 0-360, s/l: 0-1 -> returns [r,g,b] each 0-255
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const CONFIG = {
  // --- master color knob -------------------------------------------
  // 0-360 hue wheel. Slide this to shift the whole filter's tint,
  // e.g. ~330 = pink, ~210 = blue, ~190 = cyan (the original default look).
  MAIN_HUE: 330,

  // Set either override to a [r, g, b] array (0-255 each) to bypass the
  // hue knob for that tone specifically. Leave null to derive from MAIN_HUE.
  DARK_COLOR_OVERRIDE: [255, 20, 147], // hot pink ink
  LIGHT_COLOR_OVERRIDE: [255, 214, 235], // pale pink paper

  // how saturated/dark the "ink" tone is, and how saturated/light the
  // "paper" tone is, when derived from MAIN_HUE.
  DARK_SATURATION: 0.85,
  DARK_LIGHTNESS: 0.12,
  LIGHT_SATURATION: 0.12,
  LIGHT_LIGHTNESS: 0.96,

  // --- hand node smoothing ------------------------------------------
  // exponential lerp factor applied to the 4 quad-corner nodes each
  // frame. Lower = laggier/smoother, higher = snappier. Range: ~0.02-1.
  SMOOTHING: 0.2,

  // --- effect ---------------------------------------------------------
  // 0 = show source luminance as-is, 1 = fully inverted before mapping
  // to the duotone ramp (the "photo negative" look). Range: 0-1.
  INVERT_STRENGTH: 0,

  // contrast/brightness applied to luminance before the duotone ramp.
  // CONTRAST range: ~0.2-3 (1 = neutral). BRIGHTNESS range: ~-0.5-0.5.
  CONTRAST: 1.2,
  BRIGHTNESS: 0.0,

  // halftone/CRT pattern cell size in screen pixels. Range: ~2-40.
  DOT_SCALE: 6,

  // 0 = round halftone dots, 1 = horizontal scanlines, values between
  // crossfade the two.
  PATTERN_MIX: 0.0,

  // show small magenta dots at the 4 tracked fingertip nodes.
  DEBUG_DOTS: false,
};

export function getDarkColor() {
  return (
    CONFIG.DARK_COLOR_OVERRIDE ??
    hslToRgb255(CONFIG.MAIN_HUE, CONFIG.DARK_SATURATION, CONFIG.DARK_LIGHTNESS)
  );
}

export function getLightColor() {
  return (
    CONFIG.LIGHT_COLOR_OVERRIDE ??
    hslToRgb255(CONFIG.MAIN_HUE, CONFIG.LIGHT_SATURATION, CONFIG.LIGHT_LIGHTNESS)
  );
}
