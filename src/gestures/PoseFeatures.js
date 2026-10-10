import * as THREE from 'three';

// Per-hand feature vector (HAND_DIM floats):
//   [0..4]   finger straightness (thumb,index,middle,ring,pinky): 1 = straight, ~0.5 = curled
//   [5..7]   palm normal in head frame (mirrored so left/right hands are comparable)
//   [8..22]  5 fingertip positions in wrist frame / palm length (x mirrored for left hand)
export const HAND_DIM = 23;
export const SLOT = { curl: 0, normal: 5, tips: 8 };

const FINGERS = [
  ['thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
];

const pool = {};
const f = new THREE.Vector3(), s = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3();

function pos(J, name) {
  const v = (pool[name] ||= new THREE.Vector3());
  J[name].getWorldPosition(v);
  return v;
}

// Returns { vec, wrist, L, fwd, tip, curls } or null if the hand is not tracked.
export function extractHand(hand, handedness, headInv) {
  const J = hand.joints;
  if (!J || !J.wrist || !J.wrist.visible || !J['index-finger-tip']) return null;
  hand.updateMatrixWorld(true);
  const right = handedness === 'right';
  const wrist = pos(J, 'wrist').clone();
  const mid = pos(J, 'middle-finger-phalanx-proximal');
  f.copy(mid).sub(wrist);
  const L = f.length();
  if (L < 0.02) return null;
  f.divideScalar(L);
  s.copy(pos(J, 'index-finger-phalanx-proximal')).sub(pos(J, 'pinky-finger-phalanx-proximal'));
  s.addScaledVector(f, -s.dot(f)).normalize();
  n.crossVectors(f, s);
  if (right) n.negate(); // palm-out normal
  const vec = new Float32Array(HAND_DIM);
  const curls = [];
  FINGERS.forEach((names, i) => {
    let len = 0, prev = null;
    for (const nm of names) { const p = pos(J, nm); if (prev) len += p.distanceTo(prev); prev = p; }
    const c = pos(J, names[0]).distanceTo(prev) / len;
    vec[SLOT.curl + i] = c; curls.push(c);
    d.copy(prev).sub(wrist);
    const o = SLOT.tips + i * 3;
    vec[o] = (d.dot(s) * (right ? 1 : -1)) / L;
    vec[o + 1] = d.dot(f) / L;
    vec[o + 2] = d.dot(n) / L;
  });
  d.copy(n).applyQuaternion(headInv);
  vec[SLOT.normal] = d.x; vec[SLOT.normal + 1] = d.y; vec[SLOT.normal + 2] = d.z;
  return {
    vec, wrist, L, curls,
    fwd: f.clone(),
    normal: n.clone(), // world-space palm-out direction
    tip: pos(J, 'index-finger-tip').clone(),
  };
}

// Two-hand vector: [left, right, right-wrist minus left-wrist in head frame / avg palm length]
export function twoHandVec(l, r, headInv) {
  const v = new Float32Array(HAND_DIM * 2 + 3);
  v.set(l.vec, 0); v.set(r.vec, HAND_DIM);
  d.copy(r.wrist).sub(l.wrist).applyQuaternion(headInv).divideScalar((l.L + r.L) / 2);
  v[HAND_DIM * 2] = d.x; v[HAND_DIM * 2 + 1] = d.y; v[HAND_DIM * 2 + 2] = d.z;
  return v;
}

// Weighted RMS distance.
export function distance(a, b, w) {
  let sum = 0, ws = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; sum += w[i] * x * x; ws += w[i]; }
  return Math.sqrt(sum / ws);
}

// Weight vector helper. curl: array of 5, normal: scalar, tips: scalar.
export function handWeights({ curl, normal = 0, tips = 0 }) {
  const w = new Float32Array(HAND_DIM);
  curl.forEach((x, i) => (w[SLOT.curl + i] = x));
  for (let i = 0; i < 3; i++) w[SLOT.normal + i] = normal;
  for (let i = 0; i < 15; i++) w[SLOT.tips + i] = tips;
  return w;
}
