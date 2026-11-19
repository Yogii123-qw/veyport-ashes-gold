// geo.js - small geometry helpers for Veyport.
// Everything here is built from three.js primitives at runtime; no asset files.
// The merge helper packs many axis-aligned boxes into ONE BufferGeometry with
// vertex colors, so a whole district of buildings costs a single draw call.

const THREE = window.THREE;

const materialCache = new Map();

export function mat(color, opts = {}) {
  const key = `${color}|${opts.rough ? 'r' : ''}${opts.metal ? 'm' : ''}${opts.emit ? 'e' + opts.emit : ''}${opts.flat ? 'f' : ''}`;
  if (!materialCache.has(key)) {
    const params = { color };
    if (opts.rough !== undefined) params.roughness = opts.rough;
    if (opts.metal !== undefined) params.metalness = opts.metal;
    if (opts.emit !== undefined) params.emissive = opts.emit;
    if (opts.flat) params.flatShading = true;
    materialCache.set(key, new THREE.MeshLambertMaterial(params));
  }
  return materialCache.get(key);
}

export function glowMat(color, intensity = 1) {
  const key = `glow|${color}|${intensity}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshBasicMaterial({ color }));
  }
  return materialCache.get(key);
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.mat || mat(color, opts));
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = !!opts.recv;
  return m;
}

export function cyl(rt, rb, h, seg, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), opts.mat || mat(color, opts));
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = !!opts.recv;
  return m;
}

export function sph(r, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg || 12, opts.seg2 || 8), opts.mat || mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = opts.shadow !== false;
  return m;
}

export function plane(w, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), opts.mat || mat(color, opts));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

export function groupAt(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

// Merge a list of colored axis-aligned boxes into a single mesh.
// Each entry: { w, h, d, x, y, z, color } - y is the box CENTER height.
// Vertex colors carry the color, so one material serves the whole merge.
export function mergeBoxes(list) {
  const pos = [];
  const col = [];
  const idx = [];
  const c = new THREE.Color();
  let base = 0;
  for (const b of list) {
    c.setHex(b.color);
    const hw = b.w / 2, hh = b.h / 2, hd = b.d / 2;
    const x = b.x, y = b.y, z = b.z;
    // 8 corners
    const corners = [
      [x - hw, y - hh, z - hd], [x + hw, y - hh, z - hd], [x + hw, y + hh, z - hd], [x - hw, y + hh, z - hd],
      [x - hw, y - hh, z + hd], [x + hw, y - hh, z + hd], [x + hw, y + hh, z + hd], [x - hw, y + hh, z + hd],
    ];
    // 6 faces, each 2 triangles (36 indices), winding outward
    const faces = [
      [4, 5, 6, 7], // +z
      [1, 0, 3, 2], // -z
      [5, 1, 2, 6], // +x
      [0, 4, 7, 3], // -x
      [7, 6, 2, 3], // +y
      [0, 1, 5, 4], // -y
    ];
    for (const p of corners) {
      pos.push(p[0], p[1], p[2]);
      col.push(c.r, c.g, c.b);
    }
    for (const f of faces) {
      idx.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
    }
    base += 8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// Deterministic pseudo-random from a seed (mulberry32). Used only for
// decorative variety that must look the same on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}
