import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { VERTEX_SRC, FRAGMENT_SRC } from "./shaders.js";
import { CONFIG, getDarkColor, getLightColor } from "./config.js";
import "./style.css";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

const THUMB_TIP = 4;
const INDEX_TIP = 8;

const statusEl = document.getElementById("status");
const video = document.getElementById("webcam");
const canvas = document.getElementById("gl");

// ---- webcam -------------------------------------------------------
async function setupWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  video.play();
}

function resizeCanvasToViewport() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ---- WebGL2 setup -------------------------------------------------
function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("shader compile error: " + info);
  }
  return shader;
}

function setupGL() {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 not supported");

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("program link error: " + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  // fullscreen quad (two triangles)
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const videoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uniforms = {
    u_video: gl.getUniformLocation(program, "u_video"),
    u_points: gl.getUniformLocation(program, "u_points"),
    u_maskActive: gl.getUniformLocation(program, "u_maskActive"),
    u_debug: gl.getUniformLocation(program, "u_debug"),
    u_resolution: gl.getUniformLocation(program, "u_resolution"),
    u_videoSize: gl.getUniformLocation(program, "u_videoSize"),
    u_invertStrength: gl.getUniformLocation(program, "u_invertStrength"),
    u_darkColor: gl.getUniformLocation(program, "u_darkColor"),
    u_lightColor: gl.getUniformLocation(program, "u_lightColor"),
    u_contrast: gl.getUniformLocation(program, "u_contrast"),
    u_brightness: gl.getUniformLocation(program, "u_brightness"),
    u_dotScale: gl.getUniformLocation(program, "u_dotScale"),
    u_patternMix: gl.getUniformLocation(program, "u_patternMix"),
  };

  return { gl, program, videoTex, uniforms };
}

// ---- hand tracking helpers -----------------------------------------
//
// The canvas fills the viewport and the video is displayed "cover"-style
// (scaled + center-cropped to fill it, no letterboxing). A fingertip's
// raw landmark position (normalized to the *video* frame) has to go
// through that exact same cover transform to land in screen space, or
// the mask corners drift off the visible video as soon as the canvas
// aspect ratio differs from the camera's. This is the inverse of the
// mapping the fragment shader's videoUvFor() applies when sampling —
// keep the two in sync if either changes.
//
// landmark: {x,y} normalized 0..1, origin top-left of the raw
// (non-mirrored, uncropped) video frame.
// returns: [x,y] in vUv screen space (origin bottom-left, mirrored,
// cover-cropped to the canvas).
function videoPointToScreenUv(landmark, canvasAspect, videoAspect) {
  const lx = landmark.x;
  const ly = landmark.y;
  let wx, sy;
  if (canvasAspect > videoAspect) {
    // canvas relatively wider than video -> fit width, crop top/bottom
    const k = videoAspect / canvasAspect;
    wx = 1.0 - lx;
    sy = 0.5 + (ly - 0.5) / k;
  } else {
    // canvas relatively taller than video -> fit height, crop left/right
    const k = canvasAspect / videoAspect;
    wx = 0.5 + (0.5 - lx) / k;
    sy = ly;
  }
  return [wx, 1.0 - sy];
}

// persistent smoothed node state, fixed perimeter order so the quad can
// fold into a bowtie/X when hands cross instead of re-flipping convex:
// leftThumb -> leftIndex -> rightIndex -> rightThumb
const smoothed = [
  [0.5, 0.5],
  [0.5, 0.5],
  [0.5, 0.5],
  [0.5, 0.5],
];
let smoothedInitialized = false;

function updateSmoothedPoints(targets, smoothing) {
  for (let i = 0; i < 4; i++) {
    if (!smoothedInitialized) {
      smoothed[i][0] = targets[i][0];
      smoothed[i][1] = targets[i][1];
    } else {
      smoothed[i][0] += (targets[i][0] - smoothed[i][0]) * smoothing;
      smoothed[i][1] += (targets[i][1] - smoothed[i][1]) * smoothing;
    }
  }
  smoothedInitialized = true;
}

// ---- main -------------------------------------------------------------
async function main() {
  statusEl.textContent = "requesting camera…";
  await setupWebcam();
  resizeCanvasToViewport();
  window.addEventListener("resize", resizeCanvasToViewport);

  statusEl.textContent = "loading hand model…";
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  });

  statusEl.textContent = "running";

  const { gl, videoTex, uniforms } = setupGL();
  const videoAspect = video.videoWidth / video.videoHeight;

  function frame() {
    requestAnimationFrame(frame);

    if (video.readyState < 2) return;

    const result = handLandmarker.detectForVideo(video, performance.now());
    const canvasAspect = canvas.width / canvas.height;

    // stable left/right assignment via MediaPipe's handedness classification
    // (based on hand morphology, not raw x-position) so corners don't swap
    // between frames the way index-based hand[0]/hand[1] could.
    let leftHandIdx = -1;
    let rightHandIdx = -1;
    if (result.handedness) {
      for (let i = 0; i < result.handedness.length; i++) {
        const label = result.handedness[i][0]?.categoryName;
        if (label === "Left") leftHandIdx = i;
        else if (label === "Right") rightHandIdx = i;
      }
    }

    const maskActive = leftHandIdx !== -1 && rightHandIdx !== -1;
    if (maskActive) {
      const leftLm = result.landmarks[leftHandIdx];
      const rightLm = result.landmarks[rightHandIdx];
      const targets = [
        videoPointToScreenUv(leftLm[THUMB_TIP], canvasAspect, videoAspect),
        videoPointToScreenUv(leftLm[INDEX_TIP], canvasAspect, videoAspect),
        videoPointToScreenUv(rightLm[INDEX_TIP], canvasAspect, videoAspect),
        videoPointToScreenUv(rightLm[THUMB_TIP], canvasAspect, videoAspect),
      ];
      updateSmoothedPoints(targets, CONFIG.SMOOTHING);
    } else {
      smoothedInitialized = false; // next re-acquisition snaps instead of flying in
    }

    // upload video frame
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uniforms.u_video, 0);

    gl.uniform2fv(uniforms.u_points, smoothed.flat());
    gl.uniform1i(uniforms.u_maskActive, maskActive ? 1 : 0);
    gl.uniform1i(uniforms.u_debug, CONFIG.DEBUG_DOTS ? 1 : 0);
    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.u_videoSize, video.videoWidth, video.videoHeight);
    gl.uniform1f(uniforms.u_invertStrength, CONFIG.INVERT_STRENGTH);

    const dark = getDarkColor();
    const light = getLightColor();
    gl.uniform3f(uniforms.u_darkColor, dark[0] / 255, dark[1] / 255, dark[2] / 255);
    gl.uniform3f(uniforms.u_lightColor, light[0] / 255, light[1] / 255, light[2] / 255);

    gl.uniform1f(uniforms.u_contrast, CONFIG.CONTRAST);
    gl.uniform1f(uniforms.u_brightness, CONFIG.BRIGHTNESS);
    gl.uniform1f(uniforms.u_dotScale, CONFIG.DOT_SCALE);
    gl.uniform1f(uniforms.u_patternMix, CONFIG.PATTERN_MIX);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = "error: " + err.message;
});
