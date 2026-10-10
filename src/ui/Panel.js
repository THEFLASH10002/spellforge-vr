import * as THREE from 'three';

// World-space canvas panel with text lines and poke buttons (index fingertip within ~3.5 cm).
export class Panel {
  constructor({ w = 0.5, h = 0.5, px = 512 } = {}) {
    this.w = w; this.h = h; this.px = px;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = px;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide }));
    this.buttons = []; this.lines = []; this.sig = '';
  }

  addButton(b) { this.buttons.push({ last: -1e9, ...b }); }
  setLines(lines) { this.lines = lines; }

  draw() {
    const sig = this.lines.join('|') + this.buttons.map(b => b.label).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const c = this.ctx, px = this.px;
    c.clearRect(0, 0, px, px);
    c.fillStyle = 'rgba(10,12,28,0.82)'; c.fillRect(0, 0, px, px);
    c.fillStyle = '#e8ecff'; c.font = '24px sans-serif';
    this.lines.forEach((t, i) => c.fillText(t, 14, 34 + i * 32));
    for (const b of this.buttons) {
      c.fillStyle = '#3b4cca'; c.fillRect(b.x, b.y, b.w, b.h);
      c.fillStyle = '#fff'; c.font = '26px sans-serif';
      c.fillText(b.label, b.x + 12, b.y + b.h / 2 + 9);
    }
    this.tex.needsUpdate = true;
  }

  poke(tips, now) {
    const v = new THREE.Vector3();
    for (const tip of tips) {
      if (!tip) continue;
      this.mesh.worldToLocal(v.copy(tip));
      if (Math.abs(v.z) > 0.035) continue;
      const u = (v.x / this.w + 0.5) * this.px, y = (0.5 - v.y / this.h) * this.px;
      for (const b of this.buttons) {
        if (u >= b.x && u <= b.x + b.w && y >= b.y && y <= b.y + b.h && now - b.last > 800) {
          b.last = now; b.onPress();
        }
      }
    }
  }
}
