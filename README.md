# T-pose orbit video

A 10 s, 1080p30 video of a camera orbiting a T-posed human figure, made entirely from code.

- `scene/index.html` builds the figure procedurally in three.js (no downloaded models): each body part is a lathe-revolved profile or sphere, positioned by hand-picked joint coordinates.
- `render.mjs` loads the page in headless Chromium, steps the camera one frame at a time via `window.renderAt(t)`, screenshots each frame, and pipes the PNGs into ffmpeg (H.264).

```sh
npm install
pip install imageio-ffmpeg   # or set FFMPEG=/path/to/ffmpeg
node render.mjs              # -> out/t-pose-orbit.mp4
```
