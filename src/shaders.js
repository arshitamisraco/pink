export const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 vUv;

void main() {
  // a_position is a fullscreen quad in clip space (-1..1)
  vUv = a_position * 0.5 + 0.5; // 0..1, y=0 at bottom of screen
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// vUv is screen space (mirrored/selfie, cover-cropped to the canvas),
// matching u_points space.
export const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D u_video;
uniform vec2 u_points[4]; // fixed perimeter order: leftThumb, leftIndex, rightIndex, rightThumb
uniform bool u_maskActive;
uniform bool u_debug;
uniform vec2 u_resolution;
uniform vec2 u_videoSize;

uniform float u_invertStrength; // 0 = no invert, 1 = full invert, before duotone mapping
uniform vec3 u_darkColor;
uniform vec3 u_lightColor;
uniform float u_contrast;
uniform float u_brightness;
uniform float u_dotScale;   // halftone cell size in pixels
uniform float u_patternMix; // 0 = dots, 1 = scanlines

// Maps a screen-space uv to the GL texture uv to sample for "cover" video
// display: scaled + center-cropped to fill the canvas, mirrored selfie-style.
// This is the exact inverse of the JS-side videoPointToScreenUv() used to
// place the fingertip nodes -- keep the two in sync if either changes.
vec2 videoUvFor(vec2 screenUv) {
  float canvasAspect = u_resolution.x / u_resolution.y;
  float videoAspect = u_videoSize.x / u_videoSize.y;
  float sy = 1.0 - screenUv.y; // top-left, y-down (matches landmark convention)
  float wx = screenUv.x;
  float wvx, wvy;
  if (canvasAspect > videoAspect) {
    float k = videoAspect / canvasAspect;
    wvx = wx;
    wvy = 0.5 + (sy - 0.5) * k;
  } else {
    float k = canvasAspect / videoAspect;
    wvx = 0.5 + (wx - 0.5) * k;
    wvy = sy;
  }
  float vx = 1.0 - wvx; // mirror
  float vy = wvy;
  return vec2(vx, 1.0 - vy); // flip-corrected GL texture v
}

// even-odd (ray-casting) point-in-polygon test: handles a self-intersecting
// quad correctly, filling both lobes of a bowtie when the corners cross.
bool insidePolygon(vec2 p) {
  bool inside = false;
  int j = 3;
  for (int i = 0; i < 4; i++) {
    vec2 pi = u_points[i];
    vec2 pj = u_points[j];
    if ((pi.y > p.y) != (pj.y > p.y)) {
      float xCross = (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x;
      if (p.x < xCross) {
        inside = !inside;
      }
    }
    j = i;
  }
  return inside;
}

vec3 duotoneHalftone(vec3 videoColor) {
  float lum = dot(videoColor, vec3(0.299, 0.587, 0.114));
  lum = clamp((lum - 0.5) * u_contrast + 0.5 + u_brightness, 0.0, 1.0);
  lum = mix(lum, 1.0 - lum, u_invertStrength);

  float inkCoverage = 1.0 - lum; // dark source areas -> more ink

  // dot pattern: ink-colored circle per cell, radius grows with inkCoverage
  vec2 cellUv = mod(gl_FragCoord.xy, u_dotScale) / u_dotScale;
  float distFromCenter = length(cellUv - 0.5) * 2.0; // ~0 center .. ~1.4 corner
  float dotPattern = 1.0 - smoothstep(inkCoverage - 0.06, inkCoverage + 0.06, distFromCenter);

  // scanline pattern: horizontal band coverage proportional to inkCoverage
  float scanUv = mod(gl_FragCoord.y, u_dotScale) / u_dotScale;
  float linePattern = 1.0 - smoothstep(inkCoverage - 0.06, inkCoverage + 0.06, scanUv);

  float patternValue = mix(dotPattern, linePattern, u_patternMix);
  return mix(u_lightColor, u_darkColor, patternValue);
}

void main() {
  vec3 videoColor = texture(u_video, videoUvFor(vUv)).rgb;
  vec3 outColor = videoColor;

  if (u_maskActive && insidePolygon(vUv)) {
    outColor = duotoneHalftone(videoColor);
  }

  if (u_debug && u_maskActive) {
    for (int i = 0; i < 4; i++) {
      float d = distance(vUv * u_resolution, u_points[i] * u_resolution);
      if (d < 8.0) {
        outColor = vec3(1.0, 0.2, 0.8);
      }
    }
  }

  fragColor = vec4(outColor, 1.0);
}
`;
