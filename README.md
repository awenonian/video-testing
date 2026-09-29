# T-pose orbit video

A 10 s, 1080p30 video of a camera orbiting a T-posed human figure, made entirely from code.

- `scene/index.html` builds the figure procedurally in three.js (no downloaded models): each body part is a lathe-revolved profile or sphere, positioned by hand-picked joint coordinates.
- `render.mjs` loads the page in headless Chromium, steps the camera one frame at a time via `window.renderAt(t)`, screenshots each frame, and pipes the PNGs into ffmpeg (H.264).

```sh
npm install
pip install imageio-ffmpeg   # or set FFMPEG=/path/to/ffmpeg
node render.mjs              # -> out/t-pose-orbit.mp4
```

# Jester hat sewing pattern

`patterns/jester-hat/index.html` is a self-contained pattern generator (open it in any browser, no install or network needed).
Enter a head circumference and it drafts a jester hat with 2–5 two-colour horns and a harlequin diamond band, then exports:

- **Tiled PDF** (US Letter or A4) with a cover page, test squares, page map, instructions and alignment marks.
- **Full-size PDF** as a single sheet that fits a 36 in (91 cm) print-shop roll.
- **SVG** at real size (in cm), for projector sewing or cutting machines.

Pieces: horn panel (cut 3 in each colour as mirror pairs), a fold-over band, and a diamond appliqué template.
All geometry and the PDF writer are plain JavaScript in the `<script id="core">` block.
`patterns/jester-hat/examples/` has the output for a 57 cm head.
