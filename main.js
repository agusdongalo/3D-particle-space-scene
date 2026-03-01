import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CONFIG = {
  worldW: 220,
  worldH: 160,
  zMin: -260,
  zMax: 260,
  zScale: 260,
  refSize: 0.15,
  emaAlpha: 0.2,
  particleCount: 80000,
  // Force scales are tuned so motion is visible at typical scene scale.
  baseG: 420,
  baseW: 260,
  pinchBoost: 2.8,
  damping: 0.02,
  dtMax: 0.033,
  driftNoise: 0.004,
  maxSpeed: 4.5,
  orbitRadius: 22,
  compressRadius: 120,
  compressStrength: 9,
  compressAxialStrength: 6,
  compressDamping: 0.12,
  compressThickness: 14,
  galaxyArms: 4,
  galaxyTwist: 2.6,
  galaxyJitter: 1.1,
  galaxySpin: 30,
  galaxyHeight: 90,
  galaxyHelix: 140,
  lockCenter: true,
  ambientSpin: 0.6,
  ambientPull: 0.0,
  starCount: 12000,
  cameraOrbit: 18,
  spreadRadius: 200,
  eps: 0.0001,
  bounds: 260,
  pinchThreshold: 0.05,
};

const overlayHand = document.getElementById("hand-status");
const overlayPinch = document.getElementById("pinch-status");
const overlayMode = document.createElement("div");
const stopButton = document.getElementById("stop-camera");
const videoElement = document.getElementById("input-video");

let cameraRunning = true;
let handDetected = false;
let pinchActive = false;
let openPalm = false;
let fistActive = false;
let prevOpenPalm = false;
let prevFistActive = false;
let smoothedCenter = new THREE.Vector3(0, 0, 0);
let smoothedIndex = new THREE.Vector3(0, 0, 0);
let hasSmoothedCenter = false;
let hasSmoothedIndex = false;
let currentAxis = new THREE.Vector3(0, 0, 1);
const lockedCenter = new THREE.Vector3(0, 0, 0);

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000005, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const positions = new Float32Array(CONFIG.particleCount * 3);
const velocities = new Float32Array(CONFIG.particleCount * 3);
const colors = new Float32Array(CONFIG.particleCount * 3);

const color = new THREE.Color(0x97b8ff);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

const material = new THREE.PointsMaterial({
  color,
  size: 1.0,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
});

const points = new THREE.Points(geometry, material);
scene.add(points);

const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(CONFIG.starCount * 3);
for (let i = 0; i < CONFIG.starCount; i += 1) {
  const i3 = i * 3;
  const radius = 500 + Math.random() * 700;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const sinPhi = Math.sin(phi);
  starPositions[i3] = radius * sinPhi * Math.cos(theta);
  starPositions[i3 + 1] = radius * sinPhi * Math.sin(theta);
  starPositions[i3 + 2] = radius * Math.cos(phi);
}
starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));

const starMaterial = new THREE.PointsMaterial({
  color: 0x6c84b8,
  size: 1.4,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const starField = new THREE.Points(starGeometry, starMaterial);
scene.add(starField);

const setColorAt = (i3, z) => {
  const depth = (z + CONFIG.bounds) / (CONFIG.bounds * 2);
  const brightness = 0.35 + depth * 0.65;
  colors[i3] = 0.55 * brightness;
  colors[i3 + 1] = 0.72 * brightness;
  colors[i3 + 2] = 1.0 * brightness;
};

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

    setColorAt(i3, positions[i3 + 2]);
  }
};

initParticles();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const updateOverlay = () => {
  overlayHand.textContent = `Hand detected ${handDetected ? "✅" : "❌"}`;
  overlayPinch.textContent = `Pinch ${pinchActive ? "ON" : "OFF"}`;
  if (fistActive) {
    overlayMode.textContent = "Mode: Galaxy";
  } else if (pinchActive) {
    overlayMode.textContent = "Mode: Black Hole";
  } else if (openPalm) {
    overlayMode.textContent = "Mode: Soft Pull";
  } else {
    overlayMode.textContent = "Mode: Normal";
  }
};

updateOverlay();

overlayMode.textContent = "Mode: Normal";
document.getElementById("overlay").appendChild(overlayMode);

