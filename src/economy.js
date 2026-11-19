// economy.js - Veyport money: balance, ledger, shops and payouts.
// The ledger is the audit trail: every credit and debit is one entry with
// a reason, so the HUD number is always explainable. Phase B adds mission
// payouts and the Chop Shop; this file owns the numbers.

export const SHOP = {
  weapons: {
    kr9: { name: 'KR-9 Ripper', price: 2200 },
    iron12: { name: 'Iron-12', price: 1800 },
    vk7: { name: 'VK-7 Carbine', price: 4200 },
    p9: { name: 'P9 Sidearm', price: 400 },
  },
  ammo: {
    p9: { name: 'P9 Mag (12)', price: 60 },
    kr9: { name: 'KR-9 Mag (30)', price: 90 },
    iron12: { name: 'Iron-12 Shells (6)', price: 80 },
    vk7: { name: 'VK-7 Mag (30)', price: 120 },
  },
  repairs: { name: 'Full Repair', price: 350 },
  armor: { name: 'Armor Plate', price: 500 },
};

export class Economy {
  constructor(starting) {
    this.balance = starting;
    this.ledger = [];
    this.earned = 0;
    this.spent = 0;
  }

  canAfford(amount) {
    return this.balance >= amount;
  }

  // Returns true when the debit landed.
  spend(amount, reason) {
    if (amount <= 0) return true;
    if (!this.canAfford(amount)) return false;
    this.balance -= amount;
    this.spent += amount;
    this.ledger.push({ t: Date.now(), delta: -amount, reason });
    return true;
  }

  earn(amount, reason) {
    if (amount <= 0) return;
    this.balance += amount;
    this.earned += amount;
    this.ledger.push({ t: Date.now(), delta: amount, reason });
  }

  // Mission / contract payout with a rank multiplier.
  payout(base, multiplier, reason) {
    const total = Math.round(base * multiplier);
    this.earn(total, reason);
    return total;
  }

  summary() {
    return { balance: this.balance, earned: this.earned, spent: this.spent };
  }

  recent(n = 8) {
    return this.ledger.slice(-n).reverse();
  }
}
