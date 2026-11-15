// The bots: five attackers (Ember) against five defenders (Vanguard), the
// player fighting on Ember's side. A bot walks the map's waypoint graph,
// sees with a line of sight and a field of view, hears gunfire, holds
// angles, pushes a site, plants the charge or defuses it, and shoots back
// in bursts with a reaction time and an aim error that grows with distance
// and movement. One mover, one weapon table and one combat resolver serve
// the player and the bots alike.
import * as THREE from 'three';
import { createMover } from './mover.js';
import { WEAPONS } from './weapons.js';
import { findPath, nearestNode } from './map.js';
import { range, pick } from './rng.js';

const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Soot', 'Blaze'];
const VANGUARD_NAMES = ['Heron', 'Wren', 'Falcon', 'Osprey', 'Ibis'];
const HOLD_SPOTS = { A: ['HA1', 'HA2', 'HCT'], B: ['HB1', 'HB2', 'HCT2'] };
const SITE_NODES = { A: 'A0', B: 'B0' };
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5.0;

export function createBots({ scene, map, combat, fx, audio, rng, hooks }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const tmpDir = new THREE.Vector3();
  const tmpTo = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  const teamMaterials = {
    ember: new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.6, metalness: 0.1 }),
    vanguard: new THREE.MeshStandardMaterial({ color: 0x2fb3a3, roughness: 0.6, metalness: 0.1 }),
  };
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.7, metalness: 0.2 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.8 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.62, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 12, 10);
  const legGeometry = new THREE.BoxGeometry(0.16, 0.72, 0.16);
  const armGeometry = new THREE.BoxGeometry(0.1, 0.5, 0.1);
  const gunGeometry = new THREE.BoxGeometry(0.06, 0.09, 0.62);

  function buildMesh(team) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, teamMaterials[team]);
    torso.position.y = 1.06;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, skinMaterial);
    head.position.y = 1.55;
    head.userData.part = 'head';
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.34), teamMaterials[team]);
    cap.position.y = 1.66;
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.13, 0.36, 0);
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.13, 0.36, 0);
    const armL = new THREE.Mesh(armGeometry, darkMaterial);
    armL.position.set(-0.24, 1.1, 0.14);
    armL.rotation.x = -1.1;
    const armR = new THREE.Mesh(armGeometry, darkMaterial);
    armR.position.set(0.24, 1.1, 0.14);
    armR.rotation.x = -1.1;
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.1, 1.22, -0.28);
    group.add(torso, head, cap, legL, legR, armL, armR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
      }
    });
    return { group, torso, head, legL, legR, gun };
  }

  const bots = [];

  function makeBot(team, index, name) {
    const mesh = buildMesh(team);
    scene.add(mesh.group);
    const mover = createMover(map.colliders, 0, 18, 0);
    const bot = {
      id: `${team}-${index}`,
      team,
      name,
      index,
      mesh,
      mover,
      alive: true,
      hp: 100,
      armor: 0,
      weaponId: 'pistol',
      mag: 12,
      cooldown: 0,
      reloadLeft: 0,
      burstLeft: 0,
      burstPause: 0,
      skill: range(rng, 0.55, 1.0),
      reaction: range(rng, 0.24, 0.46),
      role: 'push',
      site: 'A',
      route: [],
      routeIndex: 0,
      goalNode: null,
      target: null,
      firstSeenAt: 0,
      lastSeen: null,
      lastSeenAt: -10,
      thinkAt: rng() * 0.12,
      walkPhase: rng() * 6,
      channel: null, // { kind: 'plant'|'defuse', progress }
      isCarrier: false,
      speed: 5.0,
    };
    bot.fighter = {
      id: bot.id,
      team,
      isPlayer: false,
      get alive() { return bot.alive; },
      set alive(value) { bot.alive = value; },
      get hp() { return bot.hp; },
      set hp(value) { bot.hp = value; },
      get armor() { return bot.armor; },
      set armor(value) { bot.armor = value; },
      pos: mover.state.position,
      get eye() { return mover.state.eye; },
      hitMeshes: [mesh.torso, mesh.head],
      onDamage(amount, part, attacker, killed) {
        if (bot.target !== attacker) {
          bot.target = attacker;
          bot.firstSeenAt = performance.now() / 1000;
          bot.lastSeen = { x: attacker.pos.x, y: attacker.pos.y + 1.2, z: attacker.pos.z };
          bot.lastSeenAt = performance.now() / 1000;
        }
      },
      onDeath(attacker) {
        bot.alive = false;
        bot.channel = null;
        hooks.onKill(attacker ? attacker.id : null, bot.id);
        if (bot.isCarrier) {
          bot.isCarrier = false;
          hooks.onCarrierDown(bot);
        }
      },
    };
    mesh.torso.userData.fighter = bot.fighter;
    mesh.head.userData.fighter = bot.fighter;
    combat.registerFighter(bot.fighter);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 5; i += 1) makeBot('ember', i, EMBER_NAMES[i]);
  for (let i = 0; i < 5; i += 1) makeBot('vanguard', i, VANGUARD_NAMES[i]);

  function visibleEnemy(bot, now, enemies) {
    let best = null;
    let bestDistance = Infinity;
    tmpEye.set(bot.mover.state.position.x, bot.mover.state.position.y + bot.mover.state.eye, bot.mover.state.position.z);
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.pos.x - tmpEye.x;
      const dy = (enemy.pos.y + 1.2) - tmpEye.y;
      const dz = enemy.pos.z - tmpEye.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > 48 || distance > bestDistance) continue;
      tmpDir.set(dx / distance, dy / distance, dz / distance);
      const facing = Math.atan2(-tmpDir.x, -tmpDir.z);
      let angle = facing - bot.mover.state.yaw;
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      if (Math.abs(angle) > 1.05) continue;
      raycaster.set(tmpEye, tmpDir);
      raycaster.far = distance;
      if (raycaster.intersectObjects(map.shootables, false).length > 0) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best ? { enemy: best, distance: bestDistance } : null;
  }

  function setGoal(bot, nodeName) {
    if (bot.goalNode === nodeName) return;
    bot.goalNode = nodeName;
    const from = nearestNode(map.nodes, bot.mover.state.position.x, bot.mover.state.position.z);
    bot.route = findPath(map.nodes, from, nodeName);
    bot.routeIndex = 0;
  }

  function followRoute(bot, dt) {
    if (bot.routeIndex >= bot.route.length) return { forward: 0, strafe: 0, arrived: true };
    const node = map.nodes.get(bot.route[bot.routeIndex]);
    const dx = node.x - bot.mover.state.position.x;
    const dz = node.z - bot.mover.state.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.9) {
      bot.routeIndex += 1;
      return followRoute(bot, dt);
    }
    const desired = Math.atan2(-dx, -dz);
    let diff = desired - bot.mover.state.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.mover.state.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
    const forward = Math.cos(diff);
    const strafe = Math.sin(diff) * 0.4;
    return { forward: Math.max(0, forward), strafe, arrived: false };
  }

  function chooseWeapon(bot, money) {
    if (money >= 2700) return 'rifle';
    if (money >= 1500) return 'smg';
    return 'pistol';
  }

  function spawnRound(round, emberMoney, vanguardMoney) {
    const emberSite = rng() < 0.5 ? 'A' : 'B';
    for (const bot of bots) {
      const spawns = map.spawns[bot.team];
      const [x, z] = spawns[bot.index];
      const yaw = bot.team === 'ember' ? Math.PI : 0;
      bot.mover.reset(x, z, yaw);
      bot.alive = true;
      bot.hp = 100;
      bot.armor = bot.team === 'vanguard' && round > 1 ? 50 : 0;
      const money = bot.team === 'ember' ? emberMoney : vanguardMoney;
      bot.weaponId = chooseWeapon(bot, money);
      const def = WEAPONS[bot.weaponId];
      bot.mag = def.mag;
      bot.cooldown = 0;
      bot.reloadLeft = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.target = null;
      bot.lastSeen = null;
      bot.channel = null;
      bot.isCarrier = false;
      bot.mesh.group.rotation.set(0, 0, 0);
      bot.mesh.group.position.set(x, 0, z);
      bot.mesh.group.visible = true;
      if (bot.team === 'ember') {
        bot.site = emberSite;
        bot.role = bot.index === 0 ? 'carrier' : 'push';
      } else {
        bot.site = pick(rng, ['A', 'B']);
        bot.role = 'hold';
        bot.goalNode = null;
        setGoal(bot, pick(rng, HOLD_SPOTS[bot.site]));
      }
    }
    const carrier = bots.find((b) => b.team === 'ember' && b.role === 'carrier');
    if (carrier) carrier.isCarrier = true;
  }

  function botShoot(bot, now, dt, playerPos) {
    const def = WEAPONS[bot.weaponId];
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    if (bot.reloadLeft > 0) {
      bot.reloadLeft -= dt;
      if (bot.reloadLeft <= 0) {
        bot.mag = def.mag;
        bot.reloadLeft = 0;
      }
      return;
    }
    if (bot.mag <= 0) {
      bot.reloadLeft = def.reload;
      return;
    }
    if (!bot.target || !bot.target.alive) return;
    if (now - bot.firstSeenAt < bot.reaction) return;
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(rng() * 3);
      bot.burstPause = 0;
    }
    if (bot.cooldown > 0) return;
    bot.cooldown = def.gap;
    bot.burstLeft -= 1;
    if (bot.burstLeft === 0) bot.burstPause = range(rng, 0.45, 0.9);
    tmpEye.set(bot.mover.state.position.x, bot.mover.state.position.y + bot.mover.state.eye, bot.mover.state.position.z);
    tmpTarget.set(bot.target.pos.x, bot.target.pos.y + 1.25, bot.target.pos.z);
    tmpDir.subVectors(tmpTarget, tmpEye).normalize();
    const distance = tmpEye.distanceTo(tmpTarget);
    const targetSpeed = bot.target.isPlayer ? 0 : 2;
    const error = (0.012 + distance * 0.0011 + targetSpeed * 0.004) * (2 - bot.skill) * (bot.mover.groundSpeed() > 1 ? 1.6 : 1);
    const spread = def.spreadStill + error;
    const hit = combat.rayShoot({
      origin: tmpEye,
      direction: tmpDir,
      shooter: bot.fighter,
      weapon: def,
      spread,
      rng,
    });
    tmpEye.addScaledVector(tmpDir, 0.6);
    fx.flashAt(tmpEye, { position: playerPos });
    audio.shot(def.kind, tmpEye.distanceTo(playerPos));
    if (hooks.onShotFired) hooks.onShotFired(bot, tmpEye);
  }

  function stepBot(bot, dt, now, ctx) {
    if (!bot.alive) {
      // Fallen bodies stay where they fell.
      bot.mesh.group.rotation.x += ((-Math.PI / 2) - bot.mesh.group.rotation.x) * Math.min(1, dt * 8);
      return;
    }
    const def = WEAPONS[bot.weaponId];
    const enemies = ctx.fighters.filter((f) => f.team !== bot.team && f.alive);
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = 0.12;
      const seen = visibleEnemy(bot, now, enemies);
      if (seen) {
        if (bot.target !== seen.enemy) bot.firstSeenAt = now;
        bot.target = seen.enemy;
        bot.lastSeen = { x: seen.enemy.pos.x, y: seen.enemy.pos.y + 1.2, z: seen.enemy.pos.z };
        bot.lastSeenAt = now;
      } else if (bot.target && now - bot.lastSeenAt > 2.5) {
        bot.target = null;
      }
      // Role decisions.
      if (ctx.phase === 'live') {
        if (bot.team === 'ember') {
          if (ctx.bomb.state === 'planted') {
            setGoal(bot, pick(rng, HOLD_SPOTS[ctx.bomb.site]));
            bot.role = 'postplant';
          } else if (bot.isCarrier) {
            const site = map.sites[bot.site];
            const inZone = bot.mover.state.position.x > site.rect.x0 && bot.mover.state.position.x < site.rect.x1
              && bot.mover.state.position.z > site.rect.z0 && bot.mover.state.position.z < site.rect.z1;
            if (inZone && !bot.target) {
              bot.channel = bot.channel ?? { kind: 'plant', progress: 0 };
            } else {
              bot.channel = null;
              setGoal(bot, SITE_NODES[bot.site]);
            }
          } else if (ctx.bomb.carrierId === 'player') {
            setGoal(bot, SITE_NODES[bot.site]);
          } else {
            const carrier = bots.find((b) => b.isCarrier && b.alive);
            if (carrier) setGoal(bot, nearestNode(map.nodes, carrier.mover.state.position.x, carrier.mover.state.position.z));
          }
        } else if (ctx.bomb.state === 'planted') {
          bot.role = 'retake';
          setGoal(bot, SITE_NODES[ctx.bomb.site]);
        } else if (bot.role === 'hold' && bot.goalNode === null) {
          setGoal(bot, pick(rng, HOLD_SPOTS[bot.site]));
        }
      }
      // Investigate a shot heard nearby when nothing is in sight.
      if (!bot.target && bot.lastSeen && now - bot.lastSeenAt < 3 && bot.role !== 'carrier' && !bot.channel && ctx.phase === 'live') {
        const node = nearestNode(map.nodes, bot.lastSeen.x, bot.lastSeen.z);
        if (node !== bot.goalNode) setGoal(bot, node);
      }
    }

    // Channels: planting and defusing.
    let move = { forward: 0, strafe: 0, jump: false, crouch: false, slow: false };
    if (bot.channel) {
      const inDanger = bot.target && bot.target.alive;
      if (bot.channel.kind === 'plant' && inDanger) {
        bot.channel = null;
      } else {
        bot.channel.progress += dt;
        const needed = bot.channel.kind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
        if (bot.channel.progress >= needed) {
          if (bot.channel.kind === 'plant') hooks.onPlant(bot.site, bot);
          else hooks.onDefuse(bot);
          bot.channel = null;
        }
      }
    }
    if (bot.team === 'vanguard' && ctx.bomb.state === 'planted' && !bot.channel) {
      const dx = ctx.bomb.position.x - bot.mover.state.position.x;
      const dz = ctx.bomb.position.z - bot.mover.state.position.z;
      if (Math.hypot(dx, dz) < 1.6 && !bot.target) {
        bot.channel = { kind: 'defuse', progress: 0 };
      }
    }

    if (!bot.channel) {
      if (bot.target && bot.target.alive && now - bot.firstSeenAt >= bot.reaction) {
        // Face the target and strafe while firing.
        tmpTarget.set(bot.target.pos.x, bot.target.pos.y + 1.25, bot.target.pos.z);
        tmpDir.subVectors(tmpTarget, bot.mover.state.position);
        const desired = Math.atan2(-tmpDir.x, -tmpDir.z);
        let diff = desired - bot.mover.state.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.mover.state.yaw += Math.max(-7 * dt, Math.min(7 * dt, diff));
        bot.mover.state.pitch = Math.max(-1.2, Math.min(1.2, Math.asin(Math.max(-1, Math.min(1, tmpDir.y / (tmpDir.length() || 1))))));
        const strafeDir = Math.sin(now * 1.3 + bot.index * 2.1) > 0 ? 1 : -1;
        const distance = Math.hypot(tmpDir.x, tmpDir.z);
        move = {
          forward: distance > 14 ? 0.7 : distance < 6 ? -0.5 : 0,
          strafe: strafeDir * 0.6,
          jump: false,
          crouch: range(rng, 0, 1) < 0.002,
          slow: true,
        };
      } else if (ctx.phase === 'live') {
        const result = followRoute(bot, dt);
        move = { forward: result.forward, strafe: result.strafe, jump: false, crouch: bot.role === 'hold' && !bot.target, slow: false };
      }
    }

    bot.mover.step(dt, move, bot.speed * (def.moveSpeed / 5.2));
    if (ctx.phase === 'live') botShoot(bot, now, dt, ctx.playerPos);

    // Sync the mesh with the body.
    const body = bot.mover.state;
    bot.mesh.group.position.set(body.position.x, body.position.y, body.position.z);
    bot.mesh.group.rotation.y = body.yaw;
    const speed = bot.mover.groundSpeed();
    bot.walkPhase += dt * speed * 1.8;
    const swing = Math.min(1, speed / 5) * 0.5;
    bot.mesh.legL.rotation.x = Math.sin(bot.walkPhase) * swing;
    bot.mesh.legR.rotation.x = -Math.sin(bot.walkPhase) * swing;
    bot.mesh.group.position.y = body.position.y + (speed > 0.5 ? Math.abs(Math.sin(bot.walkPhase)) * 0.03 : 0);
  }

  function step(dt, now, ctx) {
    for (const bot of bots) stepBot(bot, dt, now, ctx);
  }

  return {
    bots,
    step,
    spawnRound,
    getCarrier() {
      return bots.find((b) => b.isCarrier && b.alive) ?? null;
    },
    setCarrier(bot) {
      for (const b of bots) b.isCarrier = false;
      if (bot) bot.isCarrier = true;
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    fighters() {
      return bots.map((b) => b.fighter);
    },
  };
}
