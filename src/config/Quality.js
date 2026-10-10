// Rendering quality presets. Pick with ?quality=quest|desktop|low (default: quest on Quest Browser, else desktop).
const PRESETS = {
  quest:   { pixelRatio: 1, xrScale: 0.9, foveation: 1, aa: true, stars: 500, outline: true, fx: 'lite', grass: 7000, trees: 14 },
  desktop: { pixelRatio: Math.min(devicePixelRatio || 1, 2), xrScale: 1.0, foveation: 0, aa: true, stars: 1500, outline: true, fx: 'full', grass: 18000, trees: 24 },
  low:     { pixelRatio: 1, xrScale: 0.75, foveation: 1, aa: false, stars: 200, outline: false, fx: 'lite', grass: 2500, trees: 8 },
};

const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
const param = new URLSearchParams(location.search).get('quality');

export const QUALITY_NAME = PRESETS[param] ? param : (isQuest ? 'quest' : 'desktop');
export const QUALITY = PRESETS[QUALITY_NAME];
