import { formatMoney } from './util.js';
import { sfx } from './audio.js';
import { persistSave } from './career.js';

export const SHOP_ITEMS = [
  { id: 'repair', name: 'Full Repair', desc: 'Restore hull to full HP', price: 400,
    apply(save) {
      const missing = save.car.maxHp - save.car.hp;
      if (missing <= 0) return false;
      save.car.hp = save.car.maxHp;
      return true;
    },
    can(save) { return save.car.hp < save.car.maxHp; },
    dynamicPrice(save) {
      const missing = save.car.maxHp - save.car.hp;
      return Math.max(100, Math.ceil(missing / 10000 * 400));
    }
  },
  { id: 'engine', name: 'Engine +1', desc: 'Higher accel & top speed', price: 900,
    max: 5,
    apply(save) { if (save.car.engine >= 5) return false; save.car.engine++; return true; },
    can(save) { return save.car.engine < 5; },
    level(save) { return save.car.engine; }
  },
  { id: 'armour', name: 'Armour +1', desc: 'Reduce collision & weapon damage', price: 750,
    max: 5,
    apply(save) { if (save.car.armour >= 5) return false; save.car.armour++; return true; },
    can(save) { return save.car.armour < 5; },
    level(save) { return save.car.armour; }
  },
  { id: 'ram', name: 'Ram Plate +1', desc: 'Deal more contact damage', price: 600,
    max: 5,
    apply(save) { if (save.car.ram >= 5) return false; save.car.ram++; return true; },
    can(save) { return save.car.ram < 5; },
    level(save) { return save.car.ram; }
  },
  { id: 'nitro_tank', name: 'Nitro Charge', desc: 'Add one N2O boost (~1.2s)', price: 350,
    apply(save) {
      if (save.car.nitro >= save.car.nitroMax + 2) return false;
      save.car.nitro++;
      return true;
    },
    can(save) { return save.car.nitro < save.car.nitroMax + 2; }
  },
  { id: 'nitro_max', name: 'Nitro Capacity +1', desc: 'Carry more nitro into races', price: 800,
    max: 4,
    apply(save) { if (save.car.nitroMax >= 4) return false; save.car.nitroMax++; save.car.nitro++; return true; },
    can(save) { return save.car.nitroMax < 4; },
    level(save) { return save.car.nitroMax; }
  },
  { id: 'w_front', name: 'Front Missiles x4', desc: 'Straight-shot rockets', price: 280,
    apply(save) { save.car.weapons.front += 4; return true; }, can() { return true; }
  },
  { id: 'w_rear', name: 'Rear Missiles x3', desc: 'Fire backward', price: 260,
    apply(save) { save.car.weapons.rear += 3; return true; }, can() { return true; }
  },
  { id: 'w_homing', name: 'Homing Missiles x2', desc: 'Seek nearest rival', price: 450,
    apply(save) { save.car.weapons.homing += 2; return true; }, can() { return true; }
  },
  { id: 'w_mine', name: 'Mines x3', desc: 'Drop on the racing line', price: 300,
    apply(save) { save.car.weapons.mine += 3; return true; }, can() { return true; }
  },
  { id: 'w_super', name: 'Super Missile x1', desc: 'Heavy punch', price: 700,
    apply(save) { save.car.weapons.super += 1; return true; }, can() { return true; }
  }
];

export function buyItem(save, itemId) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (!item.can(save)) return { ok: false, reason: 'Unavailable' };
  const price = item.dynamicPrice ? item.dynamicPrice(save) : item.price;
  if (save.cash < price) return { ok: false, reason: 'Not enough cash' };
  save.cash -= price;
  if (!item.apply(save)) {
    save.cash += price;
    return { ok: false, reason: 'Cannot apply' };
  }
  persistSave(save);
  sfx('buy');
  return { ok: true, price };
}

export function priceOf(item, save) {
  return item.dynamicPrice ? item.dynamicPrice(save) : item.price;
}

export { formatMoney };
