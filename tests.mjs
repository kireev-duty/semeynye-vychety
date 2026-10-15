import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const code = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const Core = ctx.DeductCore;

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const same = (o) => ({ 2023: o, 2024: o, 2025: o, 2026: o });
const person = (income, extra = {}) => ({ income: typeof income === 'number' ? same(income) : income, ...extra });
const family = (o) => ({ year: 2026, horizon: 5, couple: true, growth: 0, children: [], expenses: [], home: null, ...o });
const exp = (year, kind, who, amount, payer = 0, extra = {}) => ({ year, kind, who, amount, payer, ...extra });
const yearOf = (sim, y) => sim.years.find((r) => r.year === y);
const claimed = (sim, y, p) => yearOf(sim, y).people[p].claims.reduce((s, c) => s + c.amount, 0);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

// --- Шкала и возврат ---

test('2024: 6 млн — 13% до 5 млн и 15% сверху', () => {
  near(Core.tax(2024, 6e6), 800000);
});

test('2025: 3 млн — 13% до 2,4 млн и 15% сверху', () => {
  near(Core.tax(2025, 3e6), 402000);
});

test('2025: доход 3 млн, вычет 2 млн — 600 тыс. по 15% и 1,4 млн по 13% = 272 000', () => {
  near(Core.saving(2025, 3e6, 2e6), 272000);
});

test('пример Минфина: вычет 2 млн при ставке 22% возвращает 440 000', () => {
  near(Core.saving(2025, 60e6, 2e6), 440000);
});

test('2024: доход 6 млн, вычет 2 млн — 1 млн по 15% и 1 млн по 13%', () => {
  near(Core.saving(2024, 6e6, 2e6), 280000);
});

test('вычет больше дохода возвращает весь налог, не больше', () => {
  near(Core.saving(2025, 500000, 2e6), 65000);
});

// --- Лимиты по годам ---

test('общий лимит соцвычетов: 120 000 в 2023, 150 000 с 2024', () => {
  assert.equal(Core.rules(2023).socialCap, 120000);
  assert.equal(Core.rules(2024).socialCap, 150000);
});

test('обучение ребёнка: 50 000 в 2023, 110 000 с 2024', () => {
  assert.equal(Core.rules(2023).childEduCap, 50000);
  assert.equal(Core.rules(2024).childEduCap, 110000);
});

test('ГТО: 18 000 только с 2025', () => {
  assert.equal(Core.rules(2024).gto, 0);
  assert.equal(Core.rules(2025).gto, 18000);
});

// --- Детский стандартный вычет ---

test('2025: двое детей, 600 тыс. в год — 9 месяцев по 1 400 + 2 800', () => {
  const kids = [{ born: 2015 }, { born: 2020 }];
  near(Core.childStd(2025, 600000, kids), 37800);
});

test('2024: те же дети и доход — лимит 350 тыс., 7 месяцев по 1 400 + 1 400', () => {
  const kids = [{ born: 2015 }, { born: 2020 }];
  near(Core.childStd(2024, 600000, kids), 19600);
});

test('взрослый старший ребёнок не даёт вычет, но считается в очерёдности', () => {
  const kids = [{ born: 2003 }, { born: 2012 }, { born: 2015, disabled: true }];
  // 2 800 за второго, 6 000 + 12 000 за третьего, доход ниже лимита весь год
  near(Core.childStd(2025, 300000, kids), (2800 + 6000 + 12000) * 12);
});

test('студент-очник до 24 лет даёт вычет', () => {
  const kids = [{ born: 2004, studyUntil: 2027 }];
  near(Core.childStd(2025, 300000, kids), 1400 * 12);
});

// --- Кто может заявить расход ---

test('обучение супруга: нельзя в 2023, можно с 2024 при очной форме', () => {
  const inp = family({});
  assert.equal(Core.canClaim(inp, exp(2023, 'edu', 'p1', 1, 0, { fullTime: true }), 0), false);
  assert.equal(Core.canClaim(inp, exp(2024, 'edu', 'p1', 1, 0, { fullTime: true }), 0), true);
  assert.equal(Core.canClaim(inp, exp(2024, 'edu', 'p1', 1, 0, { fullTime: false }), 0), false);
});

