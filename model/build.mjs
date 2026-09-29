// Builds the Star Theater facade as a watertight solid with manifold-3d CSG.
//
// Units are millimetres at 32mm "heroic" scale (Malifaux). Axes: X = width,
// Y = height of the building, Z = out of the wall toward the viewer. The back
// of the wall sits on Z = 0, so the exported STL is already in its print
// orientation: lying on its back, face up. Everything is kept (nearly) a
// height field over the XY plane, so it prints without supports; the only
// exceptions are short bridges (balcony rail, balusters, lamp/sign brackets).
//
//   node model/build.mjs  ->  out/star-theater.stl, out/brace.stl,
//                             out/star-theater.bin (coloured preview mesh)
import fs from 'node:fs';
import path from 'node:path';
import Module from 'manifold-3d';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'out');
const wasm = await Module();
wasm.setup();
const { CrossSection, Manifold } = wasm;

// ---------------------------------------------------------------- dimensions
const HW = 95;        // half width
const T = 8;          // wall thickness; the front face of the wall is at z = T
const GF_TOP = 78;    // ground floor / belt cornice
const BELT_TOP = 87;
const UF_TOP = 148;   // upper floor / main cornice
const CORNICE_TOP = 162;
const ATTIC_TOP = 184;
const MQ = { x: 46, y0: 60, y1: 76, depth: 24 };   // marquee
const F = T + MQ.depth;                            // marquee front face z

// ---------------------------------------------------------------- colour groups
export const GROUPS = ['stone', 'mortar', 'trim', 'wood', 'glass', 'gold', 'marquee', 'bulb', 'paper', 'ink', 'iron'];
const idGroup = new Map();
function tag(m, group) {
  const o = m.asOriginal();
  idGroup.set(o.originalID(), GROUPS.indexOf(group));
  return o;
}
const parts = [];
const add = (m, group) => parts.push(tag(m, group));

// ---------------------------------------------------------------- 2D helpers
const rect = (x0, y0, x1, y1) => CrossSection.square([x1 - x0, y1 - y0]).translate([x0, y0]);
const rectC = (cx, cy, w, h) => rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
const circle = (cx, cy, r, n = 64) => CrossSection.circle(r, n).translate([cx, cy]);
const poly = pts => new CrossSection([pts], 'NonZero');
// Round-topped opening: straight jambs from y0 up to the springing line, then a semicircle.
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
const star = (cx, cy, R, r) => poly(starPts(cx, cy, R, r));
// Faceted star: a star-shaped cone, ridges running from each point up to a centre apex.
const pyramidStar = (cx, cy, R, z0, h, r = R * 0.42) => poly(starPts(0, 0, R, r)).extrude(h, 0, 0, 0).translate([cx, cy, z0]);
const mirrorX = cs => cs.mirror([1, 0]);
const both = cs => cs.add(mirrorX(cs));
const unionCS = list => CrossSection.union(list);

// ---------------------------------------------------------------- 3D helpers
const slab = (cs, z0, z1) => cs.extrude(z1 - z0).translate([0, 0, z0]);
const box = (x0, y0, z0, x1, y1, z1) => Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
// Block with bevelled top edges (bev mm on each side).
function bevel(cs, z0, z1, bev) {
  const b = cs.bounds(), cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  return cs.translate([-cx, -cy]).extrude(z1 - z0, 0, 0, [Math.max(0.05, (w - 2 * bev) / w), Math.max(0.05, (h - 2 * bev) / h)])
    .translate([cx, cy, z0]);
}
// Moulding: profile given as [y, z] points, swept along X from x0 to x1.
const profileX = (pts, x0, x1) => poly(pts).extrude(x1 - x0).warp(v => {
  const [a, b, c] = [v[0], v[1], v[2]]; v[0] = c + x0; v[1] = a; v[2] = b;
});
// Capsule between two points (rods, tie bars).
const rod = (p, q, r) => Manifold.hull([Manifold.sphere(r, 16).translate(p), Manifold.sphere(r, 16).translate(q)]);
// A ball sitting proud of the wall, filled back to the wall so it needs no support.
const knob = (cx, cy, zc, r, n = 32) => Manifold.sphere(r, n).translate([cx, cy, zc]).add(circle(cx, cy, r, n).extrude(zc));
// Turned baluster along +Y, centred at (cx, y0, zc).
function baluster(cx, y0, zc, h, r) {
  const prof = [[0, 0], [r, 0], [r, h * 0.08], [r * 0.55, h * 0.12], [r * 0.95, h * 0.35], [r, h * 0.45], [r * 0.5, h * 0.72],
    [r * 0.45, h * 0.84], [r * 0.8, h * 0.9], [r, h * 0.92], [r, h], [0, h]];
  return poly(prof).revolve(24).rotate([-90, 0, 0]).translate([cx, y0, zc]);
}

