import * as THREE from 'three';

// One-time bake of a procedural nebula into an equirectangular texture (no ray-marching at runtime: the sky just
// samples this). Domain-warped fractal noise on the sphere (so there is no seam), blue / indigo / purple clouds,
// magenta + cyan filaments, dark dust lanes, and a brighter galactic band. Written for this project; the idea of baking
// the nebula into a texture is the only thing taken from the reference starfield demos (no code copied).
// The texture is stored gamma-encoded in an 8-bit target (half-float targets are not reliable on every headset):
// decode with pow(tex, 2.2) in the shader. Mapping: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5.
export function bakeNebula(renderer, width = 1024, height = 512, seed = 3.7) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    wrapS: THREE.RepeatWrapping,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSeed: { value: seed } },
    depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform float uSeed; varying vec2 vUv;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn(vec3 x){
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * vn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
      void main(){
        float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.1415927;
        vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        vec3 p = d * 2.2 + uSeed;
        vec3 q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(9.1, 3.7, 7.4)));   // domain warp
        float n1 = fbm(p + q * 1.6);                         // big cloud masses
        float n2 = fbm(p * 2.3 + q * 2.0 + 11.0);            // inner structure
        float ridge = pow(1.0 - abs(2.0 * fbm(p * 3.1 + q) - 1.0), 3.0); // filaments
        vec3 blue = vec3(0.10, 0.22, 0.95), indigo = vec3(0.22, 0.10, 0.75), purple = vec3(0.55, 0.12, 0.85);
        vec3 magenta = vec3(0.95, 0.20, 0.65), cyan = vec3(0.15, 0.65, 1.0);
        float cloud = smoothstep(0.35, 0.75, n1);
        vec3 col = vec3(0.004, 0.004, 0.02);
        col += mix(indigo, blue, n2) * cloud * 0.85;
        col += purple * smoothstep(0.45, 0.9, n2) * smoothstep(0.4, 0.8, n1) * 0.8;
        col += magenta * ridge * smoothstep(0.5, 0.85, n1) * 0.55;
        col += cyan * ridge * smoothstep(0.55, 0.9, n2) * 0.3;
        float lane = smoothstep(0.55, 0.75, fbm(p * 1.7 - q * 1.2 + 3.0));  // dark dust lanes
        col *= 1.0 - 0.7 * lane * cloud;
        float band = exp(-pow(dot(d, normalize(vec3(0.25, 0.85, 0.45))) * 3.0, 2.0)); // galactic band
        col *= 0.5 + 1.2 * band;
        gl_FragColor = vec4(pow(col * 0.85, vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget(), xr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  renderer.xr.enabled = xr;
  mat.dispose(); quad.geometry.dispose();
  return rt.texture;
}