test('спорт супруга не заявить; спорт родителя-пенсионера — с 2026', () => {
  const inp = family({});
  assert.equal(Core.canClaim(inp, exp(2025, 'sport', 'p1', 1), 0), false);
  assert.equal(Core.canClaim(inp, exp(2025, 'sport', 'par0', 1), 0), false);
  assert.equal(Core.canClaim(inp, exp(2026, 'sport', 'par0', 1), 0), true);
});

test('лечение родителя заявляет только его ребёнок, не зять или невестка', () => {
  const inp = family({});
  assert.equal(Core.canClaim(inp, exp(2025, 'treat', 'par1', 1), 1), true);
  assert.equal(Core.canClaim(inp, exp(2025, 'treat', 'par1', 1), 0), false);
});

test('ИИС и ПДС — только свой счёт', () => {
  const inp = family({});
  assert.equal(Core.canClaim(inp, exp(2025, 'savings', 'p0', 1), 0), true);
  assert.equal(Core.canClaim(inp, exp(2025, 'savings', 'p0', 1), 1), false);
});

test('лечение ребёнка 20 лет: только если учится очно', () => {
  const a = family({ children: [{ born: 2005 }] });
  const b = family({ children: [{ born: 2005, studyUntil: 2027 }] });
  assert.equal(Core.canClaim(a, exp(2025, 'treat', 'c0', 1), 0), false);
  assert.equal(Core.canClaim(b, exp(2025, 'treat', 'c0', 1), 0), true);
});

// --- Расчёт по годам ---

test('лечение 200 000 в 2025: вычет 150 000, возврат 19 500, сгорает 50 000', () => {
  const inp = family({ couple: false, people: [person(1e6)], expenses: [exp(2025, 'treat', 'p0', 200000)] });
  const sim = Core.simulate(inp, {});
  near(yearOf(sim, 2025).refund, 19500);
  assert.equal(sim.burnt.length, 1);
  near(sim.burnt[0].amount, 50000);
  assert.equal(sim.burnt[0].reason, 'limit');
});

test('лимит 2023 года — 120 000', () => {
  const inp = family({ couple: false, people: [person(1e6)], expenses: [exp(2023, 'treat', 'p0', 200000)] });
  near(yearOf(Core.simulate(inp, {}), 2023).refund, 15600);
});

test('обучение ребёнка 300 000 в 2024: 110 000 на обоих родителей вместе', () => {
  const inp = family({ people: [person(1e6), person(1e6)], children: [{ born: 2010 }], expenses: [exp(2024, 'edu', 'c0', 300000)] });
  const c = Core.compare(inp);
  near(yearOf(c.opt, 2024).refund, 14300);
});

test('дорогостоящее лечение без лимита, но не больше налога', () => {
  const inp = family({ couple: false, people: [person(1e6)], expenses: [exp(2025, 'treatExp', 'p0', 1500000)] });
  const sim = Core.simulate(inp, {});
  near(yearOf(sim, 2025).refund, 130000);
  near(yearOf(sim, 2025).people[0].wasted, 500000);
});

test('квартира 3 млн, доход 1 млн: вычет 2 млн за два года, остаток лимита не превышен', () => {
  const inp = family({ couple: false, people: [person(1e6)], home: { on: true, from: 2023, cost: 3e6, interest: {} } });
  const sim = Core.simulate(inp, {});
  near(yearOf(sim, 2023).refund, 130000);
  near(yearOf(sim, 2024).refund, 130000);
  near(yearOf(sim, 2025).refund, 0);
  assert.equal(sim.lastPropYear, 2024);
});

test('проценты: лимит 3 млн на человека за всю жизнь', () => {
  const inp = family({
    couple: false, horizon: 10, people: [person(5e6)],
    home: { on: true, from: 2023, cost: 0, interest: { 2023: 1.5e6, 2024: 1.5e6, 2025: 1.5e6 } }
  });
  const sim = Core.simulate(inp, {});
  const used = sim.years.reduce((s, y) => s + y.people[0].interest, 0);
  near(used, 3e6);
});