// ---------------------------------------------------------------- text
const font = new Font(JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/examples/fonts/gentilis_bold.typeface.json'))));
function text(str, size, cx, cy, maxW = Infinity) {
  const list = [];
  for (const s of font.generateShapes(str, size)) {
    const { shape, holes } = s.extractPoints(6);
    list.push(new CrossSection([shape, ...holes].map(c => c.map(p => [p.x, p.y])), 'EvenOdd'));
  }
  let cs = unionCS(list);
  let b = cs.bounds();
  const w = b.max[0] - b.min[0];
  if (w > maxW) { cs = cs.scale([maxW / w, maxW / w]); b = cs.bounds(); }
  return cs.translate([cx - (b.min[0] + b.max[0]) / 2, cy - (b.min[1] + b.max[1]) / 2]);
}

// ================================================================ WALL BODY
// Pediment over the centre: a segmental arch on the attic, 80mm chord.
const PED = { cx: 0, cy: 170.33, R: 41.67 };
const pedCS = circle(PED.cx, PED.cy, PED.R, 128).intersect(rect(-60, ATTIC_TOP - 2, 60, 260));
let wallCS = rect(-HW, 0, HW, ATTIC_TOP).add(pedCS);
let wall = tag(slab(wallCS, 0, T), 'stone');

// Ground floor rustication: horizontal channels + staggered vertical joints.
{
  const g = [];
  const rowH = 6.6;
  let row = 0;
  for (let y = 5 + rowH; y < GF_TOP - 1; y += rowH, row++) {
    g.push(rect(-HW, y - 0.45, HW, y + 0.45));
    for (let x = -HW + (row % 2 ? 6.5 : 0); x < HW; x += 13) g.push(rect(x - 0.35, y, x + 0.35, y + rowH));
  }
  wall = wall.subtract(tag(slab(unionCS(g).intersect(rect(-HW, 5, HW, GF_TOP)), T - 0.8, T + 1), 'mortar'));
}
// Upper floor: banded rustication (horizontal channels only).
{
  const g = [];
  for (let y = BELT_TOP + 7.5; y < UF_TOP - 2; y += 7.5) g.push(rect(-HW, y - 0.3, HW, y + 0.3));
  wall = wall.subtract(tag(slab(unionCS(g), T - 0.5, T + 1), 'mortar'));
}

// ================================================================ PLINTH & STEPS
add(profileX([[0, 0], [0, T + 3], [4, T + 3], [5.5, T + 1.5], [5.5, 0]], -HW, HW), 'trim');
add(bevel(rect(-26, 0, 26, 2.6), 0, T + 13, 0.4), 'trim');     // bottom step
add(bevel(rect(-21, 0, 21, 5.2), 0, T + 7.5, 0.4), 'trim');    // top step
for (const s of [-1, 1]) add(bevel(rect(s * 34 - 9, 0, s * 34 + 9, 5.2), 0, T + 6, 0.4), 'trim');

// ================================================================ PILASTERS (ground floor)
function pilaster(x0, x1, y0, y1, proj, flutes = 0) {
  const w = x1 - x0;
  let shaft = box(x0, y0, 0, x1, y1, T + proj);
  if (flutes) {
    const cut = [];
    const step = w / (flutes + 1);
    for (let i = 1; i <= flutes; i++)
      cut.push(Manifold.cylinder(y1 - y0 - 10, 0.55, 0.55, 12).rotate([-90, 0, 0]).translate([x0 + i * step, y0 + 5, T + proj]));
    shaft = shaft.subtract(tag(Manifold.union(cut), 'mortar'));
  }
  add(shaft, 'trim');
  add(bevel(rect(x0 - 1.2, y0, x1 + 1.2, y0 + 5), 0, T + proj + 1.4, 0.6), 'trim');                 // base
  add(profileX([[y1 - 6, 0], [y1 - 6, T + proj + 0.6], [y1 - 3.5, T + proj + 0.6], [y1 - 2.5, T + proj + 2], [y1, T + proj + 2.4], [y1, 0]],
    x0 - 1.4, x1 + 1.4), 'trim');                                                                     // capital
}
for (const s of [-1, 1]) {
  const P = (a, b) => s < 0 ? [-b, -a] : [a, b];
  pilaster(...P(84, HW), 5.5, GF_TOP, 3);
  pilaster(...P(50, 58), 5.5, GF_TOP, 3, 2);
}

// ================================================================ CENTRAL DOORS
{
  const W = 30, SPR = 36, Y0 = 5.5;
  const opening = arch(0, Y0, W, SPR);
  wall = wall.subtract(tag(slab(rect(-W / 2, Y0, W / 2, SPR), T - 4, T + 20), 'wood'));
  wall = wall.subtract(tag(slab(opening.subtract(rect(-W, 0, W, SPR)), T - 5, T + 20), 'glass'));
  // door leaves: frame + raised lower panels + glazed upper panels
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -W / 2 : 0.4, x1 = s < 0 ? -0.4 : W / 2, cx = (x0 + x1) / 2;
    add(slab(rect(x0, Y0, x1, SPR), T - 4, T - 3.2), 'wood');
    add(bevel(rect(cx - 5, Y0 + 3, cx + 5, Y0 + 12), T - 3.3, T - 2.4, 0.5), 'wood');
    add(slab(rect(cx - 5, Y0 + 15, cx + 5, SPR - 2.5), T - 3.5, T - 3.3), 'glass');
    add(slab(rect(cx - 0.35, Y0 + 15, cx + 0.35, SPR - 2.5).add(rect(cx - 5, 23.5, cx + 5, 24.2)), T - 3.4, T - 2.8), 'wood');
    add(knob(s * 1.6, 20, T - 3, 0.75, 16).subtract(box(-5, 0, 0, 5, 40, T - 3.2)), 'gold');
  }
  add(slab(rect(-0.4, Y0, 0.4, SPR), T - 4, T - 2.8), 'wood');
  // sunburst fanlight
  const fan = [];
  for (let a = 15; a < 180; a += 150 / 7) fan.push(rectC(0, 0, W, 0.8).translate([W / 2, 0]).rotate(a));
  fan.push(circle(0, 0, 4.5, 48).subtract(circle(0, 0, 3.6, 48)));
  fan.push(circle(0, 0, W / 2, 96).subtract(circle(0, 0, W / 2 - 0.8, 96)));
  const fanCS = unionCS(fan).translate([0, SPR]).intersect(opening).subtract(rect(-W, 0, W, SPR)).add(rect(-W / 2, SPR - 0.5, W / 2, SPR + 0.6));
  add(slab(fanCS, T - 5, T - 3.4), 'gold');
  // voussoir ring + keystone
  let ring = arch(0, Y0, W + 7, SPR).subtract(opening);
  const cuts = [];
  for (let a = 0; a <= 180; a += 180 / 11) cuts.push(rectC(0, 0, 30, 0.6).translate([15 + W / 2 - 2, 0]).rotate(a).translate([0, SPR]));
  for (let y = Y0 + 6; y < SPR; y += 6) cuts.push(rect(-W, y - 0.3, W, y + 0.3));
  ring = ring.subtract(unionCS(cuts));
  add(bevel(ring, 0, T + 2, 0), 'trim');
  add(bevel(ring.offset(-0.3, 'Miter'), 0, T + 2.3, 0), 'trim');
  add(bevel(poly([[-3, SPR + W / 2 - 1], [3, SPR + W / 2 - 1], [4.2, SPR + W / 2 + 7.5], [-4.2, SPR + W / 2 + 7.5]]), 0, T + 3.4, 0.6), 'trim');
  add(pyramidStar(0, SPR + W / 2 + 4, 2.2, T + 3.2, 1.2), 'gold');
}

