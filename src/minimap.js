// Two maps, one truth: the 220-pixel minimap in the corner and the
// full city map in the pause menu both draw from the same road graph,
// the same POI list, and the same route solver. Clicking the minimap
// sets a real custom marker with a real route; the wheel zooms; speed
// zooms the view out. Police blips appear only when the player could
// actually know where a unit is.

import { CACHES, DISTRICTS, GRID_LINES, POIS, RING, WATER_RECTS, districtAt } from '../data/cityData.js';
import { clamp, dist2 } from './utils.js';

const WORLD = 1200;
const COLORS = {
  bg: '#101820', road: '#4a5560', ring: '#5a6672', water: '#1d3a4a',
  player: '#ffc35c', police: '#ff5a4a', shop: '#7fd4ff', safehouse: '#9be07a',
  mission: '#ffc35c', cache: '#e8b64a', custom: '#ffffff', route: '#ffc35c',
  district: '#8a97a3', contract: '#c99df0',
};

export function createMinimap(game) {
  const canvas = document.getElementById('minimapCanvas');
  const ctx = canvas.getContext('2d');
  const fullCanvas = document.getElementById('fullmapCanvas');
  const fullCtx = fullCanvas.getContext('2d');
  const legendEl = document.getElementById('mapLegend');

  let zoom = 1;
  let scale = 0.85;
  let target = null;
  let customMarker = null;
  let route = [];
  let routeAt = { x: 0, z: 0 };
  let routeTimer = 0;
  const filters = { shops: true, caches: true, missions: true, contracts: true, police: true };

  function isOverCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function setTarget(x, z) {
    if (x === null || x === undefined) {
      target = null;
    } else {
      target = { x, z };
      customMarker = null;
      route = [];
      routeTimer = 0;
    }
  }

  function effectiveTarget() {
    return customMarker || target;
  }

  function refreshRoute() {
    const dest = effectiveTarget();
    if (!dest) {
      route = [];
      return;
    }
    route = game.roadgraph.route(game.player.x, game.player.z, dest.x, dest.z);
    routeAt = { x: game.player.x, z: game.player.z };
  }

  function drawBlip(g, x, y, kind) {
    const colorblind = game.settings.colorblind;
    g.fillStyle = COLORS[kind] || '#ffffff';
    if (!colorblind) {
      g.beginPath();
      g.arc(x, y, kind === 'mission' ? 5 : 3.5, 0, Math.PI * 2);
      g.fill();
      return;
    }
    // Shape + color: police squares, shops circles, safehouse triangles,
    // mission diamonds, caches crosses, contracts hexagons.
    g.beginPath();
    if (kind === 'police') g.rect(x - 4, y - 4, 8, 8);
    else if (kind === 'safehouse') {
      g.moveTo(x, y - 5);
      g.lineTo(x + 5, y + 4);
      g.lineTo(x - 5, y + 4);
      g.closePath();
    } else if (kind === 'mission') {
      g.moveTo(x, y - 5);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 5);
      g.lineTo(x - 5, y);
      g.closePath();
    } else if (kind === 'cache') {
      g.rect(x - 1, y - 5, 2, 10);
      g.rect(x - 5, y - 1, 10, 2);
    } else {
      g.arc(x, y, 4, 0, Math.PI * 2);
    }
    g.fill();
  }

  function drawRoads(g, toX, toZ) {
    g.strokeStyle = COLORS.road;
    g.lineWidth = 2;
    g.beginPath();
    for (const line of GRID_LINES) {
      g.moveTo(toX(line), toZ(-600));
      g.lineTo(toX(line), toZ(600));
      g.moveTo(toX(-600), toZ(line));
      g.lineTo(toX(600), toZ(line));
    }
    g.stroke();
    g.strokeStyle = COLORS.ring;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(toX(-RING), toZ(-RING));
    g.lineTo(toX(RING), toZ(-RING));
    g.lineTo(toX(RING), toZ(RING));
    g.lineTo(toX(-RING), toZ(RING));
    g.closePath();
    g.stroke();
  }

  function drawWater(g, toX, toZ) {
    g.fillStyle = COLORS.water;
    for (const entry of WATER_RECTS) {
      const [x0, z0, x1, z1] = entry.rect;
      const px0 = toX(x0);
      const pz0 = toZ(z0);
      g.fillRect(px0, pz0, toX(x1) - px0, toZ(z1) - pz0);
    }
  }

  function drawRoute(g, toX, toZ) {
    if (route.length < 2) return;
    g.strokeStyle = COLORS.route;
    g.lineWidth = 2.5;
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(toX(game.player.x), toZ(game.player.z));
    for (const node of route) g.lineTo(toX(node.x), toZ(node.z));
    g.stroke();
    g.setLineDash([]);
  }

  function drawPois(g, toX, toZ, full) {
    for (const poi of POIS) {
      if (poi.id === 'safehouse') {
        if (!filters.missions && full) continue;
        drawBlip(g, toX(poi.x), toZ(poi.z), 'safehouse');
      } else if (['gunshop', 'respray', 'chopshop', 'food', 'hospital', 'police'].includes(poi.kind)) {
        if (full && !filters.shops) continue;
        drawBlip(g, toX(poi.x), toZ(poi.z), 'shop');
      } else if (poi.kind === 'gangHq') {
        if (full && !filters.missions) continue;
        drawBlip(g, toX(poi.x), toZ(poi.z), 'mission');
      }
    }
    // Contract board at the bar.
    const bar = POIS.find((p) => p.id === 'bar');
    if (bar && (!full || filters.contracts)) drawBlip(g, toX(bar.x) + 6, toZ(bar.z) + 6, 'contract');
    // Found caches only — unfound ones stay secret.
    if (!full || filters.caches) {
      for (const cache of CACHES) {
        if (game.progress.cachesTaken.has(cache.id)) {
          drawBlip(g, toX(cache.x), toZ(cache.z), 'cache');
        }
      }
    }
  }

  function drawPolice(g, toX, toZ, full) {
    if (full && !filters.police) return;
    const seen = game.wanted.seen;
    for (const unit of game.police.units) {
      const v = unit.vehicle;
      if (!v) continue;
      if (seen || dist2(v.x, v.z, game.player.x, game.player.z) < 60) {
        drawBlip(g, toX(v.x), toZ(v.z), 'police');
      }
    }
    if (game.police.heliActive && seen) {
      // The blip sits where the helicopter actually is, not on the
      // player — the rotor is audible, so its position is fair game.
      const heli = game.police.heliPos;
      drawBlip(g, toX(heli ? heli.x : game.player.x), toZ(heli ? heli.z : game.player.z), 'police');
    }
  }

  function drawPlayer(g, x, y, heading) {
    g.save();
    g.translate(x, y);
    g.rotate(heading);
    g.fillStyle = COLORS.player;
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(-5, -6);
    g.lineTo(0, -3);
    g.lineTo(5, -6);
    g.closePath();
    g.fill();
    g.restore();
  }

  function update(dt) {
    routeTimer -= dt;
    if (routeTimer <= 0) {
      routeTimer = 2;
      if (effectiveTarget() && dist2(game.player.x, game.player.z, routeAt.x, routeAt.z) > 25) refreshRoute();
    }
    // Auto-zoom out with speed: smooth and proportional, so a supercar
    // at full throttle sees far further ahead than a parked car.
    const speed = game.player.vehicle ? Math.abs(game.player.vehicle.speed) : 0;
    const zoomOut = 1 / (1 + Math.max(0, speed - 15) * 0.012);
    const targetScale = clamp(0.85 * zoom * zoomOut, 0.3, 2.2);
    scale += (targetScale - scale) * Math.min(1, dt * 2);
    const size = 220;
    const cx = game.player.x;
    const cz = game.player.z;
    const toX = (x) => size / 2 + (x - cx) * scale;
    const toZ = (z) => size / 2 + (z - cz) * scale;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.clip();
    drawWater(ctx, toX, toZ);
    drawRoads(ctx, toX, toZ);
    drawRoute(ctx, toX, toZ);
    drawPois(ctx, toX, toZ, false);
    drawPolice(ctx, toX, toZ, false);
    const dest = effectiveTarget();
    if (dest) drawBlip(ctx, toX(dest.x), toZ(dest.z), 'mission');
    if (customMarker) drawBlip(ctx, toX(customMarker.x), toZ(customMarker.z), 'custom');
    drawPlayer(ctx, size / 2, size / 2, game.player.heading);
    ctx.restore();
    // North marker.
    ctx.fillStyle = COLORS.district;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('N ↑', 6, 14);
  }

  function drawFullMap() {
    const width = fullCanvas.width;
    const height = fullCanvas.height;
    const s = Math.min(width, height) / (WORLD + 40);
    const toX = (x) => width / 2 + x * s;
    const toZ = (z) => height / 2 + z * s;
    fullCtx.fillStyle = COLORS.bg;
    fullCtx.fillRect(0, 0, width, height);
    drawWater(fullCtx, toX, toZ);
    drawRoads(fullCtx, toX, toZ);
    // District names.
    fullCtx.fillStyle = COLORS.district;
    fullCtx.font = '13px system-ui, sans-serif';
    fullCtx.textAlign = 'center';
    for (const district of DISTRICTS) {
      const cx = (district.rect[0] + district.rect[2]) / 2;
      const cz = (district.rect[1] + district.rect[3]) / 2;
      fullCtx.fillText(district.name[game.settings.language] || district.name.en, toX(cx), toZ(cz));
    }
    drawRoute(fullCtx, toX, toZ);
    drawPois(fullCtx, toX, toZ, true);
    drawPolice(fullCtx, toX, toZ, true);
    const dest = effectiveTarget();
    if (dest) drawBlip(fullCtx, toX(dest.x), toZ(dest.z), 'mission');
    if (customMarker) drawBlip(fullCtx, toX(customMarker.x), toZ(customMarker.z), 'custom');
    drawPlayer(fullCtx, toX(game.player.x), toZ(game.player.z), game.player.heading);
    renderLegend();
  }

  function renderLegend() {
    const lang = game.settings.language;
    const items = [
      ['player', lang === 'id' ? 'Kamu' : 'You'],
      ['mission', lang === 'id' ? 'Misi / tujuan' : 'Mission / target'],
      ['shop', lang === 'id' ? 'Toko & layanan' : 'Shops & services'],
      ['safehouse', lang === 'id' ? 'Safehouse' : 'Safehouse'],
      ['contract', lang === 'id' ? 'Papan kontrak' : 'Contract board'],
      ['cache', lang === 'id' ? 'Cache ditemukan' : 'Cache found'],
      ['police', lang === 'id' ? 'Polisi (terlihat)' : 'Police (seen)'],
    ];
    legendEl.innerHTML = items.map(([kind, label]) => `<span class="legendItem"><span class="legendDot" style="background:${COLORS[kind]}"></span>${label}</span>`).join('');
  }

  function onMinimapClick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width * 220;
    const py = (clientY - rect.top) / rect.height * 220;
    const worldX = game.player.x + (px - 110) / scale;
    const worldZ = game.player.z + (py - 110) / scale;
    if (customMarker && dist2(worldX, worldZ, customMarker.x, customMarker.z) < 20) {
      customMarker = null;
      route = [];
      return;
    }
    customMarker = { x: clamp(worldX, -600, 600), z: clamp(worldZ, -600, 600) };
    refreshRoute();
    game.hud.notify(game.settings.language === 'id' ? 'Penanda dipasang' : 'Marker set', 'info');
  }

  function onWheel(deltaY) {
    zoom = clamp(zoom * (deltaY < 0 ? 1.2 : 0.84), 0.5, 2.5);
  }

  canvas.addEventListener('click', (event) => {
    onMinimapClick(event.clientX, event.clientY);
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    onWheel(event.deltaY);
  }, { passive: false });

  return {
    update, drawFullMap, setTarget, isOverCanvas, onWheel,
    get filters() { return filters; },
    setFilter(key, value) { filters[key] = value; },
    get customMarker() { return customMarker; },
    get target() { return target; },
    districtHere: () => districtAt(game.player.x, game.player.z),
  };
}
