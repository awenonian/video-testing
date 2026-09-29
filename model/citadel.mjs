// Builds the top of Minas Tirith (the Court of the Fountain and the prow) as a
// gaming tile, as a single watertight solid with manifold-3d CSG.
//
// Units are millimetres at 32mm scale (~1:56). Axes: X runs from the Citadel
// wall (x = 0) out to the tip of the prow, Y is across, Z is up. The tile sits
// on the table at z = 0 and its paved top is at z = H; the edges drop away as
// a rough rock face, so anything past them is "falling". Walls, the tree and
// the Citadel front stand on top of that surface. It is large on purpose:
// scale and cut it in the slicer.
//
//   node model/citadel.mjs  ->  out/citadel.stl, out/citadel.bin, out/citadel.json
import fs from 'node:fs';
import path from 'node:path';
import Module from 'manifold-3d';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'out');
const wasm = await Module();
wasm.setup();
const { CrossSection, Manifold } = wasm;

// ---------------------------------------------------------------- dimensions
const H = 9;                    // table to paved top
const HALF = 185;               // half-width of the courtyard end
const TIP = 950;                // x of the prow's point
const ROOT_LEN = 300;           // straight-sided courtyard section before the spur starts to taper
const COURT = { x: 185, R: 128 };
const PARAPET = { w: 4.5, h: 11 };
const FACADE_D = 14;            // thickness of the Citadel wall at x = 0
const BAND = 14;                // half-width of the processional path along the spur

// ---------------------------------------------------------------- colour groups
const PALETTE = {
  rock:    { color: 0x7b7266, roughness: 1 },
  paving:  { color: 0xd9d4c8, roughness: 0.9 },
  joint:   { color: 0x9c968a, roughness: 1 },
  path:    { color: 0xc9c2b2, roughness: 0.85 },
  wall:    { color: 0xeeebe3, roughness: 0.8 },
  lawn:    { color: 0x5f7d3c, roughness: 1 },
  water:   { color: 0x3d5f78, roughness: 0.15, metalness: 0.3 },
  tree:    { color: 0xf1efe8, roughness: 0.7 },
  wood:    { color: 0x3b3a3f, roughness: 0.6 },
  metal:   { color: 0xb9b4a6, roughness: 0.35, metalness: 0.8 },
  glass:   { color: 0x23272e, roughness: 0.3 },
};
const GROUPS = Object.keys(PALETTE);
const idGroup = new Map();
function tag(m, group) {
  const o = m.asOriginal();
  idGroup.set(o.originalID(), GROUPS.indexOf(group));
  return o;
}
const parts = [];
const add = (m, group) => parts.push(tag(m, group));
const floorParts = [];   // flush floor pieces: the paving joints get cut into these
const addFloor = (m, group) => floorParts.push(tag(m, group));

// ---------------------------------------------------------------- helpers
const rect = (x0, y0, x1, y1) => CrossSection.square([x1 - x0, y1 - y0]).translate([x0, y0]);
const rectC = (cx, cy, w, h) => rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
const circle = (cx, cy, r, n = 96) => CrossSection.circle(r, n).translate([cx, cy]);
const annulus = (cx, cy, r0, r1, n = 160) => circle(cx, cy, r1, n).subtract(circle(cx, cy, r0, n));
const poly = pts => new CrossSection([pts], 'NonZero');
const unionCS = list => CrossSection.union(list);
const slab = (cs, z0, z1) => cs.extrude(z1 - z0).translate([0, 0, z0]);
const arch = (cx, y0, w, spring) => rect(cx - w / 2, y0, cx + w / 2, spring).add(
  circle(cx, spring, w / 2, 96).intersect(rect(cx - w, spring, cx + w, spring + w)));
function starPts(cx, cy, R, r = R * 0.42, n = 5, rot = 90) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (rot + i * 180 / n) * Math.PI / 180, rr = i % 2 ? r : R;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return pts;
}
function bevel(cs, z0, z1, bev) {
  const b = cs.bounds(), cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  return cs.translate([-cx, -cy]).extrude(z1 - z0, 0, 0, [Math.max(0.05, (w - 2 * bev) / w), Math.max(0.05, (h - 2 * bev) / h)])
    .translate([cx, cy, z0]);
}
// deterministic RNG and value noise for the rock
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = t => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++)
    r += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}