// ================================================================ SIDE DOORS
for (const s of [-1, 1]) {
  const cx = s * 34, W = 13, Y0 = 5.5, TOP = 44;
  wall = wall.subtract(tag(slab(rect(cx - W / 2, Y0, cx + W / 2, TOP), T - 3.5, T + 20), 'wood'));
  add(slab(rect(cx - W / 2, Y0, cx + W / 2, 35.5), T - 3.5, T - 2.9), 'wood');
  for (const [y0, y1] of [[Y0 + 3, 18], [20.5, 33]]) add(bevel(rect(cx - 4.3, y0, cx + 4.3, y1), T - 3, T - 2.2, 0.5), 'wood');
  add(knob(cx + s * -4.5, 19, T - 2.9, 0.6, 16).subtract(box(-HW, 0, 0, HW, 40, T - 2.9)), 'gold');
  // transom with a star
  add(slab(rect(cx - W / 2, 35.5, cx + W / 2, TOP), T - 3.5, T - 3.2), 'glass');
  add(slab(rect(cx - W / 2, 35.5, cx + W / 2, 36.4).add(star(cx, 39.8, 3.3).subtract(star(cx, 39.8, 2.4))), T - 3.5, T - 2.6), 'gold');
  // architrave + hood on consoles
  add(bevel(rect(cx - W / 2 - 2.2, Y0, cx + W / 2 + 2.2, TOP + 2).subtract(rect(cx - W / 2, 0, cx + W / 2, TOP)), 0, T + 1.8, 0.3), 'trim');
  add(profileX([[TOP + 5, 0], [TOP + 5, T + 5], [TOP + 6.2, T + 5.6], [TOP + 7.4, T + 5.6], [TOP + 8, T + 3], [TOP + 8, 0]], cx - W / 2 - 4, cx + W / 2 + 4), 'trim');
  add(slab(rect(cx - W / 2 - 1, TOP + 2, cx + W / 2 + 1, TOP + 5), 0, T + 1.2), 'trim');
  for (const e of [-1, 1])
    add(profileX([[TOP - 4, 0], [TOP - 4, T + 1.8], [TOP + 1, T + 2.2], [TOP + 5, T + 4.8], [TOP + 5, 0]], cx + e * (W / 2 + 1.1) - 1.1, cx + e * (W / 2 + 1.1) + 1.1), 'trim');
}

