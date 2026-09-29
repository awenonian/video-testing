// Sanity-checks an STL: re-imports it as a manifold and reports connected components.
// Usage: node model/check-stl.mjs out/star-theater.stl
import fs from 'node:fs'; import Module from 'manifold-3d';
const w = await Module(); w.setup();
const buf = fs.readFileSync(process.argv[2]); const n = buf.readUInt32LE(80);
const vp = new Float32Array(n*9), tv = new Uint32Array(n*3);
for (let t=0;t<n;t++){ for(let k=0;k<9;k++) vp[t*9+k]=buf.readFloatLE(84+t*50+12+k*4); tv.set([t*3,t*3+1,t*3+2],t*3); }
const mesh = new w.Mesh({numProp:3, vertProperties:vp, triVerts:tv}); mesh.merge();
const m = new w.Manifold(mesh);
const parts = m.decompose();
console.log('status', m.status(), 'components', parts.length, 'genus', m.genus(), 'volume cm3', (m.volume()/1000).toFixed(1));
parts.map(p=>[p.volume(), p.boundingBox()]).sort((a,b)=>a[0]-b[0]).slice(0,-1).forEach(([v,b])=>console.log(v.toFixed(2), b.min.map(x=>x.toFixed(1)), b.max.map(x=>x.toFixed(1))));
