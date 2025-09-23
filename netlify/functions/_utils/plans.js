const PLAN_META = {
  day: {
    label: '1 dzień',
    env: 'STRIPE_PRICE_1DAY',
    duration: { days: 1 }
  },
  month: {
    label: '1 miesiąc',
    env: 'STRIPE_PRICE_1MONTH',
    duration: { months: 1 }
  },
  halfyear: {
    label: '6 miesięcy',
    env: 'STRIPE_PRICE_6MONTHS',
    duration: { months: 6 }
  },
  year: {
    label: '1 rok',
    env: 'STRIPE_PRICE_1YEAR',
    duration: { years: 1 }
  }
};

function getPlan(key) {
  const normalized = String(key || '').trim().toLowerCase();
  if (!normalized) return null;
  const meta = PLAN_META[normalized];
  if (!meta) return null;
  const priceId = process.env[meta.env];
  return {
    key: normalized,
    label: meta.label,
    priceId,
    duration: { ...meta.duration }
  };
}

function listPlans() {
  return Object.keys(PLAN_META).map((key) => getPlan(key));
}

function ensurePlan(key) {
  const plan = getPlan(key);
  if (!plan) {
    throw new Error(`Nie znaleziono konfiguracji planu: ${key}`);
  }
  if (!plan.priceId) {
    throw new Error(`Plan ${plan.key} nie ma ustawionego identyfikatora ceny (${PLAN_META[plan.key].env}).`);
  }
  return plan;
}

function calculateExpiryFromPlan(planKey, startingPoint = new Date()) {
  const plan = ensurePlan(planKey);
  return applyDuration(startingPoint, plan.duration);
}

function applyDuration(startDate, duration) {
  const date = new Date(startDate.getTime());
  if (duration.years) {
    date.setFullYear(date.getFullYear() + duration.years);
  }
  if (duration.months) {
    date.setMonth(date.getMonth() + duration.months);
  }
  if (duration.days) {
    date.setDate(date.getDate() + duration.days);
  }
  return date;
}

module.exports = {
  getPlan,
  listPlans,
  ensurePlan,
  calculateExpiryFromPlan,
  applyDuration
};