// ================================================================ WALL LANTERNS (on inner pilasters)
for (const s of [-1, 1]) {
  const cx = s * 54, y0 = 48;
  const body = poly([[cx - 1.2, y0], [cx + 1.2, y0], [cx + 3, y0 + 2.4], [cx + 3, y0 + 8], [cx + 3.8, y0 + 8.4], [cx, y0 + 11.6], [cx - 3.8, y0 + 8.4], [cx - 3, y0 + 8], [cx - 3, y0 + 2.4]]);
  add(bevel(rectC(cx, y0 + 5, 5, 13), 0, T + 4.2, 0.6), 'iron');                    // backplate
  add(bevel(body, 0, T + 9, 0.3), 'iron');
  add(slab(rect(cx - 2.2, y0 + 2.8, cx + 2.2, y0 + 7.7), T + 8, T + 9.4), 'bulb');
  add(slab(rect(cx - 0.25, y0 + 2.8, cx + 0.25, y0 + 7.7), T + 8, T + 9.6), 'iron');
  add(knob(cx, y0 + 12.4, T + 5, 0.9, 16), 'iron');
}

// ================================================================ TICKET WINDOW (left bay)
{
  const cx = -71, W = 16, Y0 = 21, SPR = 42;
  const op = arch(cx, Y0, W, SPR);
  wall = wall.subtract(tag(slab(op, T - 3.5, T + 20), 'glass'));
  const bars = [];
  for (let x = cx - W / 2 + 2; x < cx + W / 2 - 1; x += 2.4) bars.push(rect(x - 0.3, Y0, x + 0.3, SPR + 10));
  bars.push(rect(cx - W, SPR - 0.3, cx + W, SPR + 0.3), rect(cx - W, Y0 + 7, cx + W, Y0 + 7.6));
  add(slab(unionCS(bars).intersect(op), T - 3.5, T - 2.2), 'gold');
  add(slab(rectC(cx, Y0 + 2.2, 6, 3.2), T - 3.5, T - 2.2), 'iron');               // pass-through slot plate
  add(bevel(arch(cx, Y0, W + 4.6, SPR).subtract(op), 0, T + 1.8, 0.3), 'trim');
  add(bevel(poly([[cx - 2, SPR + W / 2 + 1.2], [cx + 2, SPR + W / 2 + 1.2], [cx + 2.8, SPR + W / 2 + 6], [cx - 2.8, SPR + W / 2 + 6]]).add(rectC(cx, SPR + W / 2 + 0.6, 4, 2)), 0, T + 2.8, 0.4), 'trim');
  add(profileX([[Y0 - 4, 0], [Y0 - 4, T + 2], [Y0 - 1, T + 5.5], [Y0 + 0.6, T + 5.5], [Y0 + 0.6, 0]], cx - W / 2 - 3.5, cx + W / 2 + 3.5), 'wood');
  for (const e of [-1, 1]) add(profileX([[Y0 - 8, 0], [Y0 - 8, T + 1], [Y0 - 4, T + 4.5], [Y0 - 4, 0]], cx + e * 7 - 1, cx + e * 7 + 1), 'wood');
  // sign
  add(bevel(rectC(cx, 64.5, 22, 8), 0, T + 1.4, 0.5), 'wood');
  add(slab(text('TICKETS', 3.6, cx, 64.5, 18), T + 1.2, T + 2.0), 'gold');
  add(slab(rectC(cx, 64.5, 23.4, 9.4).subtract(rectC(cx, 64.5, 22, 8)), 0, T + 1.1), 'gold');
}

