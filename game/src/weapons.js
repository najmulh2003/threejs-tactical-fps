// The armoury: five original weapons and what each one costs, hits for and
// handles like. The rig is the first-person view model on the camera: it
// owns the magazine, the reload, the muzzle flash and the kick, while
// combat.js owns the ray and the damage. Ammo is kept per weapon, so
// switching keeps what each gun still holds.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const ARMOR_PRICE = 650;
export const GRENADE_PRICE = 300;

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2.5, mag: 12, reserve: 48, gap: 0.16, auto: false, reload: 1.4, spreadStill: 0.004, spreadMove: 0.026, range: 40, kick: 0.007, pellets: 1, kind: 'pistol', moveSpeed: 5.4 },
  smg: { id: 'smg', name: 'Hornet-9', price: 1500, damage: 19, headMult: 2.5, mag: 32, reserve: 96, gap: 0.075, auto: true, reload: 2.0, spreadStill: 0.006, spreadMove: 0.03, range: 35, kick: 0.005, pellets: 1, kind: 'smg', moveSpeed: 5.3 },
  rifle: { id: 'rifle', name: 'VK-7 Carbine', price: 2700, damage: 33, headMult: 2.5, mag: 30, reserve: 90, gap: 0.1, auto: true, reload: 2.2, spreadStill: 0.0035, spreadMove: 0.028, range: 60, kick: 0.009, pellets: 1, kind: 'rifle', moveSpeed: 5.2 },
  shotgun: { id: 'shotgun', name: 'Breacher-12', price: 1700, damage: 11, headMult: 2.0, mag: 6, reserve: 24, gap: 0.85, auto: false, reload: 2.8, spreadStill: 0.02, spreadMove: 0.05, range: 18, kick: 0.02, pellets: 8, kind: 'shotgun', moveSpeed: 5.1 },
  sniper: { id: 'sniper', name: 'Longshot-8', price: 4750, damage: 95, headMult: 2.5, mag: 5, reserve: 15, gap: 1.25, auto: false, reload: 3.2, spreadStill: 0.001, spreadMove: 0.04, range: 100, kick: 0.03, pellets: 1, kind: 'sniper', moveSpeed: 5.0, zoom: true },
};

export const BUY_MENU = [
  { id: 'smg', key: '1', label: 'Hornet-9 SMG', price: 1500 },
  { id: 'rifle', key: '2', label: 'VK-7 Carbine', price: 2700 },
  { id: 'shotgun', key: '3', label: 'Breacher-12', price: 1700 },
  { id: 'sniper', key: '4', label: 'Longshot-8', price: 4750 },
  { id: 'armor', key: '5', label: 'Vest (armor 100)', price: 650 },
  { id: 'grenade', key: '6', label: 'Frag-9 grenade', price: 300 },
];

const MUZZLE_TIME = 0.06;

function buildModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.3 });
  const model = new THREE.Group();
  let muzzleZ = -0.6;
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (def.kind === 'pistol') {
    part(0.07, 0.09, 0.24, 0, 0, -0.1, body);
    part(0.05, 0.04, 0.16, 0, 0.02, -0.28, grip);
    part(0.06, 0.12, 0.08, 0, -0.08, 0.04, grip);
    muzzleZ = -0.38;
  } else if (def.kind === 'smg') {
    part(0.08, 0.1, 0.34, 0, 0, -0.08, body);
    part(0.04, 0.04, 0.3, 0, 0.03, -0.36, grip);
    part(0.05, 0.16, 0.06, 0, -0.1, -0.02, grip);
    part(0.06, 0.08, 0.16, 0, -0.02, 0.24, grip);
    muzzleZ = -0.52;
  } else if (def.kind === 'rifle') {
    part(0.09, 0.1, 0.42, 0, 0, -0.1, body);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.48, grip);
    part(0.06, 0.07, 0.3, 0, -0.01, -0.32, dark);
    part(0.05, 0.18, 0.07, 0, -0.11, 0.0, grip);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip);
    muzzleZ = -0.7;
  } else if (def.kind === 'shotgun') {
    part(0.1, 0.11, 0.5, 0, 0, -0.12, body);
    part(0.07, 0.07, 0.44, 0, -0.06, -0.3, dark);
    part(0.08, 0.06, 0.2, 0, -0.05, -0.42, grip);
    part(0.07, 0.09, 0.2, 0, -0.02, 0.28, grip);
    muzzleZ = -0.62;
  } else {
    part(0.07, 0.09, 0.55, 0, 0, -0.16, body);
    part(0.035, 0.035, 0.5, 0, 0.03, -0.62, grip);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, -0.1);
    model.add(scope);
    part(0.05, 0.16, 0.06, 0, -0.1, -0.02, grip);
    part(0.07, 0.08, 0.24, 0, -0.02, 0.32, grip);
    muzzleZ = -0.9;
  }
  model.position.set(0.24, -0.2, -0.42);
  return { model, muzzleZ };
}

