/* Meal plan optimizer.
 *
 * Given the items available at one meal period and a macro budget for that
 * meal, choose integer servings per item (0..MAX_SERVINGS, at most
 * MAX_DISTINCT distinct items) to hit the budget. Greedy construction
 * followed by local-search improvement (add / remove / swap moves).
 */

const MAX_SERVINGS = 3;
const MAX_DISTINCT = 5;
const MIN_ITEM_CALORIES = 40; // skip condiments, sauces, black coffee, etc.

/** Flatten stations into a candidate pool, applying diet filters. */
export function buildCandidatePool(stations, prefs) {
  // Keep one copy of duplicate dishes, but deliberately prefer the copy from a
  // favorite station. This matters because the same item can appear at several
  // stands; a simple first-seen de-duplication can otherwise erase a user's
  // favorite-station preference before the optimizer ever sees it.
  const chosen = new Map();
  const favs = (prefs.favoriteStations?.[prefs.mealCanonical] || []).map((s) => String(s).trim().toLowerCase());
  for (const { station, items } of stations) {
    for (const item of items) {
      if (!item.hasNutrition || item.calories < MIN_ITEM_CALORIES) continue;
      if (prefs.vegan && !item.labels.some((l) => /vegan/i.test(l))) continue;
      if (prefs.vegetarian && !item.labels.some((l) => /vegan|vegetarian/i.test(l))) continue;
      if (prefs.avoidAllergens.length &&
          item.allergens.some((a) => prefs.avoidAllergens.some((x) => allergenMatch(a, x)))) continue;
      if (prefs.excluded.has(itemKey(station, item.name))) continue;

      const key = item.name.toLowerCase();
      const stationNorm = String(station).trim().toLowerCase();
      const isFlameBreakfast = prefs.mealCanonical === 'breakfast' && /\bflame\b/.test(stationNorm);
      const candidate = { ...item, station, preferredStation: favs.includes(stationNorm), isFlameBreakfast };
      const existing = chosen.get(key);
      if (!existing || (candidate.preferredStation && !existing.preferredStation)) chosen.set(key, candidate);
    }
  }
  return Array.from(chosen.values());
}

export function itemKey(station, name) {
  return `${station}::${name}`;
}

/* API allergen names come starred and singular ("Egg*", "Milk*", "Tree Nuts");
 * compare on letters only, in both directions. */
function allergenMatch(apiName, chipName) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const a = norm(apiName);
  const b = norm(chipName);
  return a.includes(b) || b.includes(a);
}

/**
 * Score a plan against the budget — lower is better.
 * Protein shortfall is the top priority, then calorie accuracy,
 * then soft caps on fat/carbs, then variety across the week.
 */
function scorePlan(totals, budget, varietyPenalty, stationPenalty = 0) {
  let s = 0;
  const pShort = Math.max(0, budget.protein - totals.protein);
  const pOver = Math.max(0, totals.protein - budget.protein * 1.3);
  s += pShort * 14 + pOver * 2;

  const calOver = Math.max(0, totals.calories - budget.calories);
  const calUnder = Math.max(0, budget.calories - totals.calories);
  s += calOver * 1.6 + calUnder * 1.0;

  if (budget.fatMax != null) s += Math.max(0, totals.fat - budget.fatMax) * 6;
  if (budget.carbMax != null) s += Math.max(0, totals.carbs - budget.carbMax) * 3;

  s += varietyPenalty + stationPenalty;
  return s;
}

function totalsOf(servings, pool) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  servings.forEach((count, idx) => {
    if (!count) return;
    const it = pool[idx];
    t.calories += it.calories * count;
    t.protein += it.protein * count;
    t.carbs += it.carbs * count;
    t.fat += it.fat * count;
  });
  return t;
}

/**
 * Optimize one meal.
 * @param pool      candidate items (from buildCandidatePool)
 * @param budget    {calories, protein, fatMax?, carbMax?}
 * @param usageMap  Map itemKey -> times already planned earlier in the week
 * @returns {picks: [{item, servings}], totals}
 */
function buildFlameOmelet(pool, budget, usageMap) {
  const flame = pool.filter((x) => x.isFlameBreakfast);
  if (!flame.length) return null;
  const eggs = flame.filter((x) => /\b(egg|eggs|whole egg|scrambled egg)\b/i.test(x.name));
  if (!eggs.length) return null;
  const egg = eggs.sort((a,b) => a.calories - b.calories)[0];
  const toppings = flame.filter((x) => x !== egg &&
    /bacon|sausage|ham|turkey|chicken|beef|cheese|tomato|onion|pepper|spinach|mushroom|jalape|vegetable|broccoli|avocado/i.test(x.name));
  const base = [{ item: egg, servings: 3 }];
  let total = { calories: egg.calories * 3, protein: egg.protein * 3, carbs: egg.carbs * 3, fat: egg.fat * 3 };
  const chosen = new Set([egg.name.toLowerCase()]);
  const ranked = toppings
    .filter(x => !chosen.has(x.name.toLowerCase()))
    .sort((a,b) => (b.protein - a.protein) - (b.calories - a.calories) * 0.02);
  // A Flame breakfast is a composed omelet/scramble: keep at least two toppings
  // when the menu and budget permit, and never let the topping list dominate the meal.
  for (const topping of ranked) {
    if (base.length >= 4) break;
    if (total.calories + topping.calories > budget.calories * 0.82) continue;
    base.push({ item: topping, servings: 1 });
    total.calories += topping.calories; total.protein += topping.protein;
    total.carbs += topping.carbs; total.fat += topping.fat;
    chosen.add(topping.name.toLowerCase());
  }
  if (base.length < 3) return null;
  return { picks: base, totals: total, flameOmelet: true };
}