const processParticles = (dt) => {
  const {
    baseG,
    baseW,
    pinchBoost,
    damping,
    driftNoise,
    maxSpeed,
    orbitRadius,
    compressRadius,
    compressStrength,
    compressAxialStrength,
    compressDamping,
    compressThickness,
    galaxySpin,
    galaxyHeight,
    galaxyHelix,
    ambientSpin,
    ambientPull,
    eps,
    bounds,
  } = CONFIG;

  const center = CONFIG.lockCenter ? lockedCenter : smoothedCenter;
  const gravityCenter = CONFIG.lockCenter ? lockedCenter : smoothedIndex;
  const maxSpeed2 = maxSpeed * maxSpeed;

  let G = pinchActive ? baseG * pinchBoost : baseG;
  let W = pinchActive ? baseW * pinchBoost : baseW;
  let orbitScale = 1;

  if (openPalm && !pinchActive) {
    G *= 0.35;
    W *= 0.8;
    orbitScale = 2.2;
  }

  if (pinchActive) {
    W *= 1.3;
    orbitScale *= 0.8;
  }

  for (let i = 0; i < CONFIG.particleCount; i += 1) {
    const i3 = i * 3;
    let px = positions[i3];
    let py = positions[i3 + 1];
    let pz = positions[i3 + 2];
    let vx = velocities[i3];
    let vy = velocities[i3 + 1];
    let vz = velocities[i3 + 2];

    // Always keep a tiny drift so motion is visible even when forces are low.
    const driftScale = fistActive ? 0.02 : handDetected ? 0.2 : 0.45;
    vx += (Math.random() - 0.5) * driftNoise * driftScale;
    vy += (Math.random() - 0.5) * driftNoise * driftScale;
    vz += (Math.random() - 0.5) * driftNoise * driftScale;

    if (handDetected) {
      const gx = gravityCenter.x - px;
      const gy = gravityCenter.y - py;
      const gz = gravityCenter.z - pz;
      const gR2 = gx * gx + gy * gy + gz * gz + eps;
      const gR = Math.sqrt(gR2);
      const gInvR = 1 / gR;
      const gNx = gx * gInvR;
      const gNy = gy * gInvR;
      const gNz = gz * gInvR;

      const dx = center.x - px;
      const dy = center.y - py;
      const dz = center.z - pz;
      const r2 = dx * dx + dy * dy + dz * dz + eps;
      const r = Math.sqrt(r2);
      const invR = 1 / r;
      const nx = dx * invR;
      const ny = dy * invR;
      const nz = dz * invR;

      if (fistActive) {
        const axis = currentAxis;
        const dot = dx * axis.x + dy * axis.y + dz * axis.z;
        const projX = axis.x * dot;
        const projY = axis.y * dot;
        const projZ = axis.z * dot;

        let rx = dx - projX;
        let ry = dy - projY;
        let rz = dz - projZ;
        let rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (rLen < eps) {
          rx = axis.y;
          ry = -axis.x;
          rz = 0;
          rLen = Math.sqrt(rx * rx + ry * ry + rz * rz) + eps;
        }

        const rDirX = rx / rLen;
        const rDirY = ry / rLen;
        const rDirZ = rz / rLen;

        const radialForce = -rLen * compressStrength;
        const axialForce = -dot * compressAxialStrength;

        let tx = axis.y * rz - axis.z * ry;
        let ty = axis.z * rx - axis.x * rz;
        let tz = axis.x * ry - axis.y * rx;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) + eps;
        tx /= tLen;
        ty /= tLen;
        tz /= tLen;

        const swirlForce = galaxySpin / (rLen + eps);

        const fx = radialForce * rDirX + axialForce * axis.x + swirlForce * tx;
        const fy = radialForce * rDirY + axialForce * axis.y + swirlForce * ty;
        const fz = radialForce * rDirZ + axialForce * axis.z + swirlForce * tz;

        vx += fx * dt;
        vy += fy * dt;
        vz += fz * dt;

        vx *= 1 - compressDamping;
        vy *= 1 - compressDamping;
        vz *= 1 - compressDamping;
      } else {
        let gravScale = 1;
        let vortexScale = 1;
        const scaledOrbit = orbitRadius * orbitScale;
        if (r < scaledOrbit) {
          const closeFactor = 1 - r / scaledOrbit;
          gravScale = 1 - closeFactor * 0.85;
          vortexScale = 1 + closeFactor * 1.5;
        }

        const gravStrength = (G * gravScale) / gR2;

        const axis = currentAxis;
        let tx = axis.y * dz - axis.z * dy;
        let ty = axis.z * dx - axis.x * dz;
        let tz = axis.x * dy - axis.y * dx;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) + eps;
        tx /= tLen;
        ty /= tLen;
        tz /= tLen;

        const vortexStrength = (W * vortexScale) / (r + eps);

        const fx = gravStrength * gNx + vortexStrength * tx;
        const fy = gravStrength * gNy + vortexStrength * ty;
        const fz = gravStrength * gNz + vortexStrength * tz;

        vx += fx * dt;
        vy += fy * dt;
        vz += fz * dt;
      }
    } else {
      // Ambient motion even without hand: gentle spin + slight pull toward center.
      const dx = center.x - px;
      const dy = center.y - py;
      const dz = center.z - pz;
      const r2 = dx * dx + dy * dy + dz * dz + eps;
      const r = Math.sqrt(r2);

      const axis = currentAxis;
      let tx = axis.y * dz - axis.z * dy;
      let ty = axis.z * dx - axis.x * dz;
      let tz = axis.x * dy - axis.y * dx;
      const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) + eps;
      tx /= tLen;
      ty /= tLen;
      tz /= tLen;

      const spinForce = ambientSpin / (r + eps);
      const pullForce = ambientPull;

      vx += (spinForce * tx + pullForce * dx) * dt;
      vy += (spinForce * ty + pullForce * dy) * dt;
      vz += (spinForce * tz + pullForce * dz) * dt;
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

    setColorAt(i3, pz);
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
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
  const t = clock.elapsedTime;
  camera.position.x = Math.sin(t * 0.18) * CONFIG.cameraOrbit;
  camera.position.y = Math.sin(t * 0.12) * (CONFIG.cameraOrbit * 0.55);
  camera.lookAt(0, 0, 0);
  starField.rotation.y += 0.0004;
  starField.rotation.x += 0.0002;
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

