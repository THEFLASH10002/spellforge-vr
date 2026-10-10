// Spell progression: which Arts the player has unlocked, and the combination recipes. Saved in localStorage.
// Base spells (Bolt, Pull, Repel) and anything not listed as a recipe result (e.g. the Sanctum) are always available.
const KEY = 'spellforge.unlocks.v1';

// Recipes work for BOTH mechanics: two hand signs held together, or fusing two unlocked spells (orb merge / spellbook).
export const RECIPES = [
  { a: 'bolt', b: 'pull', result: 'well' },        // Bolt + Pull   = Blue   (Gravity Well)
  { a: 'bolt', b: 'push', result: 'repulsor' },    // Bolt + Repel  = Red    (Repulsor)
  { a: 'well', b: 'repulsor', result: 'nullpoint' }, // Blue + Red  = Purple (Nullpoint)
];
export const RESULTS = new Set(RECIPES.map(r => r.result));
export const recipeFor = (x, y) => RECIPES.find(r => (r.a === x && r.b === y) || (r.a === y && r.b === x)) || null;
export const recipeOf = result => RECIPES.find(r => r.result === result) || null;

// Player-facing names for the unlock popup: [colour word, in-game spell name].
export const UNLOCK_NAMES = { well: ['BLUE', 'Gravity Well'], repulsor: ['RED', 'Repulsor'], nullpoint: ['PURPLE', 'Nullpoint'] };

export class Unlocks {
  constructor() {
    this.set = new Set();
    try { for (const id of JSON.parse(localStorage.getItem(KEY) || '[]')) this.set.add(id); } catch { /* fresh start */ }
    this.listeners = [];
  }
  has(id) { return !RESULTS.has(id) || this.set.has(id); }   // not a recipe result => always available
  isLocked(id) { return !this.has(id); }
  onUnlock(fn) { this.listeners.push(fn); }
  // Returns true only the FIRST time (so a popup can never fire twice for the same spell).
  unlock(id, { silent = false } = {}) {
    if (!RESULTS.has(id) || this.set.has(id)) return false;
    this.set.add(id); this.save();
    if (!silent) for (const fn of this.listeners) fn(id);
    return true;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify([...this.set])); } catch { /* storage blocked */ } }
  reset() { this.set.clear(); this.save(); }
}
