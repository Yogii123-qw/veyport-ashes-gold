// minimap.js — the minimap, the full map, and the route line.
//
// North-up, 220 px in the corner, redrawn at most every 150 ms. It
// shows roads, districts, landmarks, the player's arrow, traffic dots,
// police blips (red, only while the player is wanted), the mission
// waypoint with a real route line from the road graph, contract markers,
// and the player's own custom marker (click to place, click the full
// map to move it). Zoom on the full map follows the mouse wheel; at
// speed the minimap zooms out on its own.

import { LANDMARKS } from './city.js';

export function createMinimap(deps) {
  const { player, vehicles, city } = deps;
  const minimapCtx = document.getElementById('minimap').getContext('2d');
  const fullmapCtx = document.getElementById('fullmap').getContext('2d');
  let lastDraw = 0;
  let marker = null;
  let zoom = 1;

  function drawMap(ctx, size, opts = {}) {
    const s = (size / 1200) * zoom;
    const toPx = (x, z) => [(x + 600) * s, (z + 600) * s];
    ctx.fillStyle = '#141a26';
    ctx.fillRect(0, 0, size, size);
    // Sea + beach.
    ctx.fillStyle = '#1d4a66';
    ctx.fillRect(0, size - 40 * s, size, 40 * s);
    ctx.fillStyle = '#d8c49a';
    ctx.fillRect(0, size - 62 * s, size, 22 * s);
    // Roads.
    ctx.strokeStyle = '#5a5f68';
    ctx.lineWidth = Math.max(1, 10 * s);
    const seen = new Set();
    city.nodes.forEach((n, i) => {
      for (const j of city.adjacency[i]) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [x1, z1] = toPx(n.x, n.z);
        const [x2, z2] = toPx(city.nodes[j].x, city.nodes[j].z);
        ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke();
      }
    });
    // Landmarks.
    const lmColors = { safehouse: '#3fae5a', bar: '#e8a33c', armory: '#d83a2a', chopshop: '#9aa0a8', lighthouse: '#ffd23c', garage: '#3fae5a' };
    for (const [key, L] of Object.entries(LANDMARKS)) {
      const [x, z] = toPx(L.x, L.z);
      ctx.fillStyle = lmColors[key] || '#ffffff';
      ctx.beginPath(); ctx.arc(x, z, Math.max(2, 4 * s * 2), 0, Math.PI * 2); ctx.fill();
    }
    // Mission waypoint + route.
    const wp = opts.waypoint;
    if (wp) {
      const p = player.position();
      const route = city.route(p.x, p.z, wp.x, wp.z);
      ctx.strokeStyle = '#e8a33c';
      ctx.lineWidth = Math.max(1, 3 * s * 2);
      ctx.beginPath();
      let [x, z] = toPx(p.x, p.z);
      ctx.moveTo(x, z);
      for (const n of route) { [x, z] = toPx(n.x, n.z); ctx.lineTo(x, z); }
      ctx.stroke();
      const [wx, wz] = toPx(wp.x, wp.z);
      ctx.fillStyle = '#e8a33c';
      ctx.beginPath(); ctx.arc(wx, wz, Math.max(3, 5 * s * 2), 0, Math.PI * 2); ctx.fill();
    }
    // Contract marker.
    if (opts.contractWp) {
      const [x, z] = toPx(opts.contractWp.x, opts.contractWp.z);
      ctx.fillStyle = '#2ad2ff';
      ctx.beginPath(); ctx.arc(x, z, Math.max(3, 4 * s * 2), 0, Math.PI * 2); ctx.fill();
    }
    // Custom marker + its route.
    if (marker) {
      const p = player.position();
      const route = city.route(p.x, p.z, marker.x, marker.z);
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = Math.max(1, 2 * s * 2);
      ctx.beginPath();
      let [x, z] = toPx(p.x, p.z);
      ctx.moveTo(x, z);
      for (const n of route) { [x, z] = toPx(n.x, n.z); ctx.lineTo(x, z); }
      ctx.stroke();
      const [mx, mz] = toPx(marker.x, marker.z);
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - 6, mz - 6); ctx.lineTo(mx + 6, mz + 6);
      ctx.moveTo(mx + 6, mz - 6); ctx.lineTo(mx - 6, mz + 6);
      ctx.stroke();
    }
    // Traffic dots.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const v of vehicles.vehicles) {
      const [x, z] = toPx(v.x, v.z);
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
    // Police blips (only while wanted — the player can't see them otherwise).
    if (opts.police) {
      ctx.fillStyle = '#ff3a2a';
      for (const u of opts.police) {
        const [x, z] = toPx(u.x, u.z);
        ctx.beginPath(); ctx.arc(x, z, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Player arrow.
    const p = player.position();
    const [px, pz] = toPx(p.x, p.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(player.state.heading);
    ctx.fillStyle = '#e8a33c';
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function update(now, opts = {}) {
    if (now - lastDraw < 150) return;
    lastDraw = now;
    // Zoom out a little at speed so the road ahead stays visible.
    const pv = vehicles.getPlayerVehicle();
    zoom = pv ? 1 + Math.min(0.4, Math.abs(pv.speed) / pv.def.topSpeed * 0.4) : 1;
    drawMap(minimapCtx, 220, opts);
    if (opts.full) drawMap(fullmapCtx, 640, opts);
  }

  function mapClick(e, size) {
    const rect = e.target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const z = ((e.clientY - rect.top) / rect.height) * size;
    marker = { x: (x / (size / 1200)) - 600, z: (z / (size / 1200)) - 600 };
  }

  function bind() {
    const mini = document.getElementById('minimap');
    const full = document.getElementById('fullmap');
    if (mini) mini.addEventListener('click', (e) => mapClick(e, 220));
    if (full) {
      full.addEventListener('click', (e) => mapClick(e, 640));
      full.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom = Math.max(0.6, Math.min(2.2, zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
      }, { passive: false });
    }
  }

  return {
    update,
    bind,
    get marker() { return marker; },
    set marker(m) { marker = m; },
    drawMap,
  };
}