// ================================================================ POSTER (right bay)
{
  const cx = 71, cy = 36, W = 19, H = 45;
  add(bevel(rectC(cx, cy, W + 4, H + 4).subtract(rectC(cx, cy, W, H)), 0, T + 2.2, 0.6), 'wood');
  add(slab(rectC(cx, cy, W + 0.2, H + 0.2), 0, T + 0.6), 'paper');
  const ink = [
    text('COLLETTE', 3, cx, cy + 18.2, W - 3),
    star(cx, cy + 7.5, 7.5, 3.2).subtract(star(cx, cy + 7.5, 5.8, 2.2)),
    star(cx, cy + 7.5, 3.6, 1.5),
    circle(cx - 6.5, cy + 12, 0.6, 12), circle(cx + 6.8, cy + 3, 0.5, 12), circle(cx + 6, cy + 13.4, 0.45, 12), circle(cx - 6.2, cy + 2.4, 0.5, 12),
    text('DU BOIS', 2.6, cx, cy - 3.8, W - 5),
    rectC(cx, cy - 7.6, W - 6, 0.5),
    text('NIGHTLY', 2.1, cx, cy - 11, W - 7),
    rectC(cx, cy - 14.4, W - 6, 0.5),
    // fan motif at the foot of the poster
    ...[-60, -30, 0, 30, 60].map(a => poly([[0, 0], [-1.2, 7], [1.2, 7]]).rotate(a).translate([cx, cy - 21.5])),
  ];
  add(slab(unionCS(ink).intersect(rectC(cx, cy, W - 1, H - 1)), T + 0.5, T + 0.95), 'ink');
  add(knob(cx - W / 2 + 1.4, cy + H / 2 - 1.4, T + 0.6, 0.55, 12), 'iron');
  add(knob(cx + W / 2 - 1.4, cy + H / 2 - 1.4, T + 0.6, 0.55, 12), 'iron');
}

// ================================================================ MARQUEE
{
  const { x: X, y0: Y0, y1: Y1 } = MQ;
  add(box(-X, Y0, 0, X, Y1, F), 'marquee');
  // front frame, bulbs, sign board
  add(slab(rect(-X, Y0, X, Y1).subtract(rect(-X + 1.2, Y0 + 1.2, X - 1.2, Y1 - 1.2)), F - 1, F + 0.7), 'gold');
  const board = rect(-41, Y0 + 3.6, 41, Y1 - 3.6);
  add(slab(board.offset(0.7, 'Miter').subtract(board), F - 1, F + 0.5), 'gold');
  add(slab(text('COLLETTE DU BOIS', 4.6, 0, (Y0 + Y1) / 2 + 0.3, 76), F - 1, F + 0.6), 'gold');
  for (let x = -43.8; x <= 43.9; x += 3.65) for (const y of [Y0 + 2.2, Y1 - 2.2]) add(Manifold.sphere(0.95, 16).translate([x, y, F]), 'bulb');
  for (let y = Y0 + 5.2; y < Y1 - 4; y += 2.9) for (const x of [-43.8, 43.8]) add(Manifold.sphere(0.95, 16).translate([x, y, F]), 'bulb');
  // top lip, side bulbs are skipped (they would overhang in print)
  add(profileX([[Y1 - 0.5, 0], [Y1 - 0.5, F + 0.9], [Y1 + 1.2, F + 1.4], [Y1 + 2, F - 1], [Y1 + 2, 0]], -X - 0.8, X + 0.8), 'gold');
  // brackets under the canopy
  for (const s of [-1, 1]) {
    const cx = s * 38;
    add(profileX([[Y0, 0], [Y0, F - 3], [Y0 - 3, F - 6], [Y0 - 16, T + 2], [Y0 - 16, 0]], cx - 1, cx + 1)
      .subtract(Manifold.cylinder(4, 3.2, 3.2, 32).rotate([0, 90, 0]).translate([cx - 2, Y0 - 5.5, T + 8])), 'iron');
    // tie rods to the upper wall, with anchor rosettes
    add(rod([cx, 97, T + 1], [cx, Y1 + 1, F - 3], 0.8), 'iron');
    add(bevel(circle(cx, 97, 2.2, 24), 0, T + 1.6, 0.5), 'iron');
  }
}

// ================================================================ BELT CORNICE
add(profileX([[GF_TOP, 0], [GF_TOP, T + 2], [GF_TOP + 1.5, T + 2], [GF_TOP + 2, T + 3], [GF_TOP + 5, T + 4.6],
  [GF_TOP + 7, T + 5.4], [GF_TOP + 8, T + 5.4], [BELT_TOP, T + 3], [BELT_TOP, 0]], -HW - 1.5, HW + 1.5), 'trim');

