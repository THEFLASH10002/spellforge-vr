// One-call full reset for back-to-back judge demos.
export class Director {
  constructor({ targets, caster, onReset }) {
    this.targets = targets; this.caster = caster; this.onReset = onReset;
  }
  reset() {
    this.caster.clear();
    for (const t of this.targets) t.reset();
    this.onReset?.();
  }
}
