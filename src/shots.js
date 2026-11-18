// Screenshot scenes behind ?shot=chase|street|night|finale. Each one
// stages the real game — real systems, real HUD, real minimap — then
// lets the loop run so police arrive, crowds gather and the camera
// settles before window.__shotReady is set for the capture.

export function stageShot(game, name) {
  window.__shotReady = false;
  const player = game.player;

  function putInCar(defId, x, z, heading, speed) {
    const vehicle = game.vehicles.spawn(defId, x, z, heading, {});
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
    // minimap route, and a live objective.
    game.weather.setState(16.5, 'clear');
    game.progress.flags.safehouse = true;
    putInCar('swift', -300, -40, 0, 22);
    game.wanted.setState(65, 3);
    game.hud.setObjective('Reach the safehouse — lose the police', -420, 60);
    game.minimap.setTarget(-420, 60);
    game.hud.notify('Wanted level up: ★★★', 'bad');
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
    game.weather.setState(17.5, 'clear');
    player.teleport(-470, 505, Math.PI * 0.78);
    player.giveWeapon('vk7', true);
    player.currentWeapon = 'vk7';
    player.armor = 100;
    player.armorTier = 'heavy';
    game.cameraRig.snapBehind(Math.PI * 0.78);
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
