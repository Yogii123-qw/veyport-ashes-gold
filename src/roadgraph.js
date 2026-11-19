// roadgraph.js - one shared road graph for traffic, police and minimap routes.
// Nodes are intersections; edges are road segments with a length weight.
// Layout: an 8x8 grid of avenues (spacing 150 m) inside a 1200 m square, plus a
// coastal ring road. The canal cuts the grid east-west at z = +150; two bridges
// and one tunnel carry roads across it. All positions are in world meters,
// x east, z south, y up. Origin is the city center (Neon Mile).

export const CITY_HALF = 600;
export const GRID_STEP = 150;

export class RoadGraph {
  constructor() {
    this.nodes = []; // { id, x, z, district }
    this.adj = new Map(); // id -> [{ to, w }]
    this.byKey = new Map();
  }

  addNode(x, z, district = '') {
    const key = `${x},${z}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, district });
    this.adj.set(id, []);
    this.byKey.set(key, id);
    return id;
  }

  link(a, b) {
    const na = this.nodes[a], nb = this.nodes[b];
    if (!na || !nb || a === b) return;
    const w = Math.hypot(na.x - nb.x, na.z - nb.z);
    this.adj.get(a).push({ to: b, w });
    this.adj.get(b).push({ to: a, w });
  }

  // Breadth-first hop path (fewest intersections).
  bfsPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const prev = new Map([[fromId, -1]]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const e of this.adj.get(cur) || []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, cur);
        if (e.to === toId) {
          const path = [toId];
          let p = cur;
          while (p !== -1) { path.push(p); p = prev.get(p); }
          return path.reverse();
        }
        queue.push(e.to);
      }
    }
    return [];
  }

  // Dijkstra shortest path by meters.
  shortestPath(fromId, toId) {
    const dist = new Map([[fromId, 0]]);
    const prev = new Map([[fromId, -1]]);
    const done = new Set();
    while (true) {
      let best = -1, bestD = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < bestD) { best = id; bestD = d; }
      }
      if (best === -1) return [];
      if (best === toId) break;
      done.add(best);
      for (const e of this.adj.get(best) || []) {
        const nd = bestD + e.w;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, best);
        }
      }
    }
    const path = [toId];
    let p = prev.get(toId);
    while (p !== -1 && p !== undefined) { path.push(p); p = prev.get(p); }
    return path.reverse();
  }

  nearestNode(x, z) {
    let best = -1, bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }

  nodePos(id) {
    const n = this.nodes[id];
    return n ? { x: n.x, z: n.z } : null;
  }

  // Polyline of a node path, as {x,z} points.
  pathPoints(path) {
    return path.map((id) => this.nodePos(id)).filter(Boolean);
  }

  // The road segment (edge) nearest to a point, for snapping cars to roads.
  nearestEdge(x, z) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      for (const e of this.adj.get(n.id) || []) {
        if (e.to < n.id) continue;
        const m = this.nodes[e.to];
        const dx = m.x - n.x, dz = m.z - n.z;
        const len2 = dx * dx + dz * dz;
        if (len2 === 0) continue;
        let t = ((x - n.x) * dx + (z - n.z) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = n.x + dx * t, pz = n.z + dz * t;
        const d = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (d < bestD) bestD = d, best = { a: n.id, b: e.to, x: px, z: pz, heading: Math.atan2(dx, dz) };
      }
    }
    return best;
  }
}

// Build the standard Veyport graph: grid avenues + coastal ring + canal crossings.
export function buildRoadGraph() {
  const g = new RoadGraph();
  const coords = [];
  for (let v = -CITY_HALF; v <= CITY_HALF; v += GRID_STEP) coords.push(v);
  // Grid nodes, skipping the canal band (z = +150 row is water except bridges/tunnel).
  const canalZ = 150;
  for (const x of coords) {
    for (const z of coords) {
      if (z === canalZ) continue; // canal row: only crossings below
      g.addNode(x, z, districtAt(x, z));
    }
  }
  // Canal crossings: two bridges (x = -300 and x = +300) and one tunnel (x = 0).
  const crossings = [-300, 0, 300];
  for (const x of crossings) {
    g.addNode(x, canalZ, 'canal');
  }
  // Grid links (skip links that would cross the canal except at crossings).
  const has = (x, z) => g.byKey.has(`${x},${z}`);
  for (const x of coords) {
    for (const z of coords) {
      if (z === canalZ) continue;
      if (has(x + GRID_STEP, z) && !(z === 0 && x === 150)) g.link(g.byKey.get(`${x},${z}`), g.byKey.get(`${x + GRID_STEP},${z}`));
      if (z + GRID_STEP === canalZ) {
        // link down to the crossing at the same x when it exists
        if (crossings.includes(x)) g.link(g.byKey.get(`${x},${z}`), g.byKey.get(`${x},${canalZ}`));
      } else if (has(x, z + GRID_STEP)) {
        g.link(g.byKey.get(`${x},${z}`), g.byKey.get(`${x},${z + GRID_STEP}`));
      }
      if (z === 300 && crossings.includes(x)) g.link(g.byKey.get(`${x},${z}`), g.byKey.get(`${x},${canalZ}`));
    }
  }
  // No east-west links along the canal row: z = 150 is water, not a
  // road. The crossings connect north-south only (to (x,0) and (x,300)
  // above). Linking the crossings to each other routed cars along the
  // canal itself, straight into the tunnel's side walls at x = 0.
  // Coastal ring road: square ring at +-585, linked to the nearest grid nodes.
  const R = 585;
  const ringPts = [];
  for (let v = -R; v <= R; v += GRID_STEP) {
    ringPts.push([-R, v], [R, v], [v, -R], [v, R]);
  }
  const ringIds = [];
  for (const [x, z] of ringPts) ringIds.push(g.addNode(x, z, 'ring'));
  for (let i = 0; i < ringIds.length; i++) {
    const a = ringIds[i], b = ringIds[(i + 1) % ringIds.length];
    // link consecutive ring points only when they share an edge of the square
    const na = g.nodes[a], nb = g.nodes[b];
    if (na.x === nb.x || na.z === nb.z) g.link(a, b);
  }
  // Stitch ring to grid at the four side midpoints.
  const stitch = [[-R, 0, -CITY_HALF, 0], [R, 0, CITY_HALF, 0], [0, -R, 0, -CITY_HALF], [0, R, 0, CITY_HALF]];
  for (const [rx, rz, gx, gz] of stitch) {
    const r = g.byKey.get(`${rx},${rz}`);
    const gg = g.byKey.get(`${gx},${gz}`);
    if (r !== undefined && gg !== undefined) g.link(r, gg);
  }
  return g;
}

export function districtAt(x, z) {
  if (z >= 300) return 'Ember Sands';
  if (x <= -300 && z < 0) return 'The Docks';
  if (x <= -300) return 'Foundry Row';
  if (x >= 150 && z < 150 && z >= -300) return 'Neon Mile';
  if (z < -300) return 'Palm Heights';
  return 'Little Bazaar';
}
