// The event bus: one channel every system shouts into and listens on.
// A gunshot, a crash, an explosion and a crime are events; police, gangs,
// pedestrians, missions and the HUD all react to the same event, so no
// system calls another system behind the caller's back.

export function createEventBus() {
  const listeners = new Map();
  const bus = {
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
      return () => {
        const list = listeners.get(type);
        const at = list.indexOf(handler);
        if (at >= 0) list.splice(at, 1);
      };
    },
    // One-shot listener: fires once, then removes itself. For events a
    // system only ever needs to hear the first time (a first kill, a
    // first storm), so callers cannot leak a permanent subscription.
    once(type, handler) {
      let off = null;
      off = bus.on(type, (payload) => {
        off();
        handler(payload);
      });
      return off;
    },
    listenerCount(type) {
      return listeners.get(type)?.length ?? 0;
    },
    emit(type, payload) {
      const list = listeners.get(type);
      if (!list) return;
      const copy = list.slice();
      for (const handler of copy) {
        try {
          handler(payload);
        } catch (error) {
          // One broken listener must never kill the frame or the bus.
          console.error(`[events] listener for ${type} failed:`, error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
  return bus;
}

// Event payload shapes (documented once, used everywhere):
// gunshot:   { x, z, loud, shooter: 'player' | 'npc' }
// explosion: { x, z, radius }
// crash:     { x, z, speed, vehicle, other }
// crime:     { kind, x, z, heat, witnessed }
// killed:    { victim, killer: 'player' | 'npc', x, z }
// alarm:     { x, z, radius } — a witness finished calling the police
// money:     { amount, label } — any real change of cash
// mission:   { kind, missionId, stageId }
// weather:   { kind, previous }
// pickup:    { kind, id, x, z }
