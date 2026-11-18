// RoadGraph: the one road network shared by traffic, police, route
// drawing and spawn logic. Nodes sit at every grid intersection and ring
// junction; edges run along avenues, streets and the ring road. Routes
// are Dijkstra over ~80 nodes — cheap enough to run per request.

import { GRID_LINES, RING } from '../data/cityData.js';
import { dist2 } from './utils.js';

export function createRoadGraph() {
  const nodes = [];
  const indexByKey = new Map();
  const adjacency = new Map();

  function addNode(x, z) {
    const key = `${x},${z}`;
    if (indexByKey.has(key)) return indexByKey.get(key);
    const id = nodes.length;
    nodes.push({ id, x, z });
    indexByKey.set(key, id);
    adjacency.set(id, []);
    return id;
  }
  function link(a, b) {
    const w = dist2(nodes[a].x, nodes[a].z, nodes[b].x, nodes[b].z);
    adjacency.get(a).push({ to: b, w });
    adjacency.get(b).push({ to: a, w });
  }

  // Grid intersections.
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) addNode(gx, gz);
  }
  // Ring junctions: avenues and streets meet the ring.
  for (const g of GRID_LINES) {
    addNode(g, -RING);
    addNode(g, RING);
    addNode(-RING, g);
    addNode(RING, g);
  }
  addNode(-RING, -RING);
  addNode(RING, -RING);
  addNode(-RING, RING);
  addNode(RING, RING);

  const sorted = [...GRID_LINES].sort((a, b) => a - b);
  // Avenues (north-south): from -RING to RING through every grid street.
  for (const gx of GRID_LINES) {
    const stops = [-RING, ...sorted, RING];
    for (let i = 0; i < stops.length - 1; i += 1) {
      link(indexByKey.get(`${gx},${stops[i]}`), indexByKey.get(`${gx},${stops[i + 1]}`));
    }
  }
  // Streets (east-west).
  for (const gz of GRID_LINES) {
    const stops = [-RING, ...sorted, RING];
    for (let i = 0; i < stops.length - 1; i += 1) {
      link(indexByKey.get(`${stops[i]},${gz}`), indexByKey.get(`${stops[i + 1]},${gz}`));
    }
  }
  // Ring road rectangle.
  const ringStops = [-RING, ...sorted, RING];
  for (let i = 0; i < ringStops.length - 1; i += 1) {
    link(indexByKey.get(`${ringStops[i]},${-RING}`), indexByKey.get(`${ringStops[i + 1]},${-RING}`));
    link(indexByKey.get(`${ringStops[i]},${RING}`), indexByKey.get(`${ringStops[i + 1]},${RING}`));
    link(indexByKey.get(`${-RING},${ringStops[i]}`), indexByKey.get(`${-RING},${ringStops[i + 1]}`));
    link(indexByKey.get(`${RING},${ringStops[i]}`), indexByKey.get(`${RING},${ringStops[i + 1]}`));
  }

  // Road centreline segments, for ground texture, minimap and proximity.
  const segments = [];
  for (const gx of GRID_LINES) segments.push({ ax: gx, az: -RING, bx: gx, bz: RING });
  for (const gz of GRID_LINES) segments.push({ ax: -RING, az: gz, bx: RING, bz: gz });
  segments.push({ ax: -RING, az: -RING, bx: RING, bz: -RING });
  segments.push({ ax: -RING, az: RING, bx: RING, bz: RING });
  segments.push({ ax: -RING, az: -RING, bx: -RING, bz: RING });
  segments.push({ ax: RING, az: -RING, bx: RING, bz: RING });

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = dist2(x, z, n.x, n.z);
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }

  function dijkstra(start, goal) {
    const dist = new Array(nodes.length).fill(Infinity);
    const prev = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    dist[start] = 0;
    for (let iter = 0; iter < nodes.length; iter += 1) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < nodes.length; i += 1) {
        if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      }
      if (u === -1) break;
      done[u] = true;
      if (u === goal) break;
      for (const edge of adjacency.get(u)) {
        const nd = dist[u] + edge.w;
        if (nd < dist[edge.to]) {
          dist[edge.to] = nd;
          prev[edge.to] = u;
        }
      }
    }
    if (dist[goal] === Infinity) return null;
    const path = [];
    let cur = goal;
    while (cur !== -1) {
      path.push(cur);
      cur = prev[cur];
    }
    path.reverse();
    return path;
  }

  /** Route as world points from (x,z) to (tx,tz), including both ends. */
  function route(x, z, tx, tz) {
    const start = nearestNode(x, z);
    const goal = nearestNode(tx, tz);
    const path = dijkstra(start, goal);
    if (!path) return [{ x, z }, { x: tx, z: tz }];
    const points = [{ x, z }];
    for (const id of path) points.push({ x: nodes[id].x, z: nodes[id].z });
    points.push({ x: tx, z: tz });
    return points;
  }

  function nearestRoadPoint(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const s of segments) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len2 = dx * dx + dz * dz;
      let t = len2 === 0 ? 0 : ((x - s.ax) * dx + (z - s.az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = s.ax + dx * t;
      const pz = s.az + dz * t;
      const d = dist2(x, z, px, pz);
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz, dist: d, heading: Math.atan2(dx, dz) };
      }
    }
    return best;
  }

  return {
    nodes,
    segments,
    nearestNode,
    route,
    routeLength(x, z, tx, tz) {
      const pts = route(x, z, tx, tz);
      let total = 0;
      for (let i = 1; i < pts.length; i += 1) total += dist2(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z);
      return total;
    },
    nearestRoadPoint,
    onRoad(x, z) {
      return nearestRoadPoint(x, z).dist <= 9.5;
    },
    randomNode(random, cx, cz, minDist, maxDist) {
      const candidates = nodes.filter((n) => {
        const d = dist2(cx, cz, n.x, n.z);
        return d >= minDist && d <= maxDist;
      });
      if (candidates.length === 0) return nodes[Math.floor(random() * nodes.length)];
      return candidates[Math.floor(random() * candidates.length)];
    },
    nodePosition(id) {
      return nodes[id];
    },
  };
}