const fbm = (x, y, z) => 0.55 * vnoise(x, y, z) + 0.3 * vnoise(2.1 * x, 2.1 * y, 2.1 * z) + 0.15 * vnoise(4.3 * x, 4.3 * y, 4.3 * z);

// ================================================================ OUTLINE
// Straight sides along the courtyard, then a gently convex taper to the prow's point.
function outlinePts(step = 2) {
  const side = [];
  for (let x = 0; x < ROOT_LEN; x += step) side.push([x, HALF]);
  const P0 = [ROOT_LEN, HALF], C1 = [ROOT_LEN + 260, HALF], C2 = [TIP - 220, 70], P3 = [TIP, 0];
  const bez = t => [0, 1].map(k => (1 - t) ** 3 * P0[k] + 3 * (1 - t) ** 2 * t * C1[k] + 3 * (1 - t) * t * t * C2[k] + t ** 3 * P3[k]);
  // resample the curve at roughly `step` spacing
  const dense = []; for (let i = 0; i <= 4000; i++) dense.push(bez(i / 4000));
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (acc >= step || i === dense.length - 1) { side.push(dense[i]); acc = 0; }
  }
  side.pop(); // tip added once below
  const pts = [...side, [TIP, 0], ...side.slice().reverse().map(([x, y]) => [x, -y])];
  for (let y = -HALF + step; y < HALF; y += step) pts.push([0, y]);   // the cut edge behind the Citadel wall
  return pts;
}
const OUTLINE = outlinePts();
const outlineCS = poly(OUTLINE);