// ================================================================ UPPER FLOOR
// Quoins on the corners
for (const s of [-1, 1]) {
  let i = 0;
  for (let y = BELT_TOP + 0.4; y + 6 < UF_TOP; y += 6.8, i++) {
    const w = i % 2 ? 9 : 13;
    const x0 = s < 0 ? -HW : HW - w, x1 = s < 0 ? -HW + w : HW;
    add(bevel(rect(x0, y, x1, y + 6.2), 0, T + 1.8, 0.7), 'trim');
  }
}
// Fluted pilasters on the inner piers
for (const s of [-1, 1]) {
  const [a, b] = s < 0 ? [-58, -50] : [50, 58];
  pilaster(a, b, BELT_TOP, UF_TOP, 2.2, 2);
}
// Arched windows: two side windows + a central French door onto a balcony
function archWindow(cx, W, Y0, SPR, sill) {
  const op = arch(cx, Y0, W, SPR);
  wall = wall.subtract(tag(slab(op, T - 3, T + 20), 'glass'));
  const m = [rect(cx - 0.35, Y0, cx + 0.35, SPR + W), rect(cx - W, SPR - 0.35, cx + W, SPR + 0.35)];
  for (let y = SPR - 8; y > Y0 + 2; y -= 8) m.push(rect(cx - W, y - 0.3, cx + W, y + 0.3));
  for (const a of [45, 135]) m.push(rectC(0, 0, W, 0.6).translate([W / 2, 0]).rotate(a).translate([cx, SPR]));
  m.push(circle(cx, SPR, W / 2 - 3, 48).subtract(circle(cx, SPR, W / 2 - 3.6, 48)));
  add(slab(unionCS(m).intersect(op), T - 3, T - 1.8), 'trim');
  const ringOuter = arch(cx, Y0, W + 4.4, SPR);
  add(bevel(ringOuter.subtract(op).intersect(rect(cx - W, Y0, cx + W, 400)), 0, T + 1.6, 0.25), 'trim');
  add(bevel(arch(cx, SPR - 1, W + 6.4, SPR).subtract(ringOuter).intersect(rect(cx - W, SPR - 1, cx + W, 400)), 0, T + 1.1, 0.2), 'trim');
  const kTop = SPR + W / 2 + 2.2;
  add(bevel(poly([[cx - 2.2, kTop - 3], [cx + 2.2, kTop - 3], [cx + 3.2, kTop + 4.5], [cx - 3.2, kTop + 4.5]]), 0, T + 3, 0.5), 'trim');
  if (sill) {
    add(profileX([[Y0 - 3, 0], [Y0 - 3, T + 3.5], [Y0 - 0.8, T + 4], [Y0 + 0.4, T + 1], [Y0 + 0.4, 0]], cx - W / 2 - 3.2, cx + W / 2 + 3.2), 'trim');
    add(bevel(rect(cx - W / 2 + 0.5, Y0 - 11, cx + W / 2 - 0.5, Y0 - 4), 0, T + 0.9, 0.4), 'trim');
    add(pyramidStar(cx, Y0 - 7.5, 2.4, T + 0.7, 1.1), 'gold');
  }
}
archWindow(-30, 14, 99, 124, true);
archWindow(30, 14, 99, 124, true);
archWindow(0, 18, BELT_TOP, 126, false);

// Balcony in front of the French door
{
  const X = 14.5, Y0 = BELT_TOP, D = T + 10;
  add(bevel(rect(-X - 1, Y0 - 1, X + 1, Y0 + 3), 0, D, 0.6), 'trim');
  add(profileX([[Y0 - 7, 0], [Y0 - 7, T + 3], [Y0 - 1, D - 1], [Y0 - 1, 0]], -X, -X + 3), 'trim');
  add(profileX([[Y0 - 7, 0], [Y0 - 7, T + 3], [Y0 - 1, D - 1], [Y0 - 1, 0]], X - 3, X), 'trim');
  for (const s of [-1, 1]) add(bevel(rect(s * X - 2, Y0 + 3, s * X + 2, Y0 + 13.5), 0, D - 0.5, 0.4), 'trim');
  add(bevel(rect(-X - 1, Y0 + 12, X + 1, Y0 + 14.4), T + 6, D + 0.3, 0.5), 'trim');
  for (let x = -X + 4; x <= X - 3.9; x += 2.6) add(baluster(x, Y0 + 2.6, D - 2.2, 9.8, 1.05), 'trim');
}

// Oculus windows with a star tracery in the outer bays, crescent panel below, star above
for (const s of [-1, 1]) {
  const cx = s * 70.5, cy = 120, R = 9;
  wall = wall.subtract(tag(slab(circle(cx, cy, R, 96), T - 3, T + 20), 'glass'));
  const tr = star(cx, cy, R - 0.2, 3.4).subtract(star(cx, cy, R - 1.2, 2.6)).add(circle(cx, cy, 1.3, 24))
    .add(circle(cx, cy, R, 96).subtract(circle(cx, cy, R - 0.8, 96)));
  add(slab(tr.intersect(circle(cx, cy, R, 96)), T - 3, T - 1.8), 'gold');
  add(bevel(circle(cx, cy, R + 2.6, 96).subtract(circle(cx, cy, R, 96)), 0, T + 1.7, 0.3), 'trim');
  for (let a = 0; a < 360; a += 90)
    add(bevel(poly([[R - 0.5, -1.6], [R + 3.6, -2.4], [R + 3.6, 2.4], [R - 0.5, 1.6]]).rotate(a).translate([cx, cy]), 0, T + 2.6, 0.4), 'trim');
  const panel = rectC(cx, 99, 20, 12);
  add(bevel(panel.offset(1.2, 'Miter').subtract(panel), 0, T + 1.2, 0.2), 'trim');
  const moon = circle(cx, 99, 4.4, 48).subtract(circle(cx + s * 1.9, 100.1, 3.8, 48));
  add(slab(moon.add(star(cx - s * 5.5, 101.6, 1.3)).add(star(cx + s * 5.2, 96, 1.1)), T - 0.2, T + 1.3), 'gold');
  add(slab(star(cx, 138, 3.4), 0, T + 0.6), 'gold');
  add(pyramidStar(cx, 138, 3.4, T + 0.5, 1.4), 'gold');
}