const computeAxis = (landmarks) => {
  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  const v1 = {
    x: indexMcp.x - wrist.x,
    y: indexMcp.y - wrist.y,
    z: indexMcp.z - wrist.z,
  };
  const v2 = {
    x: pinkyMcp.x - wrist.x,
    y: pinkyMcp.y - wrist.y,
    z: pinkyMcp.z - wrist.z,
  };

  const cross = {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x,
  };

  const mapped = new THREE.Vector3(cross.x, -cross.y, -cross.z);
  const len = mapped.length();
  if (len < 1e-4) {
    return new THREE.Vector3(0, 0, 1);
  }
  return mapped.multiplyScalar(1 / len);
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

const applyInstantCompress = () => {
  const axis = currentAxis.clone().normalize();
  const center = (CONFIG.lockCenter ? lockedCenter : smoothedCenter).clone();
  let basis1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.dot(basis1)) > 0.9) {
    basis1.set(0, 1, 0);
  }
  basis1.cross(axis).normalize();
  const basis2 = new THREE.Vector3().crossVectors(axis, basis1).normalize();

  for (let i = 0; i < CONFIG.particleCount; i += 1) {
    const i3 = i * 3;
    const radius = Math.pow(Math.random(), 0.7) * CONFIG.compressRadius;
    const arm = Math.floor(Math.random() * CONFIG.galaxyArms);
    const baseAngle = (arm / CONFIG.galaxyArms) * Math.PI * 2;
    const twist = radius / CONFIG.compressRadius;
    const angle =
      baseAngle + twist * CONFIG.galaxyTwist * Math.PI * 2 + (Math.random() - 0.5) * CONFIG.galaxyJitter;
    const heightFactor = radius / CONFIG.compressRadius - 0.5;
    const axial =
      (Math.random() - 0.5) * CONFIG.galaxyHeight +
      heightFactor * CONFIG.galaxyHelix +
      (Math.random() - 0.5) * CONFIG.compressThickness;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const px = center.x + basis1.x * cosA * radius + basis2.x * sinA * radius + axis.x * axial;
    const py = center.y + basis1.y * cosA * radius + basis2.y * sinA * radius + axis.y * axial;
    const pz = center.z + basis1.z * cosA * radius + basis2.z * sinA * radius + axis.z * axial;

    positions[i3] = px;
    positions[i3 + 1] = py;
    positions[i3 + 2] = pz;

    const rx = basis1.x * cosA * radius + basis2.x * sinA * radius;
    const ry = basis1.y * cosA * radius + basis2.y * sinA * radius;
    const rz = basis1.z * cosA * radius + basis2.z * sinA * radius;
    const t = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(rx, ry, rz)).normalize();
    velocities[i3] = t.x * (CONFIG.galaxySpin * 0.08);
    velocities[i3 + 1] = t.y * (CONFIG.galaxySpin * 0.08);
    velocities[i3 + 2] = t.z * (CONFIG.galaxySpin * 0.08);
    setColorAt(i3, pz);
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
};

