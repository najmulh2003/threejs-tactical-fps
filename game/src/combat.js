// Combat resolution, used by the player and the bots alike: hitscan shots
// against bodies (head shots pay more), damage falloff with range, armor
// that absorbs half, and a thrown grenade with a bounce, a fuse and a blast
// that walls blunt. One raycaster is reused for every test; nothing here
// allocates in the hot loop.
import * as THREE from 'three';

const GRENADE_RADIUS = 7.5;
const GRENADE_MAX_DAMAGE = 110;
const GRENADE_FUSE = 2.4;
const GRENADE_FUSE_AFTER_BOUNCE = 1.4;
const GRAVITY = 20;

export function createCombat({ scene, map, fx, audio }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const fighters = [];
  const grenades = [];
  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.5, metalness: 0.6 });
  const tmpOrigin = new THREE.Vector3();
  const tmpDirection = new THREE.Vector3();
  const tmpPoint = new THREE.Vector3();
  const tmpChest = new THREE.Vector3();

  function registerFighter(fighter) {
    fighters.push(fighter);
  }

  // Manual ray vs sphere test for the player, whose body is not a mesh.
  function rayHitsPlayer(origin, dir, maxDist, fighter) {
    const eye = fighter.pos.y + fighter.eye;
    const spheres = [
      { x: fighter.pos.x, y: eye + 0.12, z: fighter.pos.z, r: 0.19, part: 'head' },
      { x: fighter.pos.x, y: fighter.pos.y + 1.02, z: fighter.pos.z, r: 0.46, part: 'torso' },
    ];
    let best = null;
    for (const sphere of spheres) {
      tmpPoint.set(sphere.x - origin.x, sphere.y - origin.y, sphere.z - origin.z);
      const tca = tmpPoint.dot(dir);
      if (tca < 0 || tca > maxDist) continue;
      const d2 = tmpPoint.lengthSq() - tca * tca;
      if (d2 > sphere.r * sphere.r) continue;
      const t = tca - Math.sqrt(sphere.r * sphere.r - d2);
      if (t < 0) continue;
      if (!best || t < best.distance) best = { distance: t, part: sphere.part };
    }
    return best;
  }

  function losBlocked(from, to) {
    tmpDirection.subVectors(to, from);
    const distance = tmpDirection.length();
    if (distance < 0.01) return false;
    tmpDirection.multiplyScalar(1 / distance);
    raycaster.set(from, tmpDirection);
    raycaster.far = distance - 0.05;
    return raycaster.intersectObjects(map.shootables, false).length > 0;
  }

  function applyDamage(fighter, amount, part, attacker) {
    if (!fighter.alive) return { killed: false, damage: 0 };
    let remaining = amount;
    if (fighter.armor > 0) {
      const absorbed = Math.min(fighter.armor, remaining * 0.5);
      fighter.armor -= absorbed;
      remaining -= absorbed;
    }
    fighter.hp -= remaining;
    const killed = fighter.hp <= 0;
    if (killed) {
      fighter.hp = 0;
      fighter.alive = false;
    }
    fighter.onDamage(amount, part, attacker, killed);
    if (killed) fighter.onDeath(attacker);
    return { killed, damage: amount };
  }

  // One hitscan shot. Returns the hit (or null) with its kill flag.
  function rayShoot({ origin, direction, shooter, weapon, spread, rng }) {
    let bestHit = null;
    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      tmpDirection.copy(direction);
      tmpDirection.x += (rng() * 2 - 1) * spread;
      tmpDirection.y += (rng() * 2 - 1) * spread;
      tmpDirection.z += (rng() * 2 - 1) * spread;
      tmpDirection.normalize();
      raycaster.set(origin, tmpDirection);
      raycaster.far = weapon.range * 1.6;
      const mapHits = raycaster.intersectObjects(map.shootables, false);
      const mapDistance = mapHits.length > 0 ? mapHits[0].distance : Infinity;
      let fighterHit = null;
      for (const fighter of fighters) {
        if (fighter === shooter || !fighter.alive || fighter.team === shooter.team) continue;
        if (fighter.isPlayer) {
          const hit = rayHitsPlayer(origin, tmpDirection, Math.min(mapDistance, weapon.range * 1.6), fighter);
          if (hit && (!fighterHit || hit.distance < fighterHit.distance)) {
            fighterHit = { fighter, distance: hit.distance, part: hit.part };
          }
        } else {
          raycaster.far = Math.min(mapDistance, weapon.range * 1.6);
          const hits = raycaster.intersectObjects(fighter.hitMeshes, false);
          if (hits.length > 0 && (!fighterHit || hits[0].distance < fighterHit.distance)) {
            fighterHit = { fighter, distance: hits[0].distance, part: hits[0].object.userData.part || 'torso' };
          }
        }
      }
      const endDistance = fighterHit ? fighterHit.distance : mapDistance;
      tmpPoint.copy(origin).addScaledVector(tmpDirection, Math.min(endDistance, weapon.range * 1.6));
      fx.tracer(origin, tmpPoint);
      if (fighterHit && fighterHit.distance < mapDistance) {
        const falloff = fighterHit.distance < weapon.range * 0.5 ? 1 : Math.max(0.4, 1 - (fighterHit.distance - weapon.range * 0.5) / weapon.range);
        const damage = weapon.damage * falloff * (fighterHit.part === 'head' ? weapon.headMult : 1);
        const result = applyDamage(fighterHit.fighter, damage, fighterHit.part, shooter);
        if (!bestHit || result.killed) bestHit = { hit: true, killed: result.killed, part: fighterHit.part, fighter: fighterHit.fighter, point: tmpPoint.clone() };
        else if (!bestHit) bestHit = { hit: true, killed: false, part: fighterHit.part, fighter: fighterHit.fighter, point: tmpPoint.clone() };
      } else if (mapHits.length > 0) {
        tmpPoint.copy(mapHits[0].point);
        fx.impact(tmpPoint, mapHits[0].face ? mapHits[0].face.normal : new THREE.Vector3(0, 1, 0), 8);
        if (!bestHit) bestHit = { hit: false, killed: false, part: null, fighter: null, point: tmpPoint.clone() };
      }
    }
    return bestHit;
  }

  function throwGrenade({ position, direction, owner }) {
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
    mesh.position.copy(position);
    scene.add(mesh);
    grenades.push({
      mesh,
      position: mesh.position,
      velocity: direction.clone().multiplyScalar(17).add(new THREE.Vector3(0, 5.5, 0)),
      fuse: GRENADE_FUSE,
      bounced: false,
      owner,
    });
    audio.grenadeThrow();
  }

  function explode(grenade, playerPos) {
    const point = grenade.position;
    fx.explosion(point);
    audio.explosion(playerPos ? point.distanceTo(playerPos) : 0);
    for (const fighter of fighters) {
      if (!fighter.alive) continue;
      tmpChest.set(fighter.pos.x, fighter.pos.y + 1.0, fighter.pos.z);
      const distance = point.distanceTo(tmpChest);
      if (distance > GRENADE_RADIUS) continue;
      const blocked = losBlocked(point, tmpChest);
      const falloff = 1 - (distance / GRENADE_RADIUS) * 0.85;
      const damage = GRENADE_MAX_DAMAGE * falloff * (blocked ? 0.35 : 1);
      applyDamage(fighter, damage, 'blast', grenade.owner);
    }
    scene.remove(grenade.mesh);
  }

  const stepTmp = new THREE.Vector3();

  function stepGrenades(dt, playerPos) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= GRAVITY * dt;
      stepTmp.copy(grenade.position).addScaledVector(grenade.velocity, dt);
      let bounced = false;
      for (const collider of map.colliders) {
        if (stepTmp.x > collider.min.x - 0.09 && stepTmp.x < collider.max.x + 0.09
          && stepTmp.y > collider.min.y - 0.09 && stepTmp.y < collider.max.y + 0.09
          && stepTmp.z > collider.min.z - 0.09 && stepTmp.z < collider.max.z + 0.09) {
          const dxMin = Math.min(Math.abs(stepTmp.x - collider.min.x), Math.abs(stepTmp.x - collider.max.x));
          const dyMin = Math.min(Math.abs(stepTmp.y - collider.min.y), Math.abs(stepTmp.y - collider.max.y));
          const dzMin = Math.min(Math.abs(stepTmp.z - collider.min.z), Math.abs(stepTmp.z - collider.max.z));
          if (dxMin <= dyMin && dxMin <= dzMin) grenade.velocity.x *= -0.45;
          else if (dyMin <= dzMin) grenade.velocity.y *= -0.45;
          else grenade.velocity.z *= -0.45;
          grenade.velocity.multiplyScalar(0.8);
          bounced = true;
          break;
        }
      }
      if (bounced) {
        if (!grenade.bounced) {
          grenade.bounced = true;
          grenade.fuse = Math.min(grenade.fuse, GRENADE_FUSE_AFTER_BOUNCE);
          if (playerPos && grenade.position.distanceTo(playerPos) < 25) audio.bounce();
        }
        stepTmp.copy(grenade.position);
      } else {
        grenade.position.copy(stepTmp);
      }
      if (grenade.position.y < 0.09) {
        grenade.position.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
      }
      if (grenade.fuse <= 0) {
        explode(grenade, playerPos);
        grenades.splice(i, 1);
      }
    }
  }

  return {
    registerFighter,
    rayShoot,
    throwGrenade,
    losBlocked,
    applyDamage,
    stepGrenades,
    get grenadeCount() { return grenades.length; },
  };
}
