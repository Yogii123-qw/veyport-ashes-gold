// Screenshot scenes behind ?shot=chase|street|night|finale. Each one
// stages the real game — real systems, real HUD, real minimap — then
// lets the loop run so police arrive, crowds gather and the camera
// settles before window.__shotReady is set for the capture.

export function stageShot(game, name) {
  window.__shotReady = false;
  const player = game.player;

  function putInCar(defId, x, z, heading, speed, color) {
    const vehicle = game.vehicles.spawn(defId, x, z, heading, color ? { color } : {});
    vehicle.driver = 'player';
    vehicle.vx = Math.sin(heading) * speed;
    vehicle.vz = Math.cos(heading) * speed;
    vehicle.speed = speed;
    player.vehicle = vehicle;
    player.x = x;
    player.z = z;
    player.heading = heading;
    player.parts.group.visible = false;
    game.cameraRig.snapBehind(heading);
    return vehicle;
  }

  if (name === 'chase') {
    // Cover: a pursuit at golden hour — wanted stars, police closing,
    // minimap route, and a live objective. The flagship supercar leads.
    game.weather.setState(16.5, 'clear');
    game.progress.flags.safehouse = true;
    putInCar('osprey', -300, -40, 0, 45, 0xc81e1e);
    game.wanted.setState(65, 3);
    game.hud.setObjective('Reach the safehouse — lose the police', -420, 60);
    game.minimap.setTarget(-420, 60);
    game.hud.notify('Wanted level up: ★★★', 'bad');
  } else if (name === 'supercar') {
    // The full supercar row on the Docks avenue: all five nose-on to
    // the camera, the player in a gap between them, backs to the lens.
    // Staged along the avenue so the camera behind the player stays on
    // open road instead of shortening against a building.
    game.weather.setState(10, 'clear');
    // Fixed paint per car so the five read as five at a glance.
    const row = [
      ['obsidian', 0x1a1a1e], ['seraph', 0xc81e1e], ['osprey', 0x1e6fc8],
      ['quasar', 0x7a1ec8], ['lumen', 0xf2c500],
    ];
    row.forEach(([defId, color], i) => {
      game.vehicles.spawn(defId, -340, -14 + i * 7, -Math.PI / 2, { parked: true, color });
    });
    player.teleport(-360, -3.5, Math.PI / 2);
    player.currentWeapon = 'p9';
    game.cameraRig.snapBehind(Math.PI / 2);
    game.hud.setObjective('Five supercars. Every one of them stealable.', -340, 0);
    game.minimap.setTarget(-340, 0);
  } else if (name === 'aim') {
    // Over-shoulder aim: the pistol in hand, crosshair live, gang ahead.
    game.weather.setState(10, 'clear');
    player.teleport(240, 210, Math.PI);
    player.currentWeapon = 'p9';
    game.cameraRig.snapBehind(Math.PI);
    game.gangs.spawnSquad('foundry', 240, 178, 2, { tag: 'shot-aim', hostile: true });
    game.hud.setObjective('Aim down the sights', 240, 178);
    game.minimap.setTarget(240, 178);
  } else if (name === 'speed') {
    // Flat out on the ring road: speedometer, FOV kick, roadside blur.
    game.weather.setState(16.5, 'clear');
    game.progress.flags.safehouse = true;
    putInCar('quasar', -300, -540, Math.PI / 2, 70);
    game.hud.setObjective('Ring Road Sprint — hold it flat', 540, -540);
    game.minimap.setTarget(540, -540);
  } else if (name === 'street') {
    // On foot in Little Bazaar at midday, crowd and stalls around.
    game.weather.setState(10, 'clear');
    player.teleport(240, 210, Math.PI);
    player.currentWeapon = 'p9';
    game.cameraRig.snapBehind(Math.PI);
    game.hud.setObjective('Go to The Rusty Anchor', 60, -60);
    game.minimap.setTarget(60, -60);
  } else if (name === 'night') {
    // Night race in the rain on Neon Mile, neon signs lit.
    game.weather.setState(21, 'rain');
    game.progress.flags.safehouse = true;
    putInCar('bulldog', 0, -160, 0, 18);
    game.hud.setObjective('Hit all three gates before time runs out', 150, 0);
    game.minimap.setTarget(150, 0);
  } else if (name === 'finale') {
    // The lighthouse fight at dusk: Vex and his crew hold the light.
    // The player stands northeast of the Ember Light, facing it, so
    // the tower and the crew are in frame ahead — not behind the lens.
    game.weather.setState(17.5, 'clear');
    player.teleport(-470, 505, -0.71);
    player.giveWeapon('vk7', true);
    player.currentWeapon = 'vk7';
    player.armor = 100;
    player.armorTier = 'heavy';
    game.cameraRig.snapBehind(-0.71);
    game.gangs.spawnSquad('foundry', -482, 520, 3, { tag: 'shot-finale', hostile: true });
    game.gangs.spawnMember('vex', -488, 528, { tag: 'shot-finale', hostile: true });
    game.hud.setObjective('Take the lighthouse', -500, 540);
    game.minimap.setTarget(-500, 540);
  } else {
    // Unknown shot name: the spawn, honestly staged.
    game.weather.setState(8, 'clear');
  }

  // Let the loop run: police close in, crowds spawn, rain falls, and
  // the camera settles behind the car before the frame is taken.
  setTimeout(() => {
    window.__shotReady = true;
  }, 3000);
}
