// The match: rounds, money, the buy menu and the bomb. Ember attacks, the
// player with them; Vanguard defends. A round is won by eliminating the
// other team, by the charge going off, or by defusing it; the timer expiring
// with no plant favours the defenders. First to 5 rounds takes the match,
// at most 9 rounds. Money is earned per kill and per round and spent in the
// freeze-time buy menu.
import * as THREE from 'three';
import { WEAPONS, BUY_MENU, ARMOR_PRICE, GRENADE_PRICE } from './weapons.js';

const FREEZE_SECONDS = 5;
const ROUND_SECONDS = 100;
const BOMB_FUSE = 35;
const PLANT_TIME = 3.2;
const WIN_SCORE = 5;
const MAX_ROUNDS = 9;

export function createMatch({ scene, map, bots, combat, fx, audio, hud, rng }) {
  const bombMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.32),
    new THREE.MeshStandardMaterial({ color: 0xe5484d, emissive: 0xff2a1a, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3 }),
  );
  const bombLight = new THREE.PointLight(0xff2a1a, 0, 6);
  bombMesh.visible = false;
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 3.2, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  );
  beacon.visible = false;
  scene.add(bombMesh, bombLight, beacon);

  function showPlantedVisuals(x, z) {
    bombMesh.position.set(x, 0.3, z);
    bombMesh.visible = true;
    bombLight.position.set(x, 0.8, z);
    bombLight.intensity = 2;
    beacon.position.set(x, 1.6, z);
    beacon.visible = true;
  }
  function hidePlantedVisuals() {
    bombMesh.visible = false;
    bombLight.intensity = 0;
    beacon.visible = false;
  }

  const state = {
    phase: 'menu',
    round: 0,
    emberScore: 0,
    vanguardScore: 0,
    timeLeft: 0,
    freezeLeft: 0,
    roundEndLeft: 0,
    money: 800,
    teamMoney: { ember: 800, vanguard: 800 },
    lossStreak: { ember: 0, vanguard: 0 },
    bomb: { state: 'carried', site: null, carrierId: 'player', position: { x: 0, z: 0 }, fuseLeft: 0 },
    grenades: 0,
    owned: new Set(['pistol']),
    plantProgress: 0,
    winner: null,
  };

  let player = null;
  let lastBeepSecond = -1;

  function setPlayer(p) {
    player = p;
  }

  function aliveCount(team) {
    let count = bots.aliveCount(team);
    if (team === 'ember' && player && player.fighter.alive) count += 1;
    return count;
  }

  function startRound() {
    state.round += 1;
    state.phase = 'freeze';
    state.freezeLeft = FREEZE_SECONDS;
    state.timeLeft = ROUND_SECONDS;
    state.bomb = { state: 'carried', site: null, carrierId: 'player', position: { x: 0, z: 0 }, fuseLeft: 0 };
    state.plantProgress = 0;
    hidePlantedVisuals();
    const [px, pz] = map.spawns.ember[2];
    player.mover.reset(px, pz, Math.PI);
    player.fighter.hp = 100;
    player.fighter.alive = true;
    player.hasCharge = true;
    player.fighter.armor = player.armorKept ? 100 : 0;
    bots.spawnRound(state.round, state.teamMoney.ember, state.teamMoney.vanguard);
    bots.setCarrier(null);
    hud.showBuy(true);
    hud.banner(`ROUND ${state.round}`, 'Ember attacks — plant the charge at A or B');
    hud.setBomb('carried');
    hud.update(state, player);
  }

  function startMatch() {
    state.phase = 'freeze';
    state.round = 0;
    state.emberScore = 0;
    state.vanguardScore = 0;
    state.money = 800;
    state.teamMoney = { ember: 800, vanguard: 800 };
    state.lossStreak = { ember: 0, vanguard: 0 };
    state.grenades = 0;
    state.owned = new Set(['pistol']);
    player.rig.equip('pistol');
    player.rig.refill('pistol');
    player.armorKept = false;
    startRound();
  }

  function awardMoney(team, amount) {
    if (team === 'ember') {
      state.money += amount;
      state.teamMoney.ember += amount;
    } else {
      state.teamMoney.vanguard += amount;
    }
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.roundEndLeft = 4;
    state.winner = winner;
    if (winner === 'ember') {
      state.emberScore += 1;
      state.lossStreak.ember = 0;
      state.lossStreak.vanguard += 1;
      awardMoney('ember', 3250);
      state.teamMoney.vanguard += Math.min(3400, 1900 + 500 * (state.lossStreak.vanguard - 1));
      audio.roundWin();
      hud.banner('ROUND WON', reason);
    } else {
      state.vanguardScore += 1;
      state.lossStreak.vanguard = 0;
      state.lossStreak.ember += 1;
      state.teamMoney.ember += Math.min(3400, 1900 + 500 * (state.lossStreak.ember - 1));
      state.teamMoney.vanguard += 3250;
      audio.roundLose();
      hud.banner('ROUND LOST', reason);
    }
    hud.showBuy(false);
    hud.setBomb(state.bomb.state === 'planted' ? 'exploded' : 'none');
    hud.update(state, player);
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const won = state.emberScore > state.vanguardScore;
    hud.showMatchEnd(won, state.emberScore, state.vanguardScore);
    if (won) audio.roundWin();
    else audio.roundLose();
  }

  function onKill(killerId, victimId) {
    const killerName = killerId === 'player' ? 'You' : bots.bots.find((b) => b.id === killerId)?.name ?? killerId;
    const victimName = victimId === 'player' ? 'You' : bots.bots.find((b) => b.id === victimId)?.name ?? victimId;
    hud.killfeed(killerName, victimName);
    if (killerId === 'player') {
      state.money += 300;
      hud.update(state, player);
    }
    if (victimId === 'player') {
      // The player drops the primary they carried, and the vest they wore.
      const primary = [...state.owned].find((id) => id !== 'pistol');
      if (primary) state.owned.delete(primary);
      player.armorKept = false;
      if (player.hasCharge) transferCharge();
    }
    if (state.phase !== 'live') return;
    const emberAlive = aliveCount('ember');
    const vanguardAlive = aliveCount('vanguard');
    if (state.bomb.state === 'planted') {
      if (emberAlive === 0 && vanguardAlive > 0) {
        // Defenders still have to defuse; the round rides on the fuse.
        return;
      }
      if (vanguardAlive === 0) endRound('ember', 'Site cleared — the charge will detonate');
    } else {
      if (emberAlive === 0) endRound('vanguard', 'Ember eliminated');
      else if (vanguardAlive === 0) endRound('ember', 'Vanguard eliminated');
    }
  }

  function transferCharge() {
    player.hasCharge = false;
    const carrier = bots.bots.filter((b) => b.team === 'ember' && b.alive)
      .sort((a, b) => {
        const da = Math.hypot(a.mover.state.position.x - player.mover.state.position.x, a.mover.state.position.z - player.mover.state.position.z);
        const db = Math.hypot(b.mover.state.position.x - player.mover.state.position.x, b.mover.state.position.z - player.mover.state.position.z);
        return da - db;
      })[0];
    if (carrier) {
      bots.setCarrier(carrier);
      state.bomb.carrierId = carrier.id;
      hud.banner('CHARGE DROPPED', `${carrier.name} picked up the charge`);
    } else {
      state.bomb.carrierId = null;
    }
    hud.setBomb(state.bomb.state === 'planted' ? 'planted' : 'carried');
    hud.update(state, player);
  }

  function onPlant(site, bot) {
    if (state.phase !== 'live' || state.bomb.state !== 'carried') return;
    state.bomb.state = 'planted';
    state.bomb.site = site;
    state.bomb.fuseLeft = BOMB_FUSE;
    state.bomb.position = { x: bot.mover.state.position.x, z: bot.mover.state.position.z };
    showPlantedVisuals(state.bomb.position.x, state.bomb.position.z);
    if (bot.id.startsWith('ember')) awardMoney('ember', 300);
    hud.banner('CHARGE PLANTED', `Site ${site} — defend it until it blows`);
    hud.setBomb('planted');
    audio.plantStart();
    hud.update(state, player);
  }

  function onDefuse(bot) {
    if (state.phase !== 'live' || state.bomb.state !== 'planted') return;
    state.bomb.state = 'defused';
    hidePlantedVisuals();
    endRound('vanguard', `${bot.name} defused the charge`);
  }

  function onCarrierDown(bot) {
    if (state.bomb.state !== 'carried') return;
    transferCharge();
  }

  // Screenshot mode only: plant the charge at a site without a channel.
  function debugPlant(site, x, z) {
    state.bomb = { state: 'planted', site, carrierId: null, position: { x, z }, fuseLeft: 28 };
    player.hasCharge = false;
    showPlantedVisuals(x, z);
    hud.setBomb('planted');
    hud.update(state, player);
  }

  // Screenshot mode only: force a round win from the live phase.
  function endRoundForShot() {
    endRound('ember', 'Vanguard eliminated');
  }

  function buy(id) {
    if (state.phase !== 'freeze') return false;
    if (id === 'armor') {
      if (player.fighter.armor >= 100 || state.money < ARMOR_PRICE) { audio.denied(); return false; }
      state.money -= ARMOR_PRICE;
      player.fighter.armor = 100;
      player.armorKept = true;
      audio.buy();
      hud.update(state, player);
      return true;
    }
    if (id === 'grenade') {
      if (state.grenades >= 2 || state.money < GRENADE_PRICE) { audio.denied(); return false; }
      state.money -= GRENADE_PRICE;
      state.grenades += 1;
      audio.buy();
      hud.update(state, player);
      return true;
    }
    const def = WEAPONS[id];
    if (!def) return false;
    if (state.owned.has(id)) {
      // Already owned: top the reserve back up for half price.
      if (state.money < Math.floor(def.price / 2)) { audio.denied(); return false; }
      state.money -= Math.floor(def.price / 2);
      player.rig.refill(id);
      audio.buy();
      hud.update(state, player);
      return true;
    }
    if (state.money < def.price) { audio.denied(); return false; }
    state.money -= def.price;
    state.owned.add(id);
    player.rig.refill(id);
    player.rig.equip(id);
    audio.buy();
    hud.update(state, player);
    return true;
  }

  function playerPlant(dt, keys, speed) {
    if (state.phase !== 'live' || state.bomb.state !== 'carried' || !player.hasCharge || !player.fighter.alive) {
      state.plantProgress = 0;
      return;
    }
    const pos = player.mover.state.position;
    const siteKey = Object.keys(map.sites).find((key) => {
      const rect = map.sites[key].rect;
      return pos.x > rect.x0 && pos.x < rect.x1 && pos.z > rect.z0 && pos.z < rect.z1;
    });
    if (!siteKey || !keys.has('KeyE') || speed > 0.6) {
      state.plantProgress = 0;
      return;
    }
    state.plantProgress += dt;
    if (Math.floor(state.plantProgress * 2) !== Math.floor((state.plantProgress - dt) * 2)) audio.plantBeep();
    if (state.plantProgress >= PLANT_TIME) {
      state.plantProgress = 0;
      state.bomb.state = 'planted';
      state.bomb.site = siteKey;
      state.bomb.fuseLeft = BOMB_FUSE;
      state.bomb.position = { x: pos.x, z: pos.z };
      player.hasCharge = false;
      showPlantedVisuals(pos.x, pos.z);
      state.money += 300;
      hud.banner('CHARGE PLANTED', `Site ${siteKey} — defend it until it blows`);
      hud.setBomb('planted');
      audio.plantStart();
      hud.update(state, player);
    }
  }

  function step(dt, input) {
    if (state.phase === 'freeze') {
      state.freezeLeft -= dt;
      if (state.freezeLeft <= 0) {
        state.phase = 'live';
        hud.showBuy(false);
        hud.banner('ROUND LIVE', 'Plant the charge — or clear the site');
        hud.update(state, player);
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.roundEndLeft -= dt;
      if (state.roundEndLeft <= 0) {
        if (state.emberScore >= WIN_SCORE || state.vanguardScore >= WIN_SCORE || state.round >= MAX_ROUNDS) endMatch();
        else startRound();
      }
      return;
    }
    if (state.phase !== 'live') return;

    state.timeLeft -= dt;
    playerPlant(dt, input.keys, player.mover.groundSpeed());

    if (state.bomb.state === 'planted') {
      state.bomb.fuseLeft -= dt;
      const second = Math.ceil(state.bomb.fuseLeft);
      if (second !== lastBeepSecond) {
        lastBeepSecond = second;
        if (state.bomb.fuseLeft < 10 || second % 2 === 0) audio.bombTick();
      }
      bombLight.intensity = 1.5 + Math.sin(performance.now() / 130) * 1.2;
      if (state.bomb.fuseLeft <= 0) {
        const point = new THREE.Vector3(state.bomb.position.x, 0.5, state.bomb.position.z);
        fx.explosion(point);
        audio.explosion(point.distanceTo(player.mover.state.position));
        for (const fighter of [player.fighter, ...bots.fighters()]) {
          if (!fighter.alive) continue;
          const distance = Math.hypot(fighter.pos.x - point.x, fighter.pos.z - point.z);
          if (distance < 9) combat.applyDamage(fighter, 140 * (1 - distance / 9), 'blast', null);
        }
        hidePlantedVisuals();
        endRound('ember', 'The charge detonated');
        return;
      }
    }

    if (state.timeLeft <= 0) {
      if (state.bomb.state !== 'planted') endRound('vanguard', 'Time expired — the charge was never planted');
    }
  }

  return {
    state,
    setPlayer,
    startMatch,
    startRound,
    step,
    onKill,
    onPlant,
    onDefuse,
    onCarrierDown,
    debugPlant,
    endRoundForShot,
    buy,
    aliveCount,
    get buyMenu() { return BUY_MENU; },
  };
}