test('уже получал основной вычет: лимит 0 — вычет за квартиру не даётся', () => {
  const inp = family({ couple: false, people: [person(1e6)], home: { on: true, from: 2023, cost: 3e6, mainLimit: [0, 0], interest: {} } });
  near(Core.simulate(inp, {}).total, 0);
});

test('проценты, уплаченные до года права на вычет, копятся и заявляются с этого года', () => {
  const inp = family({ couple: false, people: [person(1e6)], home: { on: true, from: 2025, cost: 0, interest: { 2023: 100000, 2024: 100000, 2025: 100000 } } });
  const sim = Core.simulate(inp, {});
  near(yearOf(sim, 2024).refund, 0);
  near(yearOf(sim, 2025).refund, 39000);
});

test('уже начатый вычет: остатки на начало периода переносятся', () => {
  const inp = family({ couple: false, people: [person(1e6)], home: { on: true, started: true, carryMain: [1.5e6, 0], carryInterest: [0, 0], cost: 0, interest: {} } });
  const sim = Core.simulate(inp, {});
  near(yearOf(sim, 2023).people[0].main, 1e6);
  near(yearOf(sim, 2024).people[0].main, 500000);
});

test('ГТО и недополученный детский вычет заявляются через декларацию', () => {
  const inp = family({
    couple: false, children: [{ born: 2015 }],
    people: [person(300000, { gto: { 2025: true }, stdMissed: { 2025: true } })]
  });
  const y = yearOf(Core.simulate(inp, {}), 2025);
  near(y.people[0].ded, 18000 + 1400 * 12);
  near(y.refund, (18000 + 1400 * 12) * 0.13);
});

// --- Оптимизатор ---

test('соцвычет уходит тому, чей доход не занят квартирой', () => {
  const inp = family({
    people: [person(1e6), person(1e6)],
    home: { on: true, from: 2023, cost: 2e6, mainLimit: [2e6, 0], interest: {} },
    expenses: [exp(2024, 'treat', 'p0', 150000, 0)]
  });
  const c = Core.compare(inp);
  near(claimed(c.opt, 2024, 1), 150000);
  near(claimed(c.opt, 2024, 0), 0);
  near(yearOf(c.opt, 2024).people[0].main, 1e6);
});

test('при свободной базе у обоих — тому, у кого выше ставка', () => {
  const inp = family({
    people: [person(1e6), person(3e6)], children: [{ born: 2015 }],
    expenses: [exp(2025, 'treat', 'c0', 100000, 0)]
  });
  const c = Core.compare(inp);
  near(claimed(c.opt, 2025, 1), 100000);
  near(yearOf(c.opt, 2025).refund, 15000);
  near(c.gain, 2000);
});

test('платила жена в декрете: по документам 0, по плану 13 000', () => {
  const inp = family({
    people: [person(1e6), person(0)], children: [{ born: 2024 }],
    expenses: [exp(2025, 'treat', 'c0', 100000, 1)]
  });
  const c = Core.compare(inp);
  near(c.docs.total, 0);
  near(c.opt.total, 13000);
});

test('при равных ставках расход остаётся у плательщика по документам', () => {
  const inp = family({
    people: [person(1e6), person(1e6)], children: [{ born: 2015 }],
    expenses: [exp(2025, 'treat', 'c0', 50000, 1)]
  });
  const c = Core.compare(inp);
  near(claimed(c.opt, 2025, 1), 50000);
  near(c.gain, 0);
});

test('квартира делится так, чтобы налог вернулся быстрее', () => {
  const inp = family({
    horizon: 0, people: [person(2e6), person(1e6)],
    home: { on: true, from: 2025, cost: 3e6, interest: {} }
  });
  const c = Core.compare(inp);
  near(c.opt.mainSplit[0], 2e6);
  near(c.opt.mainSplit[1], 1e6);
  near(yearOf(c.opt, 2025).refund, 390000);
});

