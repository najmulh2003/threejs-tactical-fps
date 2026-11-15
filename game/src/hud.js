// The DOM HUD: crosshair, hit marker, health and armor, ammo, money, the
// round timer and the team scores, the killfeed, the buy menu, the bomb
// status and the banners. It never touches the simulation; the match and
// main.js push numbers in and read the play and restart callbacks out.
// Every setter skips work when the value has not changed.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'),
    title: $('overlay-title'),
    copy: $('overlay-copy'),
    play: $('play'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    healthFill: $('health-fill'),
    healthValue: $('health-value'),
    armorFill: $('armor-fill'),
    armorValue: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    money: $('money-value'),
    timer: $('timer-value'),
    scoreEmber: $('score-ember'),
    scoreVanguard: $('score-vanguard'),
    roundLabel: $('round-label'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bomb: $('bomb-status'),
    plant: $('plant-progress'),
    plantFill: $('plant-fill'),
    buy: $('buy-menu'),
    buyList: $('buy-list'),
    buyMoney: $('buy-money'),
    damage: $('damage-indicator'),
    vignette: $('vignette'),
    charge: $('charge-indicator'),
  };
  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  return {
    update(state, player) {
      const s = state;
      setText(els.timer, 'timer', formatTime(s.phase === 'freeze' ? s.freezeLeft : s.timeLeft));
      els.timer.classList.toggle('urgent', s.phase === 'live' && s.timeLeft < 15);
      setText(els.scoreEmber, 'ember', String(s.emberScore));
      setText(els.scoreVanguard, 'vanguard', String(s.vanguardScore));
      setText(els.roundLabel, 'round', s.round === 0 ? 'WARMUP' : `ROUND ${s.round} / 9`);
      setText(els.money, 'money', `$${s.money}`);
      setText(els.buyMoney, 'buyMoney', `$${s.money}`);
      this.setHealth(player.fighter.hp, player.fighter.armor);
      const ammo = player.rig.ammo();
      this.setAmmo(ammo.mag, ammo.reserve, player.rig.def().name);
      this.setCharge(player.hasCharge);
      if (s.bomb.state === 'planted') {
        setText(els.bomb, 'bomb', `CHARGE @ ${s.bomb.site} — ${formatTime(s.bomb.fuseLeft)}`);
        els.bomb.className = 'planted';
      }
    },
    setHealth(hp, armor) {
      const hpNow = Math.max(0, Math.round(hp));
      setText(els.healthValue, 'hp', String(hpNow));
      if (last.hpFill !== hpNow) {
        last.hpFill = hpNow;
        els.healthFill.style.width = `${hpNow}%`;
        els.healthFill.classList.toggle('low', hpNow <= 30);
      }
      const armorNow = Math.max(0, Math.round(armor));
      setText(els.armorValue, 'armor', String(armorNow));
      if (last.armorFill !== armorNow) {
        last.armorFill = armorNow;
        els.armorFill.style.width = `${armorNow}%`;
      }
      els.vignette.classList.toggle('low', hpNow <= 30 && hpNow > 0);
    },
    setAmmo(mag, reserve, weaponName) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'reserve', `/ ${reserve}`);
      setText(els.weaponName, 'weapon', weaponName);
      els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setCharge(hasCharge) {
      if (last.charge === hasCharge) return;
      last.charge = hasCharge;
      els.charge.hidden = !hasCharge;
    },
    setBomb(state) {
      if (state === 'carried') {
        setText(els.bomb, 'bomb', 'CHARGE: YOU CARRY IT — HOLD E ON A SITE');
        els.bomb.className = '';
      } else if (state === 'none' || state === 'defused') {
        setText(els.bomb, 'bomb', state === 'defused' ? 'CHARGE DEFUSED' : '');
        els.bomb.className = '';
      } else if (state === 'exploded') {
        setText(els.bomb, 'bomb', 'CHARGE DETONATED');
        els.bomb.className = 'planted';
      }
    },
    setPlantProgress(progress) {
      if (progress === null) {
        els.plant.hidden = true;
        return;
      }
      els.plant.hidden = false;
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    setCrosshairGap(pixels) {
      els.crosshair.style.setProperty('--gap', `${pixels.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(killer, victim) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const killerSpan = document.createElement('b');
      killerSpan.textContent = killer;
      const victimSpan = document.createElement('span');
      victimSpan.textContent = victim;
      row.append(killerSpan, document.createTextNode('  ✕  '), victimSpan);
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    banner(title, sub) {
      setText(els.bannerTitle, 'bannerTitle', title);
      setText(els.bannerSub, 'bannerSub', sub ?? '');
      els.banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('show'), 2600);
    },
    damageFrom(angleDegrees) {
      els.damage.style.setProperty('--angle', `${angleDegrees}deg`);
      els.damage.classList.add('show');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => els.damage.classList.remove('show'), 450);
    },
    showBuy(show) {
      els.buy.hidden = !show;
    },
    setBuyItems(items, owned, money) {
      els.buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'buy-row';
        const key = document.createElement('kbd');
        key.textContent = item.key;
        const label = document.createElement('span');
        label.textContent = item.label;
        const price = document.createElement('b');
        const priceValue = item.id === 'armor' ? 650 : item.id === 'grenade' ? 300 : item.price;
        price.textContent = `$${priceValue}`;
        if (owned.has(item.id)) row.classList.add('owned');
        if (priceValue > money) row.classList.add('poor');
        row.append(key, label, price);
        els.buyList.append(row);
      }
    },
    showOverlay(mode, data = {}) {
      const copy = {
        start: ['EMBERLINE', 'A tactical round-based FPS. Plant the charge at A or B, or clear the defenders. Click to play.', 'Click to play'],
        paused: ['EMBERLINE', 'Paused. Click to resume.', 'Click to resume'],
      }[mode];
      if (!copy) return;
      els.title.textContent = copy[0];
      els.copy.textContent = data.copy ?? copy[1];
      els.play.textContent = copy[2];
      els.overlay.hidden = false;
      els.play.focus();
    },
    showMatchEnd(won, ember, vanguard) {
      els.title.textContent = won ? 'EMBER WINS THE MATCH' : 'VANGUARD WINS THE MATCH';
      els.copy.textContent = `Final score — Ember ${ember} : ${vanguard} Vanguard.`;
      els.play.textContent = 'Play again';
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
  };
}
