// The two syndicates: Harbormen hold the Docks, Foundry Kings hold
// Foundry Row. Members patrol their turf, react to gunfire, call for
// backup, and turn hostile when the player's standing with their faction
// falls — or when the player shoots first. Reputation is the memory.

import { clamp, dampAngle, dist2 } from './utils.js';
import { animateWalker, buildWalkerMesh } from './pedestrians.js';

export const FACTIONS = {
  harbormen: {
    name: { en: 'Harbormen', id: 'Harbormen' },
    territory: [-600, -150, -150, 300], hq: { x: -460, z: -60 },
    coat: 0x2f4a3f, skin: 0xc98d5e,
  },
  foundry: {
    name: { en: 'Foundry Kings', id: 'Foundry Kings' },
    territory: [-600, -600, -150, -150], hq: { x: -225, z: -375 },
    coat: 0x4a2f2f, skin: 0xd9a77c,
  },
  rogue: {
    name: { en: 'Rogue crew', id: 'Komplotan liar' },
    territory: null, hq: null, coat: 0x3a3a3a, skin: 0xa8764a,
  },
  vex: {
    name: { en: 'Vex Kroll', id: 'Vex Kroll' },
    territory: null, hq: null, coat: 0x4a2a4a, skin: 0xd9b08c,
  },
};