// --- Проверка перебором ---

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFamily(rand) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const inc = () => pick([0, 300000, 800000, 1500000, 2600000, 6000000]);
  const p0 = {}, p1 = {};
  for (let y = 2023; y <= 2026; y++) { p0[y] = inc(); p1[y] = inc(); }
  const expenses = [];
  const nExp = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < nExp; k++) {
    expenses.push(exp(pick([2023, 2024, 2025]), pick(['treat', 'treatExp', 'edu']), 'c0', pick([60000, 150000, 400000]), pick([0, 1])));
  }
  let home = null;
  if (rand() < 0.7) {
    const interest = {};
    if (rand() < 0.6) interest[pick([2024, 2025])] = pick([200000, 600000]);
    home = { on: true, from: pick([2023, 2024, 2025]), cost: pick([1500000, 3000000, 5000000]), interest };
  }
  return family({ horizon: 3, people: [person(p0), person(p1)], children: [{ born: 2012 }], expenses, home });
}

function bruteBest(inp) {
  const fr = [0, 0.25, 0.5, 0.75, 1];
  const flex = inp.expenses.map((e, i) => i);
  const intYears = inp.home ? Object.keys(inp.home.interest).map(Number) : [];
  const shares = [0, 0.5, 1, 'fill0', 'fill1'];
  let mains = [null];
  if (inp.home) {
    const lo = Math.max(0, inp.home.cost - 2e6), hi = Math.min(2e6, inp.home.cost);
    mains = Array.from({ length: 11 }, (_, k) => lo + (hi - lo) * k / 10);
  }
  let best = -1;
  const allocs = [];
  (function rec(k, cur) {
    if (k === flex.length) { allocs.push({ ...cur }); return; }
    for (const f of fr) { cur[flex[k]] = f; rec(k + 1, cur); }
  })(0, {});
  const decs = [];
  (function rec(k, cur) {
    if (k === intYears.length) { decs.push({ ...cur }); return; }
    for (const s of shares) { cur[intYears[k]] = { interest: s }; rec(k + 1, cur); }
  })(0, {});
  for (const main of mains) for (const alloc of allocs) for (const years of decs) {
    const sim = Core.simulate(inp, { mode: 'alloc', main, alloc, years });
    if (sim.total > best) best = sim.total;
  }
  return best;
}

test('оптимизатор не хуже полного перебора на 150 случайных семьях', () => {
  const rand = rng(20261015);
  let worst = 0;
  for (let k = 0; k < 150; k++) {
    const inp = randomFamily(rand);
    const opt = Core.optimize(inp).sim.total;
    const brute = bruteBest(inp);
    const docs = Core.simulate(inp, { mode: 'docs' }).total;
    assert.ok(opt >= docs - 0.5, `сценарий ${k}: план ${opt} хуже, чем по документам ${docs}`);
    worst = Math.min(worst, opt - brute);
    assert.ok(opt >= brute - 1, `сценарий ${k}: план ${opt.toFixed(2)} < перебор ${brute.toFixed(2)}\n${JSON.stringify(inp)}`);
  }
});

// --- Семейная выплата ---

test('семейная выплата: 1,2 млн по 13% — 84 000, вычеты на неё не влияют', () => {
  const inp = family({ people: [person(1.2e6), person(0)], children: [{ born: 2015 }, { born: 2018 }] });
  const fp = Core.familyPayment(inp, 2025, 20000, 0);
  near(fp.parts[0], 84000);
  near(fp.total, 84000);
  assert.equal(fp.kidsOk, true);
  // 1,2 млн / 12 / 4 = 25 000 на человека, лимит 1,5 × 20 000 = 30 000
  near(fp.perCapita, 25000);
  assert.equal(fp.incomeOk, true);
});

test('семейная выплата: один ребёнок — права нет', () => {
  const inp = family({ people: [person(1e6), person(1e6)], children: [{ born: 2015 }] });
  assert.equal(Core.familyPayment(inp, 2025, 20000, 0).kidsOk, false);
});

console.log(`\n${passed} тестов прошли`);