// outward normals at each outline vertex (for the rock-face warp and post placement)
const normalAt = new Map();
const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
const N = OUTLINE.length;
const ccw = OUTLINE.reduce((s, p, i) => { const q = OUTLINE[(i + 1) % N]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0;
const outward = i => {
  const a = OUTLINE[(i - 1 + N) % N], b = OUTLINE[(i + 1) % N];
  let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
  return ccw ? [ty, -tx] : [-ty, tx];
};
OUTLINE.forEach((p, i) => normalAt.set(key(...p), outward(i)));

// ================================================================ ROCK BODY
{
  let rock = outlineCS.extrude(H, Math.ceil(H) - 1);
  // push side vertices outward with layered noise: nothing at the lip, most at the foot,
  // so the face leans out slightly and never overhangs.
  rock = rock.warp(v => {
    const [x, y, z] = v;
    if (z > H - 0.01 || x < 0.5) return;
    const n = normalAt.get(key(x, y));
    if (!n) return;
    const t = (H - z) / H;
    const layer = Math.floor((H - z) / 1.6);                  // stepped ledges, ~1.6mm beds
    const strata = fbm(x * 0.04, y * 0.04, layer * 0.9);       // each bed juts out by its own amount
    const crag = fbm(x * 0.15 + 40, y * 0.15, z * 0.1);         // vertical cracks and buttresses
    const d = Math.pow(t, 0.7) * (0.6 + 3.2 * strata * strata + 2.2 * crag) + 0.3 * t;
    v[0] = x + n[0] * d; v[1] = y + n[1] * d;
  });
  addFloor(rock, 'rock');
  addFloor(slab(outlineCS, H - 0.8, H), 'paving');
}

// ================================================================ PAVING JOINTS
const courtCS = circle(COURT.x, 0, COURT.R, 192);
const bandCS = rect(COURT.x + COURT.R - 4, -BAND, TIP - 60, BAND).intersect(outlineCS.offset(-PARAPET.w - 6, 'Round'));
{
  // running bond everywhere outside the courtyard and the processional path
  const g = [];
  const rowH = 11, len = 20;
  for (let y = -HALF, row = 0; y < HALF; y += rowH, row++) {
    g.push(rect(0, y - 0.3, TIP, y + 0.3));
    for (let x = (row % 2) * len / 2; x < TIP; x += len) g.push(rect(x - 0.3, y, x + 0.3, y + rowH));
  }
  const grid = unionCS(g).subtract(courtCS.offset(3)).subtract(bandCS.offset(2));
  // processional path: big slabs laid across
  const b = [rect(0, -BAND - 0.35, TIP, -BAND + 0.35), rect(0, BAND - 0.35, TIP, BAND + 0.35)];
  for (let x = COURT.x + COURT.R; x < TIP; x += 24) b.push(rect(x - 0.35, -BAND, x + 0.35, BAND));
  b.push(rect(0, -0.3, TIP, 0.3));
  const band = unionCS(b).intersect(bandCS);
  // courtyard: concentric rings with staggered radial joints
  const c = [];
  let ring = 0;
  for (let r = 30; r < COURT.R - 4; r += 9, ring++) {
    c.push(annulus(COURT.x, 0, r - 0.35, r + 0.35, 192));
    const n = Math.max(8, Math.round(2 * Math.PI * r / 13));
    for (let i = 0; i < n; i++) {
      const a = (i + (ring % 2) * 0.5) * 360 / n;
      c.push(rect(r, -0.3, r + 9, 0.3).rotate(a).translate([COURT.x, 0]));
    }
  }
  const court = unionCS(c).intersect(courtCS.offset(-3));
  const joints = unionCS([grid, band, court]).intersect(outlineCS.offset(-0.8));
  var JOINTS = tag(slab(joints, H - 0.6, H + 1), 'joint');
}
// processional path gets its own colour, flush with the paving
addFloor(slab(bandCS, H - 0.8, H), 'path');

// ================================================================ COURTYARD
{
  const cx = COURT.x;
  // kerb ring around the court
  add(bevel(annulus(cx, 0, COURT.R - 3, COURT.R + 1, 192), H - 0.5, H + 0.8, 0.3), 'wall');
  // four lawns between the cross paths and the fountain
  const lawns = circle(cx, 0, COURT.R - 16, 192)
    .subtract(rect(cx - 200, -13, cx + 200, 13)).subtract(rect(cx - 13, -200, cx + 13, 200))
    .subtract(circle(cx, 0, 40, 128));
  const kerb = lawns.offset(2, 'Round').subtract(lawns);
  add(slab(lawns, H - 0.5, H + 1.1), 'lawn');
  add(bevel(kerb, H - 0.5, H + 1.9, 0.3), 'wall');
  // fountain: stepped surround, basin rim, water, island for the tree
  add(bevel(annulus(cx, 0, 21, 30, 128), H - 0.5, H + 1.2, 0.4), 'wall');
  add(bevel(annulus(cx, 0, 21, 25.5, 128), H + 1, H + 4.2, 0.6), 'wall');
  add(slab(circle(cx, 0, 21.2, 128), H - 0.5, H + 1.6), 'water');
  add(bevel(circle(cx, 0, 7.5, 64), H + 1.4, H + 3.4, 0.6), 'wall');
}

// ================================================================ WHITE TREE
{
  seed = 11;
  const sph = (p, r) => Manifold.sphere(r, 14).translate(p);
  const limbs = [];
  function branch(p, dir, len, r, depth) {
    const q = p.map((v, i) => v + dir[i] * len);
    limbs.push(Manifold.hull([sph(p, r), sph(q, r * 0.72)]));
    if (depth === 0) return;
    const kids = depth > 2 ? 2 : 2 + (rand() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const az = (k / kids) * 2 * Math.PI + rand() * 1.4 + depth;
      const tilt = 0.45 + rand() * 0.4;                    // radians away from the parent
      let d = [dir[0] + Math.cos(az) * tilt, dir[1] + Math.sin(az) * tilt, dir[2]];
      const l = Math.hypot(...d); d = d.map(v => v / l);
      if (d[2] < 0.55) {                                    // keep limbs >= ~33deg above horizontal: printable
        const h = Math.hypot(d[0], d[1]), s = Math.sqrt(1 - 0.55 * 0.55) / h;
        d = [d[0] * s, d[1] * s, 0.55];
      }
      branch(q, d, len * (0.68 + rand() * 0.12), r * 0.66, depth - 1);
    }
  }
  const base = [COURT.x, 0, H + 3];
  limbs.push(Manifold.cylinder(3, 4.2, 3, 24).translate(base));  // root flare
  branch(base, [0.05, 0, 1], 20, 3, 4);
  const tree = Manifold.union(limbs);
  add(tree, 'tree');
  console.log('tree height', (tree.boundingBox().max[2] - H).toFixed(1), 'mm above the court');
}

// ================================================================ PARAPET
{
  const inner = outlineCS.offset(-PARAPET.w, 'Round', 2, 32);
  const keep = rect(FACADE_D - 1, -500, 2000, 500);
  const wall = outlineCS.subtract(inner).intersect(keep);
  add(slab(wall, H - 0.5, H + PARAPET.h), 'wall');
  const coping = outlineCS.offset(0.4, 'Round', 2, 32).subtract(outlineCS.offset(-PARAPET.w - 0.8, 'Round', 2, 32)).intersect(keep);
  add(bevel(coping, H + PARAPET.h - 0.2, H + PARAPET.h + 1.8, 0), 'wall');
  // inner plinth course along the foot of the wall
  add(slab(inner.subtract(outlineCS.offset(-PARAPET.w - 1.2, 'Round', 2, 32)).intersect(keep), H - 0.5, H + 2), 'wall');
  // posts every ~70mm along the edge, plus one at the prow
  let acc = 35;
  const posts = [];
  for (let i = 0; i < N; i++) {
    const p = OUTLINE[i], q = OUTLINE[(i + 1) % N];
    if (p[0] < FACADE_D + 20 && q[0] < FACADE_D + 20) continue;
    acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (acc < 70) continue;
    acc = 0;
    const n = outward(i);
    posts.push([p[0] - n[0] * PARAPET.w / 2, p[1] - n[1] * PARAPET.w / 2, Math.atan2(n[1], n[0]) * 180 / Math.PI]);
  }
  for (const [x, y, a] of posts) {
    add(slab(rectC(0, 0, PARAPET.w + 1.6, 8).rotate(a).translate([x, y]), H - 0.5, H + PARAPET.h + 3), 'wall');
    add(rectC(0, 0, PARAPET.w + 2.4, 8.8).rotate(a).extrude(2.4, 0, 0, 0.35).translate([x, y, H + PARAPET.h + 3]), 'wall');
  }
  console.log(posts.length, 'parapet posts');
}

// ================================================================ LOOKOUT AT THE PROW
{
  const lx = TIP - 70;
  const dais = circle(lx, 0, 17, 96).intersect(outlineCS.offset(-PARAPET.w, 'Round'));
  add(bevel(dais, H - 0.5, H + 1.2, 0.4), 'path');
  add(slab(poly(starPts(lx, 0, 9, 3.6, 8, 0)), H + 1, H + 1.5), 'metal');
}

// ================================================================ CITADEL FRONT (suggestion of the hall)
// Built in a local frame (u across, v up the wall, w out from the wall) and mapped to
// world as x = w, y = u, z = v + H.
{
  const toWorld = m => m.warp(p => { const [u, v, w] = [p[0], p[1], p[2]]; p[0] = w; p[1] = u; p[2] = v + H; });
  const addF = (m, g) => add(toWorld(m), g);
  const W = HALF, TOP = 100, DOOR = { w: 36, y0: 7.5, spring: 46 };
  const F = [];                                  // cutters applied to the wall
  let wallBody = slab(rect(-W, -0.5, W, TOP), 0, FACADE_D);
  const plinth = slab(rect(-W, -0.5, W, 7), 0, FACADE_D + 2);
  // door recess and arched windows
  const door = arch(0, DOOR.y0, DOOR.w, DOOR.spring);
  F.push(slab(door, FACADE_D - 8, FACADE_D + 20));
  const bays = [49, 92.5, 137.5];
  const windows = [];
  for (const s of [-1, 1]) for (const c of bays) windows.push(arch(s * c, 32, 12, 64));
  const winCS = unionCS(windows);
  wallBody = wallBody.add(plinth).subtract(Manifold.union(F)).subtract(slab(winCS, FACADE_D - 5, FACADE_D + 20));
  addF(wallBody, 'wall');
  addF(slab(winCS, FACADE_D - 5, FACADE_D - 4.4), 'glass');
  // window mullions and sills
  const mull = [];
  for (const s of [-1, 1]) for (const c of bays) mull.push(rect(s * c - 0.5, 32, s * c + 0.5, 70), rect(s * c - 6, 52, s * c + 6, 53));
  addF(slab(unionCS(mull).intersect(winCS), FACADE_D - 5, FACADE_D - 3.5), 'wall');
  for (const s of [-1, 1]) for (const c of bays) addF(bevel(rect(s * c - 8, 29, s * c + 8, 32), 0, FACADE_D + 3, 0.5), 'wall');
  // buttresses
  for (const s of [-1, 1]) for (const c of [27.5, 70.5, 115, 160]) {
    addF(slab(rectC(s * c, 46, 9, 92), 0, FACADE_D + 7), 'wall');
    addF(bevel(rectC(s * c, 94, 7, 4), 0, FACADE_D + 5, 0.8), 'wall');
    addF(bevel(rectC(s * c, 5, 11, 10), 0, FACADE_D + 8.5, 0.6), 'wall');
  }
  // cornice
  addF(slab(rect(-W, TOP - 8, W, TOP - 5), 0, FACADE_D + 2.5), 'wall');
  addF(bevel(rect(-W, TOP - 5, W, TOP), 0, FACADE_D + 4, 0), 'wall');
  // great doors: two leaves with stiles, panels and studs
  addF(slab(door, FACADE_D - 8, FACADE_D - 7), 'wood');
  const studs = [];
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -DOOR.w / 2 + 2 : 2, x1 = s < 0 ? -2 : DOOR.w / 2 - 2;
    for (let y = DOOR.y0 + 4; y < DOOR.spring + 2; y += 9) addF(bevel(rect(x0, y, x1, y + 7), FACADE_D - 7.2, FACADE_D - 6, 0.5), 'wood');
    for (let y = DOOR.y0 + 3.5; y < DOOR.spring + 5; y += 4.5) for (const x of [x0 + 1, (x0 + x1) / 2, x1 - 1])
      studs.push(Manifold.sphere(0.6, 10).translate([x, y, FACADE_D - 6.8]));
    addF(Manifold.cylinder(0.8, 2.2, 2.2, 24).translate([s * 3.5, 28, FACADE_D - 7]), 'metal');   // ring pulls
  }
  addF(Manifold.union(studs), 'metal');
  addF(slab(rect(-0.6, DOOR.y0, 0.6, DOOR.spring + DOOR.w / 2), FACADE_D - 8, FACADE_D - 6.4), 'wood');
  // arch surround + keystone
  const ring = arch(0, DOOR.y0, DOOR.w + 9, DOOR.spring).subtract(door).intersect(rect(-50, DOOR.y0, 50, 200));
  addF(bevel(ring, 0, FACADE_D + 3, 0.4), 'wall');
  const kt = DOOR.spring + DOOR.w / 2 + 4.5;
  addF(bevel(poly([[-3, kt - 5], [3, kt - 5], [4.4, kt + 3], [-4.4, kt + 3]]), 0, FACADE_D + 4.5, 0.6), 'wall');
  // the White Tree and the Seven Stars over the door
  {
    const cy = 78, t = [];
    t.push(poly([[-1.1, cy - 8], [1.1, cy - 8], [0.7, cy + 3], [-0.7, cy + 3]]));            // trunk
    for (const [a, l, y] of [[35, 7, cy - 1], [145, 7, cy - 1], [55, 8, cy + 1], [125, 8, cy + 1], [75, 7, cy + 2.5], [105, 7, cy + 2.5], [90, 6, cy + 3]])
      t.push(rect(0, -0.45, l, 0.45).rotate(a).translate([0, y]));
    t.push(poly([[-5, cy - 8], [5, cy - 8], [2, cy - 6.8], [-2, cy - 6.8]]));                 // roots / ground line
    for (let i = 0; i < 7; i++) {
      const a = (160 - i * 140 / 6) * Math.PI / 180;
      t.push(poly(starPts(Math.cos(a) * 12, cy + 1 + Math.sin(a) * 9, 1.6, 0.7)));
    }
    addF(bevel(rectC(0, cy + 1.5, 32, 21), 0, FACADE_D + 0.8, 0.5), 'wall');
    addF(slab(unionCS(t), FACADE_D + 0.6, FACADE_D + 1.6), 'metal');
  }
  // steps up to the door
  for (const [d, h, w] of [[FACADE_D + 20, 2.5, 30], [FACADE_D + 14, 5, 26], [FACADE_D + 8, 7.5, 22]])
    addF(bevel(rect(-w, -0.5, w, h), 0, d, 0.3), 'wall');
}

// ================================================================ ASSEMBLE
// paving joints are cut into the flush floor; raised parts added afterwards refill them where they sit
const floor = Manifold.union(floorParts).subtract(JOINTS);
let model = Manifold.union([floor, ...parts]).trimByPlane([0, 0, 1], 0);
{
  const comps = model.decompose().sort((a, b) => b.volume() - a.volume());
  for (const c of comps.slice(1)) {
    const b = c.boundingBox();
    if (c.volume() > 1) throw new Error(`loose part (${c.volume().toFixed(1)} mm3) at ${b.min.map(v => v.toFixed(1))}`);
  }
  if (comps.length > 1) { console.log(`dropped ${comps.length - 1} sliver(s)`); model = comps[0]; }
}
const bb = model.boundingBox();
console.log(`citadel: ${model.numTri()} tris, bbox ${bb.min.map(v => v.toFixed(1))} .. ${bb.max.map(v => v.toFixed(1))}, status ${model.status()}`);

fs.mkdirSync(OUT, { recursive: true });
const mesh = model.getMesh();
writeSTL(path.join(OUT, 'citadel.stl'), mesh.vertProperties, mesh.triVerts, mesh.numProp);
writePreview(path.join(OUT, 'citadel.bin'), mesh);
fs.writeFileSync(path.join(OUT, 'citadel.json'), JSON.stringify({ groups: GROUPS, palette: PALETTE, up: 'z' }, null, 1));

function writeSTL(file, vp, tv, np) {
  const n = tv.length / 3;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('Minas Tirith citadel top - generated by model/citadel.mjs', 0);
  buf.writeUInt32LE(n, 80);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const p = [0, 1, 2].map(k => { const i = tv[t * 3 + k] * np; return [vp[i], vp[i + 1], vp[i + 2]]; });
    const u = p[1].map((v, i) => v - p[0][i]), w = p[2].map((v, i) => v - p[0][i]);
    let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const v of [nx / l, ny / l, nz / l, ...p.flat()]) { buf.writeFloatLE(v, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
  fs.writeFileSync(file, buf);
  console.log('wrote', path.relative(ROOT, file), (buf.length / 1e6).toFixed(1), 'MB');
}
function writePreview(file, mesh) {
  const np = mesh.numProp, nv = mesh.vertProperties.length / np, nt = mesh.triVerts.length / 3;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = mesh.vertProperties[i * np + k];
  const grp = new Uint8Array(nt);
  for (let r = 0; r < mesh.runOriginalID.length; r++) grp.fill(idGroup.get(mesh.runOriginalID[r]) ?? 0, mesh.runIndex[r] / 3, mesh.runIndex[r + 1] / 3);
  const head = new Uint32Array([nv, nt]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(head.buffer), Buffer.from(pos.buffer), Buffer.from(new Uint32Array(mesh.triVerts).buffer), Buffer.from(grp.buffer)]));
  console.log('wrote', path.relative(ROOT, file), (fs.statSync(file).size / 1e6).toFixed(1), 'MB');
}
