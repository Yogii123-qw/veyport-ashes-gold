// roadgraph.js — the one road graph every system shares (SPEC §2.2).
//
// Traffic, police, missions and the minimap route line all read this
// single graph: nodes at every grid intersection, edges along the roads,
// BFS routing between any two points. One source of truth, not three
// implementations. Extracted from city.js in the phase-2 restructure;
// the city still owns the roads' geometry, this owns their topology.

export const GRID_STEP = 150;
export const GRID_LINES = [-600, -450, -300, -150, 0, 150, 300, 450, 600];

export function createRoadGraph(rngFn) {
  const nodes = [];
  const nodeIndex = new Map();
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      if (gz > 520) continue; // beach has no intersections
      const id = nodes.length;
      nodeIndex.set(`${gx},${gz}`, id);
      nodes.push({ x: gx, z: gz });
    }
  }
  const adjacency = nodes.map(() => []);
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      if (gz > 520) continue;
      const id = nodeIndex.get(`${gx},${gz}`);
      for (const [dx, dz] of [[150, 0], [-150, 0], [0, 150], [0, -150]]) {
        const nid = nodeIndex.get(`${gx + dx},${gz + dz}`);
        if (nid !== undefined) adjacency[id].push(nid);
      }
    }
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - x;
      const dz = nodes[i].z - z;
      const dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  }

  /** BFS route between two points; returns [{x, z}] waypoints. */
  function route(ax, az, bx, bz) {
    const start = nearestNode(ax, az);
    const goal = nearestNode(bx, bz);
    const prev = new Array(nodes.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const n of adjacency[cur]) {
        if (prev[n] === -1) { prev[n] = cur; queue.push(n); }
      }
    }
    const path = [];
    let cur = goal;
    let guard = 0;
    while (cur !== start && cur !== -1 && guard < 200) {
      path.unshift({ x: nodes[cur].x, z: nodes[cur].z });
      cur = prev[cur];
      guard += 1;
    }
    path.unshift({ x: nodes[start].x, z: nodes[start].z });
    return path;
  }

  function nearestRoadPoint(x, z) {
    const gx = Math.max(-600, Math.min(600, Math.round(x / GRID_STEP) * GRID_STEP));
    const gz = Math.max(-600, Math.min(600, Math.round(z / GRID_STEP) * GRID_STEP));
    if (Math.abs(x - gx) <= Math.abs(z - gz)) return { x: gx, z };
    return { x, z: gz };
  }

  function randomRoadPoint(rngOverride) {
    const use = rngOverride || rngFn;
    const n = nodes[Math.floor(use() * nodes.length)];
    return { x: n.x + (use() - 0.5) * 10, z: n.z + (use() - 0.5) * 10 };
  }

  return {
    nodes,
    adjacency,
    route,
    nearestNode,
    nearestRoadPoint,
    randomRoadPoint,
  };
}
