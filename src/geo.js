// geo.js — geometry helpers for the whole game, rewritten in phase 2.
//
// Draw-call discipline is the whole point: parts are merged into one
// BufferGeometry with per-vertex colours, so one car costs 2 draw calls
// (body + wheels), all buildings cost 1, and no geometry is ever
// allocated per frame — merges happen once, at build time. This rewrite
// keeps the exact same public API the phase-1 modules used, adds sphere
// / cone / plane primitives the phase-2 systems need (helicopter rotors,
// cache markers, explosion shells), and makes mergeGeoms tolerate parts
// that carry no colour attribute yet.

import * as THREE from '../vendor/three.min.js';

/** Apply position / rotation / scale to a geometry clone and return it. */
export function xform(geom, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geom.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g;
}

/** Fill a geometry with a flat vertex colour. Returns the same geometry. */
export function paint(geom, hex) {
  const c = new THREE.Color(hex);
  const count = geom.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

function ensureColor(p) {
  if (p.attributes.color) return;
  const n = p.attributes.position.count;
  p.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
}

/**
 * Merge several indexed BufferGeometries (all with position + normal +
 * uv, each already painted) into one geometry. Parts share one material
 * (MeshStandardMaterial with vertexColors: true). Parts without a colour
 * attribute are painted white first, so a caller can merge raw
 * primitives without pre-painting them.
 */
export function mergeGeoms(parts) {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    ensureColor(p);
    vCount += p.attributes.position.count;
    iCount += p.index ? p.index.count : p.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    pos.set(p.attributes.position.array, vOff * 3);
    nor.set(p.attributes.normal.array, vOff * 3);
    col.set(p.attributes.color.array, vOff * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, vOff * 2);
    if (p.index) {
      const src = p.index.array;
      for (let i = 0; i < src.length; i++) idx[iOff + i] = src[i] + vOff;
      iOff += src.length;
    } else {
      for (let i = 0; i < n; i++) idx[iOff + i] = vOff + i;
      iOff += n;
    }
    vOff += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** A box, painted, optionally transformed (ry = yaw). */
export function box(w, h, d, hex, px = 0, py = 0, pz = 0, ry = 0) {
  return paint(xform(new THREE.BoxGeometry(w, h, d), px, py, pz, 0, ry, 0), hex);
}

/** A cylinder (radiusTop, radiusBottom, height, segments), painted, transformed. */
export function cyl(rt, rb, h, seg, hex, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
  return paint(xform(new THREE.CylinderGeometry(rt, rb, h, seg), px, py, pz, rx, ry, rz), hex);
}

/** A sphere, painted, optionally transformed. */
export function sphere(r, segW, segH, hex, px = 0, py = 0, pz = 0) {
  return paint(xform(new THREE.SphereGeometry(r, segW, segH), px, py, pz), hex);
}

/** A cone (radius, height, segments), painted, optionally transformed. */
export function cone(r, h, seg, hex, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
  return paint(xform(new THREE.ConeGeometry(r, h, seg), px, py, pz, rx, ry, rz), hex);
}

/** A flat quad on the ground (used for road strips and skid marks).
 *  Wound counter-clockwise seen from above so the front face points
 *  up: the phase-1 winding pointed down, which made every road strip
 *  backface-culled and invisible from the camera — the city read as a
 *  bare green field. */
export function groundQuad(x0, z0, x1, z1, y, hex) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([
    x0, y, z0, x1, y, z1, x1, y, z0,
    x0, y, z0, x0, y, z1, x1, y, z1,
  ]);
  const nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2));
  paint(g, hex);
  return g;
}

/** Make a canvas texture by drawing with a callback. */
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Standard material for merged vertex-coloured geometry. */
export function stdMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.08,
    ...opts,
  });
}

/**
 * Ray vs axis-aligned box (2D footprint + height). Returns the distance
 * along the ray to the first hit, or Infinity. Used by the camera for
 * occlusion shortening and by combat for wall hits — no physics engine.
 */
export function rayVsAABB(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let tMin = 0;
  let tMax = maxDist;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.x0, 0, b.z0];
  const mx = [b.x1, b.height, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return Infinity;
    }
  }
  return tMin;
}

/** Point inside an AABB footprint (x/z) and under its height? */
export function pointInAABB(x, y, z, b) {
  return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= 0 && y <= b.height;
}