// ================================================================ MAIN CORNICE
{
  const y = UF_TOP;
  add(profileX([[y, 0], [y, T + 0.8], [y + 4.6, T + 0.8], [y + 4.6, T + 1.8], [y + 5.4, T + 1.8], [y + 5.4, T + 2.2],
    [y + 8.3, T + 2.2], [y + 8.3, T + 6.4], [y + 11.4, T + 7], [y + 12, T + 7], [y + 14, T + 3.4], [CORNICE_TOP, T + 3.4], [CORNICE_TOP, 0]],
    -HW - 2.5, HW + 2.5), 'trim');
  const dent = [];
  for (let x = -HW - 1; x <= HW + 1; x += 3) dent.push(rect(x - 0.8, y + 5.4, x + 0.8, y + 8.3));
  add(slab(unionCS(dent), 0, T + 4.2), 'trim');
  // gold stars along the frieze
  const fr = [];
  for (let x = -84; x <= 84; x += 12) fr.push(star(x, y + 2.3, 1.7));
  add(slab(unionCS(fr), T + 0.6, T + 1.4), 'gold');
  // modillions over the pilasters
  for (const x of [-89.5, -54, 54, 89.5])
    add(profileX([[y - 5, 0], [y - 5, T + 3.2], [y - 2, T + 3.6], [y + 5.4, T + 6.8], [y + 8.4, T + 6.8], [y + 8.4, 0]], x - 2.2, x + 2.2), 'trim');
}

// ================================================================ ATTIC: name frieze, balustrades, pedestals
{
  const Y0 = CORNICE_TOP, Y1 = ATTIC_TOP;
  // sign panel
  const panel = rect(-47, Y0 + 2, 47, Y1 - 2);
  add(bevel(panel.offset(1.6, 'Miter').subtract(panel), 0, T + 1.8, 0.4), 'trim');
  add(slab(panel, 0, T + 0.4), 'marquee');
  add(slab(text('STAR THEATER', 10, 0, (Y0 + Y1) / 2, 86), T + 0.3, T + 2.0), 'gold');
  // blind balustrades on the side bays
  for (const s of [-1, 1]) {
    const [a, b] = s < 0 ? [-83, -59] : [59, 83];
    add(bevel(rect(a, Y0, b, Y0 + 3), 0, T + 3, 0.4), 'trim');
    add(bevel(rect(a, Y1 - 3.4, b, Y1), 0, T + 3.2, 0.5), 'trim');
    for (let x = a + 3; x < b - 1.5; x += 3.6) add(baluster(x, Y0 + 3, T + 0.2, Y1 - Y0 - 6.4, 1.6), 'trim');
  }
  // pedestals with ball finials over every pilaster
  for (const [a, b] of [[-HW, -83], [-59, -49], [49, 59], [83, HW]]) {
    const cx = (a + b) / 2;
    add(bevel(rect(a, Y0, b, Y1 + 5), 0, T + 3, 0.5), 'trim');
    add(bevel(rect(a + 1.2, Y0 + 3, b - 1.2, Y1 + 1), T + 2.9, T + 3.6, 0.5), 'trim');
    add(bevel(rect(a - 0.8, Y1 + 4.6, b + 0.8, Y1 + 7.6), 0, T + 3.8, 0.6), 'trim');
    add(Manifold.cylinder(2.4, 2.6, 1.3, 24).rotate([-90, 0, 0]).translate([cx, Y1 + 7.2, 6]).add(box(cx - 2.6, Y1 + 7.2, 0, cx + 2.6, Y1 + 8.6, 6)), 'trim');
    add(knob(cx, Y1 + 12.8, 3.9, 3.9), 'gold');
  }
}

