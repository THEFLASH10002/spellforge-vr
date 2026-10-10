// Rolling 1-second performance stats: fps, avg/worst frame ms, draw calls, triangles, physics bodies.
export class Perf {
  constructor() { this.t = 0; this.n = 0; this.sum = 0; this.worst = 0; this.text = 'perf: warming up'; }

  update(dt, renderer, physics) {
    this.t += dt; this.n++; this.sum += dt; this.worst = Math.max(this.worst, dt);
    if (this.t < 1) return;
    const i = renderer.info.render;
    this.text = `${(this.n / this.t).toFixed(0)}fps avg ${(this.sum / this.n * 1000).toFixed(1)}ms worst ${(this.worst * 1000).toFixed(0)}ms | ` +
      `calls ${i.calls} tris ${(i.triangles / 1000).toFixed(0)}k | bodies ${physics.synced.length}`;
    this.t = this.n = this.sum = this.worst = 0;
  }
}
