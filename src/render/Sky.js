import * as THREE from 'three';

// Gradient sky dome + moon sprite. Colors are uniforms so the Sanctum can tween them.
export class Sky {
  constructor(scene) {
    this.u = {
      top: { value: new THREE.Color(0x2c2c70) },      // sunset: indigo overhead
      horizon: { value: new THREE.Color(0xff9a7a) },  // pink-orange haze
      glow: { value: new THREE.Color(0xffd0a0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vP;
        void main(){
          float h = clamp(vP.y, 0.0, 1.0);
          vec3 c = mix(horizon, top, pow(h, 0.55));
          float g = pow(clamp(1.0 - h * 3.5, 0.0, 1.0), 2.0) * clamp(-vP.z * 0.5 + 0.5, 0.0, 1.0) * 0.55;
          c += glow * g;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 16), mat);
    this.dome.renderOrder = -2; this.dome.frustumCulled = false;
    scene.add(this.dome);

    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), halo = g.createRadialGradient(64, 64, 18, 64, 64, 64);
    halo.addColorStop(0, 'rgba(255,255,255,0.45)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 20, 0, Math.PI * 2); g.fill();
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ // the low setting sun (kept under the name "moon" for the Sanctum tween)
      map: new THREE.CanvasTexture(c), color: 0xffd09a, fog: false, depthWrite: false, transparent: true,
    }));
    this.moon.position.set(-22, 9, -62);
    this.moon.scale.setScalar(28);
    this.moon.renderOrder = -1;
    scene.add(this.moon);
  }
}