const applyInstantSpread = () => {
  const center = (CONFIG.lockCenter ? lockedCenter : smoothedCenter).clone();
  const spreadRadius = CONFIG.spreadRadius;
  for (let i = 0; i < CONFIG.particleCount; i += 1) {
    const i3 = i * 3;
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const radius = Math.cbrt(Math.random()) * spreadRadius;

    const sinPhi = Math.sin(phi);
    const dx = radius * sinPhi * Math.cos(theta);
    const dy = radius * sinPhi * Math.sin(theta);
    const dz = radius * Math.cos(phi);

    positions[i3] = center.x + dx;
    positions[i3 + 1] = center.y + dy;
    positions[i3 + 2] = center.z + dz;

    const inv = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) + CONFIG.eps);
    velocities[i3] = dx * inv * 0.6;
    velocities[i3 + 1] = dy * inv * 0.6;
    velocities[i3 + 2] = dz * inv * 0.6;
    setColorAt(i3, positions[i3 + 2]);
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
};

const isFingerExtended = (wrist, mcp, tip) => {
  const wristToTip = distance3D(wrist, tip);
  const wristToMcp = distance3D(wrist, mcp);
  return wristToTip > wristToMcp * 1.25;
};

const isOpenPalm = (landmarks) => {
  const wrist = landmarks[0];
  const indexExtended = isFingerExtended(wrist, landmarks[5], landmarks[8]);
  const middleExtended = isFingerExtended(wrist, landmarks[9], landmarks[12]);
  const ringExtended = isFingerExtended(wrist, landmarks[13], landmarks[16]);
  const pinkyExtended = isFingerExtended(wrist, landmarks[17], landmarks[20]);
  const extendedCount =
    (indexExtended ? 1 : 0) +
    (middleExtended ? 1 : 0) +
    (ringExtended ? 1 : 0) +
    (pinkyExtended ? 1 : 0);
  return extendedCount >= 3;
};

const isPointing = (landmarks) => {
  const wrist = landmarks[0];
  const indexExtended = isFingerExtended(wrist, landmarks[5], landmarks[8]);
  const middleExtended = isFingerExtended(wrist, landmarks[9], landmarks[12]);
  const ringExtended = isFingerExtended(wrist, landmarks[13], landmarks[16]);
  const pinkyExtended = isFingerExtended(wrist, landmarks[17], landmarks[20]);

  // Index finger up, other fingers curled.
  return indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
};

const isFist = (landmarks) => {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexMcp = landmarks[5];
  const middleMcp = landmarks[9];
  const ringMcp = landmarks[13];
  const pinkyMcp = landmarks[17];

  const thumbClose = distance3D(thumbTip, indexTip) < CONFIG.pinchThreshold * 1.3;
  const indexCurled = distance3D(wrist, indexTip) < distance3D(wrist, indexMcp) * 1.05;
  const middleCurled = distance3D(wrist, middleTip) < distance3D(wrist, middleMcp) * 1.05;
  const ringCurled = distance3D(wrist, ringTip) < distance3D(wrist, ringMcp) * 1.05;
  const pinkyCurled = distance3D(wrist, pinkyTip) < distance3D(wrist, pinkyMcp) * 1.05;

  const curledCount =
    (indexCurled ? 1 : 0) +
    (middleCurled ? 1 : 0) +
    (ringCurled ? 1 : 0) +
    (pinkyCurled ? 1 : 0);

  return curledCount >= 3 && thumbClose;
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
    const indexTip = landmarks[8];
    const worldIndex = mapToWorld(indexTip, handSize);

    if (!hasSmoothedCenter) {
      smoothedCenter.copy(worldCenter);
      hasSmoothedCenter = true;
    } else {
      smoothedCenter.lerp(worldCenter, CONFIG.emaAlpha);
    }

    if (!hasSmoothedIndex) {
      smoothedIndex.copy(worldIndex);
      hasSmoothedIndex = true;
    } else {
      smoothedIndex.lerp(worldIndex, CONFIG.emaAlpha);
    }

    pinchActive = isPointing(landmarks);
    openPalm = isOpenPalm(landmarks);
    fistActive = isFist(landmarks);
    currentAxis = computeAxis(landmarks);

    if (fistActive && !prevFistActive) {
      applyInstantCompress();
    }
    if (openPalm && !prevOpenPalm) {
      applyInstantSpread();
    }
  } else {
    pinchActive = false;
    openPalm = false;
    fistActive = false;
  }

  prevFistActive = fistActive;
  prevOpenPalm = openPalm;
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
  fistActive = false;
  prevFistActive = false;
  prevOpenPalm = false;
  updateOverlay();
});
