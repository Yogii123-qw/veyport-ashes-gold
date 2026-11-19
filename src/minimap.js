// minimap.js - the minimap and the full-screen map, drawn from the same
// function. North-up, roads + canal + landmarks + cars + the player
// arrow + the mission waypoint with its RoadGraph route + police blips
// + contract markers. One draw routine serves both canvases at
// different scales; the map never shows anything the game does not know.

export class MinimapSys {
  constructor(w) {
    this.w = w;
  }

  // data: { waypoint, routePoints, police, contractWp }
  draw(ctx, w, h, scale, cx, cz, data = {}) {
    const game = this.w;
    const px = (x) => w / 2 + (x - cx) * scale;
    const pz = (z) => h / 2 + (z - cz) * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0e1a24';
    ctx.fillRect(0, 0, w, h);
    // Sea on the east, land elsewhere.
    ctx.fillStyle = '#123a5c';
    ctx.fillRect(px(125), pz(-640), (640 - 125) * scale, 1280 * scale);
    ctx.fillStyle = '#1c2b33';
    ctx.fillRect(px(-640), pz(-640), 765 * scale, 1280 * scale);
    // Roads.
    ctx.strokeStyle = '#4a5560';
    ctx.lineWidth = Math.max(1, 6 * scale);
    for (let x = -600; x <= 600; x += 150) {
      ctx.beginPath(); ctx.moveTo(px(x), pz(-600)); ctx.lineTo(px(x), pz(600)); ctx.stroke();
    }
    for (let z = -600; z <= 600; z += 150) {
      ctx.beginPath(); ctx.moveTo(px(-600), pz(z)); ctx.lineTo(px(600), pz(z)); ctx.stroke();
    }
    // Canal.
    ctx.strokeStyle = '#2a6a9a';
    ctx.lineWidth = Math.max(2, 14 * scale);
    ctx.beginPath(); ctx.moveTo(px(150), pz(-600)); ctx.lineTo(px(150), pz(600)); ctx.stroke();
    // Mission route (RoadGraph polyline, gold).
    const route = data.routePoints || [];
    if (route.length > 1) {
      ctx.strokeStyle = '#f5c542';
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.beginPath();
      ctx.moveTo(px(game.player.x), pz(game.player.z));
      for (const n of route) ctx.lineTo(px(n.x), pz(n.z));
      ctx.stroke();
    }
    // Landmarks.
    ctx.fillStyle = '#f5c542';
    for (const lm of Object.values(game.city.landmarks)) {
      ctx.beginPath(); ctx.arc(px(lm.x), pz(lm.z), Math.max(2, 5 * scale), 0, Math.PI * 2); ctx.fill();
    }
    // Contract waypoint (cyan diamond).
    if (data.contractWp) {
      ctx.fillStyle = '#2affd8';
      const cxp = px(data.contractWp.x), czp = pz(data.contractWp.z);
      ctx.beginPath();
      ctx.moveTo(cxp, czp - 6); ctx.lineTo(cxp + 6, czp);
      ctx.lineTo(cxp, czp + 6); ctx.lineTo(cxp - 6, czp);
      ctx.closePath(); ctx.fill();
    }
    // Mission waypoint (pulsing gold ring).
    if (data.waypoint) {
      const wx = px(data.waypoint.x), wz = pz(data.waypoint.z);
      ctx.strokeStyle = '#f5c542';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wz, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#f5c542';
      ctx.beginPath(); ctx.arc(wx, wz, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // Police blips (red, only while wanted).
    if (data.police) {
      ctx.fillStyle = '#ff4040';
      for (const u of data.police) {
        ctx.beginPath(); ctx.arc(px(u.car.x), pz(u.car.z), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Cars (orange dots).
    ctx.fillStyle = '#ff6a3d';
    for (const c of game.cars) {
      if (c.wrecked) continue;
      ctx.fillRect(px(c.x) - 2, pz(c.z) - 2, 4, 4);
    }
    // Player arrow, pointing along the heading.
    const py = game.player.onFoot ? game.player.heading : (game.player.vehicle ? game.player.vehicle.heading : game.player.heading);
    ctx.save();
    ctx.translate(px(game.player.x), pz(game.player.z));
    ctx.rotate(Math.atan2(Math.sin(py), Math.cos(py)));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
