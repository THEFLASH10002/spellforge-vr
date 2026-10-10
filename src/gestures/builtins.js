import { HAND_DIM, SLOT, handWeights } from './PoseFeatures.js';

// Straightness targets: extended ~0.97, curled ~0.55. TUNE ON DEVICE using the HUD readout.
const E = 0.97, C = 0.55;

function tpl(curl, normal) {
  const v = new Float32Array(HAND_DIM);
  curl.forEach((x, i) => (v[SLOT.curl + i] = x));
  if (normal) v.set(normal, SLOT.normal);
  return v;
}

// Built-in Sigils are rule-style: only curl (and optionally palm direction) are compared.
export const BUILTINS = [
  {
    id: 'twin-fang', name: 'Twin Fang', hand: 'any', artId: 'bolt', builtin: true, thresh: 0.12,
    vec: tpl([0, E, E, C, C]),
    w: handWeights({ curl: [0, 1, 1, 1, 1] }), // thumb ignored
  },
  {
    id: 'repel-palm', name: 'Repel Palm', hand: 'any', artId: 'push', builtin: true, thresh: 0.12,
    vec: tpl([E, E, E, E, E], [0, 0, -1]), // open hand, palm facing away from head
    w: handWeights({ curl: [1, 1, 1, 1, 1], normal: 2 }),
  },
];