export function optimizeMeal(pool, budget, usageMap = new Map()) {
  if (!pool.length) return { picks: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };

  const servings = new Array(pool.length).fill(0);
  const varietyOf = (sv) => {
    let p = 0;
    sv.forEach((count, idx) => {
      if (!count) return;
      const uses = usageMap.get(itemKey(pool[idx].station, pool[idx].name)) || 0;
      p += uses * 25 * count;
    });
    return p;
  };
  const evaluate = (sv) => {
    const hasFavorite = pool.some((item) => item.preferredStation);
    // A favorite is a strong preference rather than a hard filter. The penalty is
    // intentionally large enough to make favorites materially affect choices,
    // while macro accuracy can still win when a non-favorite is much better.
    const stationPenalty = hasFavorite ? sv.reduce((sum, count, idx) => sum + (count && !pool[idx].preferredStation ? 180 * count : 0), 0) : 0;
    return scorePlan(totalsOf(sv, pool), budget, varietyOf(sv), stationPenalty);
  };

  let best = evaluate(servings);

  const distinctCount = (sv) => sv.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0);

  // Greedy: repeatedly apply the single best add-one-serving move.
  for (;;) {
    let bestIdx = -1;
    let bestScore = best;
    for (let i = 0; i < pool.length; i++) {
      if (servings[i] >= MAX_SERVINGS) continue;
      if (servings[i] === 0 && distinctCount(servings) >= MAX_DISTINCT) continue;
      servings[i]++;
      const sc = evaluate(servings);
      servings[i]--;
      if (sc < bestScore - 1e-9) {
        bestScore = sc;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    servings[bestIdx]++;
    best = bestScore;
  }

  // Local search: single-serving remove and remove+add swaps until stable.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < pool.length; i++) {
      if (!servings[i]) continue;
      servings[i]--;
      const removedScore = evaluate(servings);
      if (removedScore < best - 1e-9) {
        best = removedScore;
        improved = true;
        continue;
      }
      let bestJ = -1;
      let bestScore = best;
      for (let j = 0; j < pool.length; j++) {
        if (j === i && servings[j] + 1 > MAX_SERVINGS) continue;
        if (servings[j] >= MAX_SERVINGS) continue;
        if (servings[j] === 0 && distinctCount(servings) >= MAX_DISTINCT) continue;
        servings[j]++;
        const sc = evaluate(servings);
        servings[j]--;
        if (sc < bestScore - 1e-9) {
          bestScore = sc;
          bestJ = j;
        }
      }
      if (bestJ !== -1) {
        servings[bestJ]++;
        best = bestScore;
        improved = true;
      } else {
        servings[i]++; // undo removal
      }
    }
  }

  const picks = [];
  servings.forEach((count, idx) => {
    if (count > 0) picks.push({ item: pool[idx], servings: count });
  });
  const normalResult = { picks, totals: totalsOf(servings, pool) };
  if (pool.some(x => x.isFlameBreakfast) && picks.some(p => p.item.isFlameBreakfast)) {
    const omelet = buildFlameOmelet(pool, budget, usageMap);
    if (omelet) return omelet;
  }
  picks.sort((a, b) => a.item.station.localeCompare(b.item.station) || b.item.protein - a.item.protein);
  return normalResult;
}

/**
 * Split daily targets across the meal periods actually offered that day.
 * `splits` maps canonical meal -> fraction (e.g. {breakfast:.25,lunch:.35,dinner:.4}).
 * Missing meals redistribute their share to the present ones, but no single
 * sitting is allowed to balloon past 1.6× its normal size — if the cafeteria
 * only published breakfast, we don't tell you to eat the whole day at 8am.
 * "Brunch" absorbs the shares of both breakfast and lunch.
 * Returns {budgets, coverage} where coverage is the fraction of the daily
 * target the available meals can reasonably carry.
 */
export function allocateBudgets(daily, availableMeals, splits) {
  const present = {};
  let covered = 0;

  for (const meal of availableMeals) {
    let share = splits[meal.canonical] ?? 0;
    if (meal.canonical === "brunch") {
      share = (splits.breakfast ?? 0) + (splits.lunch ?? 0);
    }
    present[meal.canonical] = share;
    covered += share;
  }
  if (covered <= 0) {
    const even = 1 / Math.max(1, availableMeals.length);
    availableMeals.forEach((m) => (present[m.canonical] = even));
    covered = 1;
  }

  const budgets = {};
  let coverage = 0;
  for (const meal of availableMeals) {
    const share = present[meal.canonical];
    const frac = Math.min(share / covered, share * 1.6);
    coverage += frac;
    budgets[meal.canonical] = {
      calories: Math.round(daily.calories * frac),
      protein: Math.round(daily.protein * frac),
      fatMax: daily.fatMax != null ? Math.round(daily.fatMax * frac) : null,
      carbMax: daily.carbMax != null ? Math.round(daily.carbMax * frac) : null,
    };
  }
  return { budgets, coverage };
}

/** Map a period name/slug to a canonical meal bucket. */
export function canonicalMeal(period) {
  const s = (period.slug || period.name || "").toLowerCase();
  if (s.includes("brunch")) return "brunch";
  if (s.includes("breakfast")) return "breakfast";
  if (s.includes("lunch")) return "lunch";
  if (s.includes("dinner")) return "dinner";
  return s || "other";
}
