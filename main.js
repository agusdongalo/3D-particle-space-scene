import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CONFIG = {
  worldW: 220,
  worldH: 160,
  zMin: -260,
  zMax: 260,
  zScale: 260,
  refSize: 0.15,
  emaAlpha: 0.2,
  particleCount: 60000,
  // Force scales are tuned so motion is visible at typical scene scale.
  baseG: 420,
  baseW: 260,
  pinchBoost: 2.8,
  damping: 0.02,
  dtMax: 0.033,
  driftNoise: 0.004,
  maxSpeed: 4.0,
  orbitRadius: 22,
  eps: 0.0001,
  bounds: 260,
  pinchThreshold: 0.05,
};

const overlayHand = document.getElementById("hand-status");
const overlayPinch = document.getElementById("pinch-status");
const stopButton = document.getElementById("stop-camera");
const videoElement = document.getElementById("input-video");

let cameraRunning = true;
let handDetected = false;
let pinchActive = false;
let smoothedCenter = new THREE.Vector3(0, 0, 0);
let hasSmoothedCenter = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02030b, 0.0022);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.z = 300;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000005, 1);
document.body.appendChild(renderer.domElement);

const positions = new Float32Array(CONFIG.particleCount * 3);
const velocities = new Float32Array(CONFIG.particleCount * 3);

const color = new THREE.Color(0x97b8ff);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

const material = new THREE.PointsMaterial({
  color,
  size: 1.1,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const points = new THREE.Points(geometry, material);
scene.add(points);

const initParticles = () => {
  const spread = CONFIG.bounds;
  for (let i = 0; i < CONFIG.particleCount; i += 1) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * spread * 2;
    positions[i3 + 1] = (Math.random() - 0.5) * spread * 2;
    positions[i3 + 2] = (Math.random() - 0.5) * spread * 2;

    velocities[i3] = (Math.random() - 0.5) * 0.15;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.15;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.15;
  }
};

initParticles();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const updateOverlay = () => {
  overlayHand.textContent = `Hand detected ${handDetected ? "✅" : "❌"}`;
  overlayPinch.textContent = `Pinch ${pinchActive ? "ON" : "OFF"}`;
};

updateOverlay();

const processParticles = (dt) => {
  const {
    baseG,
    baseW,
    pinchBoost,
    damping,
    driftNoise,
    maxSpeed,
    orbitRadius,
    eps,
    bounds,
  } = CONFIG;

  const center = smoothedCenter;
  const maxSpeed2 = maxSpeed * maxSpeed;

  const G = pinchActive ? baseG * pinchBoost : baseG;
  const W = pinchActive ? baseW * pinchBoost : baseW;

  for (let i = 0; i < CONFIG.particleCount; i += 1) {
    const i3 = i * 3;
    let px = positions[i3];
    let py = positions[i3 + 1];
    let pz = positions[i3 + 2];
    let vx = velocities[i3];
    let vy = velocities[i3 + 1];
    let vz = velocities[i3 + 2];

    // Always keep a tiny drift so motion is visible even when forces are low.
    vx += (Math.random() - 0.5) * driftNoise * 0.2;
    vy += (Math.random() - 0.5) * driftNoise * 0.2;
    vz += (Math.random() - 0.5) * driftNoise * 0.2;

    if (handDetected) {
      const dx = center.x - px;
      const dy = center.y - py;
      const dz = center.z - pz;
      const r2 = dx * dx + dy * dy + dz * dz + eps;
      const r = Math.sqrt(r2);
      const invR = 1 / r;
      const nx = dx * invR;
      const ny = dy * invR;
      const nz = dz * invR;

      let gravScale = 1;
      let vortexScale = 1;
      if (r < orbitRadius) {
        const closeFactor = 1 - r / orbitRadius;
        gravScale = 1 - closeFactor * 0.85;
        vortexScale = 1 + closeFactor * 1.5;
      }

      const gravStrength = (G * gravScale) / r2;

      let tx = -dy;
      let ty = dx;
      let tz = 0;
      const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) + eps;
      tx /= tLen;
      ty /= tLen;

      const vortexStrength = (W * vortexScale) / (r + eps);

      const fx = gravStrength * nx + vortexStrength * tx;
      const fy = gravStrength * ny + vortexStrength * ty;
      const fz = gravStrength * nz + vortexStrength * tz;

      vx += fx * dt;
      vy += fy * dt;
      vz += fz * dt;
    }

    vx *= 1 - damping;
    vy *= 1 - damping;
    vz *= 1 - damping;

    const speed2 = vx * vx + vy * vy + vz * vz;
    if (speed2 > maxSpeed2) {
      const s = Math.sqrt(speed2);
      const scale = maxSpeed / s;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }

    px += vx * dt;
    py += vy * dt;
    pz += vz * dt;

    if (px > bounds) px = -bounds;
    if (px < -bounds) px = bounds;
    if (py > bounds) py = -bounds;
    if (py < -bounds) py = bounds;
    if (pz > bounds) pz = -bounds;
    if (pz < -bounds) pz = bounds;

    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;
    velocities[i3] = vx;
    velocities[i3 + 1] = vy;
    velocities[i3 + 2] = vz;
  }

  geometry.attributes.position.needsUpdate = true;
};

const onResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", onResize);

const clock = new THREE.Clock();
const animate = () => {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), CONFIG.dtMax);
  processParticles(dt);
  renderer.render(scene, camera);
};

animate();

const computeHandCenter = (landmarks) => {
  const ids = [0, 5, 9, 13, 17];
  const center = { x: 0, y: 0, z: 0 };
  for (const id of ids) {
    const lm = landmarks[id];
    center.x += lm.x;
    center.y += lm.y;
    center.z += lm.z;
  }
  center.x /= ids.length;
  center.y /= ids.length;
  center.z /= ids.length;
  return center;
};

const distance3D = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const mapToWorld = (center, handSize) => {
  const x3 = (center.x - 0.5) * CONFIG.worldW;
  const y3 = -(center.y - 0.5) * CONFIG.worldH;
  const z3 = clamp(
    (CONFIG.refSize / handSize - 1) * CONFIG.zScale,
    CONFIG.zMin,
    CONFIG.zMax
  );
  return new THREE.Vector3(x3, y3, z3);
};

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.5,
});

hands.onResults((results) => {
  const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  handDetected = Boolean(hasHand);

  if (handDetected) {
    const landmarks = results.multiHandLandmarks[0];
    const center = computeHandCenter(landmarks);
    const handSize = distance3D(landmarks[5], landmarks[17]);
    const worldCenter = mapToWorld(center, handSize);

    if (!hasSmoothedCenter) {
      smoothedCenter.copy(worldCenter);
      hasSmoothedCenter = true;
    } else {
      smoothedCenter.lerp(worldCenter, CONFIG.emaAlpha);
    }

    const pinchDist = distance3D(landmarks[4], landmarks[8]);
    pinchActive = pinchDist < CONFIG.pinchThreshold;
  } else {
    pinchActive = false;
  }

  updateOverlay();
});

const mpCamera = new Camera(videoElement, {
  onFrame: async () => {
    if (!cameraRunning) return;
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});

mpCamera.start();

stopButton.addEventListener("click", () => {
  cameraRunning = false;
  const stream = videoElement.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  videoElement.srcObject = null;
  handDetected = false;
  pinchActive = false;
  updateOverlay();
});