export function createWeaponRig(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) models[def.id] = buildModel(def);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  camera.add(flashLight);

  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  let current = 'pistol';
  let cooldown = 0;
  let reloadLeft = 0;
  let flashLeft = 0;
  let kick = 0;
  let bobPhase = 0;
  let bobAmount = 0;

  function showModel() {
    for (const [id, entry] of Object.entries(models)) {
      if (id === current) {
        if (!entry.model.parent) camera.add(entry.model);
      } else if (entry.model.parent) {
        camera.remove(entry.model);
      }
    }
    const entry = models[current];
    flash.position.set(0.24, -0.18, -0.42 + entry.muzzleZ - 0.25);
    flashLight.position.set(0.24, -0.16, -0.42 + entry.muzzleZ - 0.1);
  }
  showModel();

  return {
    get current() { return current; },
    def() { return WEAPONS[current]; },
    ammo() { return { mag: ammo[current].mag, reserve: ammo[current].reserve, id: current }; },
    equip(id) {
      if (!WEAPONS[id] || id === current) return;
      current = id;
      cooldown = Math.max(cooldown, 0.25);
      reloadLeft = 0;
      kick = 0;
      showModel();
    },
    setAmmo(id, mag, reserve) {
      ammo[id] = { mag, reserve };
    },
    refill(id) {
      const def = WEAPONS[id];
      ammo[id] = { mag: def.mag, reserve: def.reserve };
    },
    step(dt, moveSpeed) {
      cooldown = Math.max(0, cooldown - dt);
      flashLeft = Math.max(0, flashLeft - dt);
      kick += (0 - kick) * Math.min(1, dt * 14);
      bobPhase += dt * moveSpeed * 1.6;
      bobAmount += ((moveSpeed > 0.5 ? 0.012 : 0) - bobAmount) * Math.min(1, dt * 8);
      const entry = models[current];
      const def = WEAPONS[current];
      entry.model.position.z = -0.42 + kick;
      entry.model.position.y = -0.2 + Math.sin(bobPhase * 2) * bobAmount;
      entry.model.position.x = 0.24 + Math.cos(bobPhase) * bobAmount * 0.6;
      entry.model.rotation.x = kick * 2.2;
      flash.visible = flashLeft > 0;
      flash.rotation.z = flashLeft * 30;
      flashLight.intensity = flashLeft > 0 ? 18 : 0;
      if (reloadLeft > 0) {
        reloadLeft = Math.max(0, reloadLeft - dt);
        entry.model.rotation.x = -0.55 * Math.min(1, (def.reload - reloadLeft) * 2);
        if (reloadLeft === 0) {
          const need = def.mag - ammo[current].mag;
          const take = Math.min(need, ammo[current].reserve);
          ammo[current].mag += take;
          ammo[current].reserve -= take;
        }
      }
    },
    ready() {
      return ammo[current].mag > 0 && cooldown === 0 && reloadLeft === 0;
    },
    pullTrigger() {
      cooldown = WEAPONS[current].gap;
      flashLeft = MUZZLE_TIME;
      kick = 0.055;
    },
    takeRound() {
      if (ammo[current].mag <= 0) return false;
      ammo[current].mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[current];
      if (reloadLeft > 0 || ammo[current].mag === def.mag || ammo[current].reserve === 0) return false;
      reloadLeft = def.reload;
      return true;
    },
    reloading() { return reloadLeft > 0; },
    spread(speed, crouched, airborne) {
      const def = WEAPONS[current];
      let spread = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
      if (crouched) spread *= 0.7;
      if (airborne) spread *= 2.2;
      return spread;
    },
    muzzleWorld(out) {
      const entry = models[current];
      out.set(0.24, -0.18, -0.42 + entry.muzzleZ);
      return camera.localToWorld(out);
    },
  };
}
