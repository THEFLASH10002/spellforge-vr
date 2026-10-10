import * as THREE from 'three';
import { distance } from '../gestures/PoseFeatures.js';
import { ARTS } from '../arts/ArtRegistry.js';

// Words floating under each tracked hand while you create a spell: which existing spell that hand is making right now
// ("Triple Fang · Bolt"), "Almost X" when it is close, or "New pose" when it matches nothing (a good thing to record!).
const hex = c => '#' + c.toString(16).padStart(6, '0');

export class HandLabels {
  constructor({ scene, getSigils, isLocked }) {
    this.getSigils = getSigils; this.isLocked = isLocked;
    this.items = ['left', 'right'].map(() => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      sprite.scale.set(0.26, 0.065, 1); sprite.renderOrder = 999; sprite.visible = false; scene.add(sprite);
      return { canvas, tex, sprite, text: '' };
    });
  }

  // Best single-hand match for a hand vector.
  match(vec) {
    let best = null;
    const mean = (vec[1] + vec[2] + vec[3] + vec[4]) / 4;
    for (const sg of this.getSigils()) {
      if (sg.hand === 'two' || this.isLocked(sg)) continue;
      if ((sg.minCurl && mean < sg.minCurl) || (sg.maxCurl && mean > sg.maxCurl)) continue;
      const ratio = distance(vec, sg.vec, sg.w) / sg.thresh;
      if (!best || ratio < best.ratio) best = { sg, ratio };
    }
    return best;
  }

  draw(item, text, color) {
    if (item.text === text + color) return;
    item.text = text + color;
    const c = item.canvas.getContext('2d');
    c.clearRect(0, 0, 512, 128);
    c.fillStyle = 'rgba(10,6,28,0.82)'; c.strokeStyle = color; c.lineWidth = 6;
    c.beginPath(); c.roundRect(8, 16, 496, 96, 40); c.fill(); c.stroke();
    c.textAlign = 'center'; c.fillStyle = '#ffffff'; c.shadowColor = color; c.shadowBlur = 12;
    let s = 52; c.font = `bold ${s}px Georgia, serif`;
    while (c.measureText(text).width > 460 && s > 22) { s -= 4; c.font = `bold ${s}px Georgia, serif`; }
    c.fillText(text, 256, 82);
    item.tex.needsUpdate = true;
  }

  update(visible, L, R) {
    [L, R].forEach((h, i) => {
      const it = this.items[i];
      it.sprite.visible = !!(visible && h);
      if (!it.sprite.visible) return;
      it.sprite.position.copy(h.wrist); it.sprite.position.y -= 0.13;
      const m = this.match(h.vec);
      if (m && m.ratio < 1) this.draw(it, `${m.sg.name} · ${ARTS[m.sg.artId]?.name || 'Sanctum'}`, hex(ARTS[m.sg.artId]?.color ?? 0xb98cff));
      else if (m && m.ratio < 1.6) this.draw(it, `Almost ${m.sg.name}`, '#ffd86b');
      else this.draw(it, 'New pose', '#9fe8ff');
    });
  }
}
