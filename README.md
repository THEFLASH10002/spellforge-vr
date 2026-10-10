# SpellForge VR
Hand-tracked WebXR destruction sandbox: invent your own hand signs (Sigils), bind them to Arts, and shatter a Japanese-style district. Inspired by anime hand-sign combat; all content original.

## Run on Quest 2 (USB, no Wi-Fi)
1. Quest: developer mode + USB debugging; enable hand tracking.
2. `npm install && npm run dev`
3. `adb devices` (accept prompt in headset), then `adb reverse tcp:5173 tcp:5173`
4. Quest Browser -> `http://localhost:5173` -> Enter VR.

## Third-party (disclosure)
three (MIT), @dimforge/rapier3d-compat (Apache-2.0), @dgreenheck/three-pinata (MIT), three.quarks (MIT), Vite (MIT). Assets/audio: TBD, listed here as added.