// ================================================================ PEDIMENT: sunburst + star medallion
{
  const { cx, cy, R } = PED;
  const outer = circle(cx, cy, R, 160);
  const band = outer.subtract(circle(cx, cy, R - 3.2, 160)).intersect(rect(-60, ATTIC_TOP - 2, 60, 260));
  add(bevel(band, 0, T + 2.8, 0.6), 'trim');
  const mc = [0, ATTIC_TOP + 8];
  // rays
  const rays = [];
  for (let i = 0; i <= 16; i++) {
    const a = i * 180 / 16, long = i % 2 === 0;
    const L = long ? 40 : 30, w = long ? 2.3 : 1.5;
    rays.push(poly([[0, -w], [L, -0.35], [L, 0.35], [0, w]]).rotate(a).translate(mc));
  }
  const inner = circle(cx, cy, R - 4, 160).intersect(rect(-60, ATTIC_TOP, 60, 260));
  add(slab(unionCS(rays).intersect(inner), T - 0.2, T + 1.1), 'gold');
  // medallion
  add(bevel(circle(...mc, 12.5, 96), 0, T + 2.2, 0.6), 'trim');
  add(bevel(circle(...mc, 10.5, 96), T + 2, T + 2.8, 0.4), 'marquee');
  add(slab(star(...mc, 9, 3.8), T + 2.6, T + 3.2), 'gold');
  add(pyramidStar(...mc, 9, T + 3.1, 2.4, 3.8), 'gold');
  // little star finial on the apex
  add(slab(star(cx, cy + R + 1.6, 4.2, 1.8), 0, T + 1.2), 'gold');
  add(pyramidStar(cx, cy + R + 1.6, 4.2, T + 1.1, 1.6, 1.8), 'gold');
  // scrolls where the pediment meets the frieze
  for (const s of [-1, 1]) {
    const sx = s * 39.5, sy = ATTIC_TOP + 1.2;
    const sc = circle(sx, sy, 3.4, 48).subtract(circle(sx, sy, 1.6, 48)).add(circle(sx, sy, 0.9, 24));
    add(slab(circle(sx, sy, 3.4, 48), 0, T), 'stone');
    add(bevel(sc, 0, T + 2.4, 0.3), 'trim');
  }
}

// ================================================================ ASSEMBLE
parts.unshift(wall);
let model = Manifold.union(parts).trimByPlane([0, 0, 1], 0);
// Guard against loose islands (parts that only touch): drop slivers, fail on anything bigger.
{
  const comps = model.decompose().sort((a, b) => b.volume() - a.volume());
  const loose = comps.slice(1);
  for (const c of loose) {
    const b = c.boundingBox();
    if (c.volume() > 1) throw new Error(`loose part (${c.volume().toFixed(1)} mm3) at ${b.min.map(v => v.toFixed(1))}`);
  }
  if (loose.length) { console.log(`dropped ${loose.length} sliver(s)`); model = comps[0]; }
}
const bb = model.boundingBox();
console.log(`facade: ${model.numTri()} tris, bbox ${bb.min.map(v => v.toFixed(1))} .. ${bb.max.map(v => v.toFixed(1))}, genus ${model.genus()}, status ${model.status()}`);

fs.mkdirSync(OUT, { recursive: true });
const mesh = model.getMesh();
writeSTL(path.join(OUT, 'star-theater.stl'), mesh.vertProperties, mesh.triVerts, mesh.numProp);
writePreview(path.join(OUT, 'star-theater.bin'), mesh);

// ================================================================ BRACE (optional rear support, print 2-3 and glue on)
{
  const H = 90, D = 36, Th = 4;
  const tri = poly([[0, 0], [D, 0], [D, 6], [8, H], [0, H]]).subtract(poly([[7, 8], [D - 8, 8], [9, H - 26]]));
  const brace = tri.extrude(Th);
  const m = brace.getMesh();
  const b = brace.boundingBox();
  console.log(`brace: ${brace.numTri()} tris, bbox ${b.max.map(v => v.toFixed(1))}`);
  writeSTL(path.join(OUT, 'brace.stl'), m.vertProperties, m.triVerts, m.numProp);
}

// ---------------------------------------------------------------- writers
function writeSTL(file, vp, tv, np) {
  const n = tv.length / 3;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('Star Theater facade - generated by model/build.mjs', 0);
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

// Compact preview mesh: header [nVert, nTri] u32, positions f32, indices u32, group per triangle u8.
function writePreview(file, mesh) {
  const np = mesh.numProp, nv = mesh.vertProperties.length / np, nt = mesh.triVerts.length / 3;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = mesh.vertProperties[i * np + k];
  const grp = new Uint8Array(nt);
  for (let r = 0; r < mesh.runOriginalID.length; r++) {
    const g = idGroup.get(mesh.runOriginalID[r]) ?? 0;
    grp.fill(g, mesh.runIndex[r] / 3, mesh.runIndex[r + 1] / 3);
  }
  const head = new Uint32Array([nv, nt]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(head.buffer), Buffer.from(pos.buffer), Buffer.from(new Uint32Array(mesh.triVerts).buffer), Buffer.from(grp.buffer)]));
  console.log('wrote', path.relative(ROOT, file), (fs.statSync(file).size / 1e6).toFixed(1), 'MB');
}
