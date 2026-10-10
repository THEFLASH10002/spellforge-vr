// Data-driven Sanctum looks and rules.
export const PRESETS = [
  { name: 'Star Void', bg: 0x05020f, fog: 0x120a2e, fogNear: 4, fogFar: 28, hemiSky: 0x8a6bff, hemiGround: 0x120a20, hemiI: 1.1,
    sun: 0x9c7bff, sunI: 0.5, lantern: 0x8fd0ff, stars: 0xcfd8ff, floor: 0x2a2060,
    skyTop: 0x02000a, skyHorizon: 0x2a1260, skyGlow: 0x7a5cff, moon: 0xb8c8ff },
  { name: 'Crimson Dusk', bg: 0x1a0406, fog: 0x3a0c10, fogNear: 4, fogFar: 24, hemiSky: 0xff6a4a, hemiGround: 0x200808, hemiI: 1.0,
    sun: 0xff8844, sunI: 0.6, lantern: 0xff7a3a, stars: 0xffa060, floor: 0x5a2028,
    skyTop: 0x120204, skyHorizon: 0x5a1018, skyGlow: 0xff5a2a, moon: 0xff9070 },
];

export const RULES = [
  { id: 'lowgrav', name: 'Low Gravity' },
  { id: 'slowmo', name: 'Slow Time' },
  { id: 'shockwave', name: 'Pulse Shockwaves' },
];