export function createGangs(game) {
  const members = [];
  let ambientTimer = 0;
  let backupCooldown = 0;

  function inTerritory(faction, x, z) {
    const rect = FACTIONS[faction].territory;
    if (!rect) return false;
    return x >= rect[0] && x <= rect[2] && z >= rect[1] && z <= rect[3];
  }

  function spawnMember(faction, x, z, opts = {}) {
    const info = FACTIONS[faction];
    const parts = buildWalkerMesh(opts.coat ?? info.coat, info.skin, 0x1c1c1c, 0x222222);
    parts.group.position.set(x, 0, z);
    game.scene.add(parts.group);
    const member = {
      x, z, heading: Math.random() * Math.PI * 2, speed: 0,
      hp: opts.hp ?? (faction === 'vex' ? 220 : 80), maxHp: opts.hp ?? (faction === 'vex' ? 220 : 80),
      state: opts.hostile ? 'hostile' : 'patrol',
      parts, walkPhase: Math.random() * 6, kind: faction === 'vex' ? 'vex' : faction === 'rogue' ? 'rogue' : 'gang',
      faction, weapon: opts.weapon || (faction === 'vex' ? 'vk7' : 'p9'),
      fireTimer: 1 + Math.random(), burstLeft: 0, burstTimer: 0,
      strafeDir: Math.random() < 0.5 ? 1 : -1, strafeTimer: 2 + Math.random() * 2,
      home: { x, z }, tag: opts.tag || null, ambient: !!opts.ambient,
      deadTimer: 0, fallAngle: 0, accuracy: opts.accuracy ?? 0.45,
      chaseTarget: null,
    };
    members.push(member);
    return member;
  }

  function hurt(member, amount, byPlayer, headshot) {
    if (member.state === 'dead') return;
    member.hp -= amount;
    if (byPlayer) {
      member.state = 'hostile';
      // Nearby members of the same faction join the fight.
      for (const other of members) {
        if (other !== member && other.faction === member.faction && other.state !== 'dead' && dist2(other.x, other.z, member.x, member.z) < 55) {
          other.state = 'hostile';
        }
      }
      if (member.faction === 'harbormen' || member.faction === 'foundry') {
        callBackup(member.faction, member.x, member.z);
      }
    }
    if (member.hp <= 0) {
      member.state = 'dead';
      member.deadTimer = 0;
      member.fallAngle = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
      game.events.emit('killed', { victim: member, killer: byPlayer ? 'player' : 'npc', x: member.x, z: member.z, kind: member.kind });
      if (byPlayer) {
        game.progress.stats.kills += 1;
        if (member.faction === 'harbormen' || member.faction === 'foundry') {
          game.progress.reputation[member.faction] = clamp(game.progress.reputation[member.faction] - 5, -100, 100);
          game.events.emit('crime', { kind: 'kill', x: member.x, z: member.z, heat: 30 });
        }
        if (member.faction === 'rogue') {
          game.events.emit('rogueDown', { member });
        }
      }
    }
  }

  function callBackup(faction, x, z) {
    if (backupCooldown > 0) return;
    backupCooldown = 25;
    const hq = FACTIONS[faction].hq;
    if (!hq) return;
    for (let i = 0; i < 2; i += 1) {
      const m = spawnMember(faction, hq.x + (Math.random() - 0.5) * 10, hq.z + (Math.random() - 0.5) * 10, { hostile: true });
      m.chaseTarget = { x, z };
    }
    game.hud.notify(game.settings.language === 'id' ? 'Bala bantuan datang!' : 'Backup is coming!', 'bad');
  }

  function spawnSquad(faction, x, z, count, opts = {}) {
    const squad = [];
    for (let i = 0; i < count; i += 1) {
      squad.push(spawnMember(faction, x + (Math.random() - 0.5) * 8, z + (Math.random() - 0.5) * 8, { ...opts, hostile: opts.hostile ?? true }));
    }
    return squad;
  }

  function aliveWithTag(tag) {
    return members.filter((m) => m.tag === tag && m.state !== 'dead').length;
  }

  function removeTag(tag) {
    for (let i = members.length - 1; i >= 0; i -= 1) {
      if (members[i].tag === tag) {
        game.scene.remove(members[i].parts.group);
        members.splice(i, 1);
      }
    }
  }

  game.events.on('gunshot', ({ x, z, shooter }) => {
    if (shooter !== 'player') return;
    for (const m of members) {
      if (m.state === 'dead' || m.state === 'hostile') continue;
      if (dist2(m.x, m.z, x, z) < 40 && inTerritory(m.faction, x, z)) {
        m.state = 'hostile';
        m.chaseTarget = { x, z };
      }
    }
  });

  function update(dt) {
    backupCooldown = Math.max(0, backupCooldown - dt);
    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = 4;
      for (const faction of ['harbormen', 'foundry']) {
        const count = members.filter((m) => m.faction === faction && m.ambient && m.state !== 'dead').length;
        if (count < 3) {
          const hq = FACTIONS[faction].hq;
          spawnMember(faction, hq.x + (Math.random() - 0.5) * 30, hq.z + (Math.random() - 0.5) * 30, { ambient: true });
        }
      }
    }
    for (let i = members.length - 1; i >= 0; i -= 1) {
      const m = members[i];
      if (m.state === 'dead') {
        m.deadTimer += dt;
        m.parts.group.rotation.x += (m.fallAngle - m.parts.group.rotation.x) * Math.min(1, dt * 6);
        if (m.deadTimer > 20) {
          game.scene.remove(m.parts.group);
          members.splice(i, 1);
        }
        continue;
      }
      const dPlayer = dist2(m.x, m.z, game.player.x, game.player.z);
      const rep = game.progress.reputation[m.faction] ?? 0;
      // Anti-stuck: a hostile fighter that cannot move (spawned against
      // a wall) steps to the nearest road point instead of freezing.
      if (m.state === 'hostile') {
        if (m.lastX === undefined) {
          m.lastX = m.x;
          m.lastZ = m.z;
          m.stuckTimer = 0;
        } else if (dist2(m.x, m.z, m.lastX, m.lastZ) < 0.5) {
          m.stuckTimer += dt;
          if (m.stuckTimer > 3) {
            const rp = game.roadgraph.nearestRoadPoint(m.x, m.z);
            m.x = rp.x;
            m.z = rp.z;
            m.stuckTimer = 0;
          }
        } else {
          m.stuckTimer = 0;
        }
        m.lastX = m.x;
        m.lastZ = m.z;
      }
      // Turf hostility: a hated player is attacked on sight.
      if (m.state === 'patrol' && rep < -30 && dPlayer < 40 && !game.physics.segmentBlocked(m.x, m.z, game.player.x, game.player.z)) {
        m.state = 'hostile';
      }
      let moving = 0;
      let aiming = false;
      if (m.state === 'hostile') {
        const hasLOS = !game.physics.segmentBlocked(m.x, m.z, game.player.x, game.player.z);
        const target = m.chaseTarget && dPlayer > 60 ? m.chaseTarget : { x: game.player.x, z: game.player.z };
        const dTarget = dist2(m.x, m.z, target.x, target.z);
        // Keep a fighting distance: close in past 22 m, strafe inside it.
        m.strafeTimer -= dt;
        if (m.strafeTimer <= 0) {
          m.strafeTimer = 1.5 + Math.random() * 2;
          m.strafeDir *= -1;
        }
        let wishX = 0;
        let wishZ = 0;
        if (dTarget > 22) {
          wishX = (target.x - m.x) / dTarget;
          wishZ = (target.z - m.z) / dTarget;
        } else if (dTarget < 9) {
          wishX = -(target.x - m.x) / dTarget;
          wishZ = -(target.z - m.z) / dTarget;
        } else {
          const perpX = -(target.z - m.z) / dTarget * m.strafeDir;
          const perpZ = (target.x - m.x) / dTarget * m.strafeDir;
          wishX = perpX * 0.7;
          wishZ = perpZ * 0.7;
        }
        if (wishX !== 0 || wishZ !== 0) {
          const moved = game.physics.moveWalker(m, wishX, wishZ, 5.2, dt);
          moving = moved.moved ? 0.9 : 0.2;
        }
        m.heading = dampAngle(m.heading, Math.atan2(game.player.x - m.x, game.player.z - m.z), 8, dt);
        // Fire in bursts when the player is visible and in range.
        if (hasLOS && dPlayer < 45) {
          aiming = true;
          m.fireTimer -= dt;
          if (m.fireTimer <= 0 && m.burstLeft <= 0) {
            m.burstLeft = m.weapon === 'vk7' ? 4 : 3;
            m.burstTimer = 0;
            m.fireTimer = 1.4 + Math.random() * 1.2;
          }
        }
        if (m.burstLeft > 0) {
          m.burstTimer -= dt;
          if (m.burstTimer <= 0) {
            m.burstTimer = m.weapon === 'vk7' ? 0.13 : 0.3;
            m.burstLeft -= 1;
            game.combat.npcShoot(m, game.player.x, game.player.y + 1.2, game.player.z, m.weapon, m.accuracy);
            game.player.lastCombatAt = game.time;
          }
        }
        // Give up the chase far from home when the player escapes.
        if (dPlayer > 130 && !m.tag) {
          m.state = 'patrol';
          m.chaseTarget = null;
        }
      } else {
        // Patrol: drift around home, pause, drift again.
        if (!m.patrolTarget || dist2(m.x, m.z, m.patrolTarget.x, m.patrolTarget.z) < 3 || Math.random() < dt * 0.05) {
          m.patrolTarget = { x: m.home.x + (Math.random() - 0.5) * 40, z: m.home.z + (Math.random() - 0.5) * 40 };
        }
        const want = Math.atan2(m.patrolTarget.x - m.x, m.patrolTarget.z - m.z);
        m.heading = dampAngle(m.heading, want, 3, dt);
        const moved = game.physics.moveWalker(m, Math.sin(m.heading), Math.cos(m.heading), 1.5, dt);
        moving = moved.moved ? 0.5 : 0;
      }
      m.walkPhase += dt * 7 * (moving > 0 ? 1 : 0);
      animateWalker(m.parts, m.walkPhase, moving, aiming, false);
      m.parts.group.position.set(m.x, 0, m.z);
      m.parts.group.rotation.y = m.heading;
    }
  }

  function reset() {
    for (const m of members) game.scene.remove(m.parts.group);
    members.length = 0;
  }

  return {
    members, update, hurt, spawnMember, spawnSquad, aliveWithTag, removeTag, reset, inTerritory,
  };
}
