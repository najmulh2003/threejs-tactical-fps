// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|play|plant|end with &seed=N sets up a
// deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady. Any script error is recorded on
// window.__shotError for the capture driver.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createMover } from './mover.js';
import { createWeaponRig, WEAPONS, BUY_MENU } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed);

window.addEventListener('error', (event) => {
  window.__shotError = String(event.message || event.error || 'unknown error');
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const map = createMap(scene);
const fx = createFx(scene);
const audio = createAudio();
const hud = createHud();
const combat = createCombat({ scene, map, fx, audio });

const playerMover = createMover(map.colliders, 0, 18, Math.PI);
const rig = createWeaponRig(camera);

const player = {
  mover: playerMover,
  rig,
  hasCharge: true,
  armorKept: false,
};
player.fighter = {
  id: 'player',
  team: 'ember',
  isPlayer: true,
  alive: true,
  hp: 100,
  armor: 0,
  pos: playerMover.state.position,
  get eye() { return playerMover.state.eye; },
  hitMeshes: [],
  onDamage(amount, part, attacker, killed) {
    audio.hurt();
    if (attacker) {
      const dx = attacker.pos.x - playerMover.state.position.x;
      const dz = attacker.pos.z - playerMover.state.position.z;
      const angle = Math.atan2(dx, dz) - playerMover.state.yaw;
      hud.damageFrom((angle * 180) / Math.PI);
    }
  },
  onDeath(attacker) {
    match.onKill(attacker ? attacker.id : null, 'player');
    hud.banner('YOU ARE DOWN', 'Your team fights on — you return next round');
    if (document.pointerLockElement) document.exitPointerLock();
  },
};
combat.registerFighter(player.fighter);

let match = null;
const bots = createBots({
  scene,
  map,
  combat,
  fx,
  audio,
  rng,
  hooks: {
    onKill(killerId, victimId) { match.onKill(killerId, victimId); },
    onPlant(site, bot) { match.onPlant(site, bot); },
    onDefuse(bot) { match.onDefuse(bot); },
    onCarrierDown(bot) { match.onCarrierDown(bot); },
    onShotFired(shooter, position) {
      // Nearby enemies of the shooter hear the shot and investigate.
      const now = elapsed;
      for (const bot of bots.bots) {
        if (!bot.alive || bot.team === shooter.team || bot.target) continue;
        const dx = bot.mover.state.position.x - position.x;
        const dz = bot.mover.state.position.z - position.z;
        if (dx * dx + dz * dz < 28 * 28) {
          bot.lastSeen = { x: position.x, y: position.y + 1.2, z: position.z };
          bot.lastSeenAt = now;
        }
      }
    },
  },
});
match = createMatch({ scene, map, bots, combat, fx, audio, hud, rng });
match.setPlayer(player);

const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let fovTarget = 74;

function syncCamera() {
  const body = playerMover.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (Math.abs(camera.fov - fovTarget) > 0.1) {
    camera.fov += (fovTarget - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (match.state.phase === 'live' && player.fighter.alive) {
    hud.showOverlay('paused');
  } else if (match.state.phase === 'menu') {
    hud.showOverlay('start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'menu' || match.state.phase === 'matchEnd') {
    match.startMatch();
    hud.setBuyItems(match.buyMenu, match.state.owned, match.state.money);
  }
  input.requestLock();
});

function shoot() {
  const def = rig.def();
  if (!rig.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(direction);
  const spread = rig.spread(playerMover.groundSpeed(), playerMover.state.crouching, !playerMover.state.onGround);
  const hit = combat.rayShoot({
    origin: camera.position,
    direction,
    shooter: player.fighter,
    weapon: def,
    spread,
    rng,
  });
  rig.pullTrigger();
  playerMover.recoil(def.kick + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  audio.shot(def.kind, 0);
  if (hit && hit.hit) {
    hud.hitMarker(hit.killed, shot ? 4000 : 90);
    audio.hit(hit.killed);
  }
  const ammo = rig.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, def.name);
  // The player's own shot is heard by nearby enemies.
  for (const bot of bots.bots) {
    if (!bot.alive || bot.team === 'ember' || bot.target) continue;
    const dx = bot.mover.state.position.x - camera.position.x;
    const dz = bot.mover.state.position.z - camera.position.z;
    if (dx * dx + dz * dz < 28 * 28) {
      bot.lastSeen = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      bot.lastSeenAt = elapsed;
    }
  }
}

function handleKey(code) {
  const phase = match.state.phase;
  if (phase === 'freeze') {
    const item = BUY_MENU.find((entry) => `Digit${entry.key}` === code);
    if (item) {
      if (match.buy(item.id)) hud.setBuyItems(match.buyMenu, match.state.owned, match.state.money);
      return;
    }
    if (code === 'KeyB') hud.showBuy(document.getElementById('buy-menu').hidden);
    return;
  }
  if (phase !== 'live' || !player.fighter.alive) return;
  if (code === 'KeyR') {
    if (rig.reload()) audio.reload();
  } else if (code === 'KeyG') {
    if (match.state.grenades > 0) {
      match.state.grenades -= 1;
      camera.getWorldDirection(direction);
      tmpVec.copy(camera.position).addScaledVector(direction, 0.5);
      combat.throwGrenade({ position: tmpVec, direction, owner: player.fighter });
      hud.update(match.state, player);
    }
  } else if (code === 'Digit1') {
    const primary = [...match.state.owned].find((id) => id !== 'pistol');
    if (primary) rig.equip(primary);
  } else if (code === 'Digit2') {
    rig.equip('pistol');
  } else if (code === 'WheelDown' || code === 'WheelUp') {
    const owned = [...match.state.owned];
    if (owned.length < 2) return;
    const at = owned.indexOf(rig.current);
    const next = owned[(at + (code === 'WheelDown' ? 1 : owned.length - 1)) % owned.length];
    rig.equip(next);
  }
}

function botContext() {
  return {
    phase: match.state.phase,
    bomb: match.state.bomb,
    fighters: [player.fighter, ...bots.fighters()],
    playerPos: playerMover.state.position,
  };
}

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;
  if (player.fighter.alive && (match.state.phase === 'live' || match.state.phase === 'freeze')) {
    playerMover.step(dt, {
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      jump: keys.has('Space'),
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
      slow: input.state.zooming,
      fast: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    }, rig.def().moveSpeed);
  }
  rig.step(dt, playerMover.groundSpeed());
  match.step(dt, input.state);
  bots.step(dt, elapsed, botContext());
  combat.stepGrenades(dt, playerMover.state.position);
  fx.step(dt);
  fovTarget = rig.def().zoom && input.state.zooming ? 32 : 74;
  hud.setCrosshairGap(5 + rig.spread(playerMover.groundSpeed(), playerMover.state.crouching, !playerMover.state.onGround) * 900);
  hud.update(match.state, player);
  hud.setPlantProgress(match.state.plantProgress > 0 ? match.state.plantProgress / 3.2 : null);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    playerMover.look(look.x, look.y);
    if (input.state.firing && rig.ready() && player.fighter.alive && match.state.phase === 'live') shoot();
    for (const code of input.takePressed()) handleKey(code);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = playerMover.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function nearestEnemy() {
  let best = null;
  let bestDistance = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'vanguard' || !bot.alive) continue;
    const d = Math.hypot(bot.mover.state.position.x - playerMover.state.position.x, bot.mover.state.position.z - playerMover.state.position.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = bot;
    }
  }
  return best;
}

function autoFight(steps) {
  for (let i = 0; i < steps; i += 1) {
    const enemy = nearestEnemy();
    if (enemy) {
      tmpVec.set(enemy.mover.state.position.x, enemy.mover.state.position.y + 1.2, enemy.mover.state.position.z);
      aimAt(tmpVec);
      if (rig.ready() && i % 6 < 3) shoot();
    }
    step(FIXED_STEP);
  }
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  match.startMatch();
  hud.setBuyItems(match.buyMenu, match.state.owned, match.state.money);
  if (name === 'start') {
    playerMover.reset(0, 16.5, Math.PI);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.5, -8));
    hud.showBuy(false);
    hud.showOverlay('start');
    hud.update(match.state, player);
    paintTwiceThenReady();
    return;
  }
  match.state.phase = 'live';
  match.state.freezeLeft = 0;
  hud.showBuy(false);
  player.fighter.hp = 100000; // staged captures only: the camera survives the fight
  player.rig.refill('rifle');
  player.rig.equip('rifle');
  match.state.owned.add('rifle');
  if (name === 'play') {
    match.state.timeLeft = 88;
    playerMover.reset(0, 9, Math.PI);
    autoFight(60 * 7);
    player.fighter.hp = 100;
    player.rig.refill('rifle');
    const enemy = nearestEnemy();
    if (enemy && player.fighter.alive) {
      tmpVec.set(enemy.mover.state.position.x, enemy.mover.state.position.y + 1.2, enemy.mover.state.position.z);
      aimAt(tmpVec);
      if (rig.ready()) shoot();
    }
    hud.update(match.state, player);
    paintTwiceThenReady();
    return;
  }
  if (name === 'plant') {
    match.state.timeLeft = 74;
    match.debugPlant('A', -30, -11);
    playerMover.reset(-30, -4, Math.PI * 0.75);
    settle(30);
    autoFight(60 * 4);
    settle(40); // let muzzle flashes, tracers and sparks die before the capture
    player.fighter.hp = 100;
    player.rig.refill('rifle');
    aimAt(new THREE.Vector3(-30, 0.8, -11));
    document.getElementById('banner').classList.remove('show');
    hud.update(match.state, player);
    paintTwiceThenReady();
    return;
  }
  // end: a round won at site B, one defender down in the open.
  match.state.timeLeft = 61;
  playerMover.reset(18, -4, Math.PI * 0.8);
  settle(20);
  const defender = bots.bots.find((b) => b.team === 'vanguard' && b.alive);
  if (defender) {
    defender.mover.reset(24, -10, 0);
    combat.applyDamage(defender.fighter, 500, 'torso', player.fighter);
  }
  match.state.phase = 'live';
  match.endRoundForShot();
  player.fighter.hp = 100;
  aimAt(new THREE.Vector3(24, 1.2, -12));
  hud.update(match.state, player);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.update(match.state, player);
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
