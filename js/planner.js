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
      // La Mesa's DineOnCampus feed often lists a generic "Torta" even when
      // the assembled sandwich is not actually served. Keep real burritos and
      // quesadillas, but never put the generic torta entry in the roster.
      if (/\bla\s*mesa\b/i.test(String(station)) && /\btortas?\b/i.test(String(item.name))) continue;
      if (prefs.vegan && !item.labels.some((l) => /vegan/i.test(l))) continue;
      if (prefs.vegetarian && !item.labels.some((l) => /vegan|vegetarian/i.test(l))) continue;
      if (prefs.avoidAllergens.length &&
          item.allergens.some((a) => prefs.avoidAllergens.some((x) => allergenMatch(a, x)))) continue;
      if (prefs.excluded.has(itemKey(station, item.name))) continue;

      const key = item.name.toLowerCase();
      const stationNorm = String(station).trim().toLowerCase();
      const isFlameBreakfast = prefs.mealCanonical === 'breakfast' && /\bflame\b/.test(stationNorm);
      const isLaMesa = /\bla\s*mesa\b/.test(stationNorm);
      const candidate = { ...item, station, preferredStation: favs.includes(stationNorm), isFlameBreakfast, isLaMesa };
      const existing = chosen.get(key);
      if (!existing || (candidate.preferredStation && !existing.preferredStation) || (candidate.isLaMesa && !existing.isLaMesa)) chosen.set(key, candidate);
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

function buildLaMesaPlate(pool, budget, usageMap, options = {}) {
  const mesa = pool.filter((x) => /\bla\s*mesa\b/i.test(String(x.station)));
  if (!mesa.length) return null;

  const beans = mesa.filter((x) => /\b(bean|beans|frijoles|pinto|refried)\b/i.test(x.name));
  const rice = mesa.filter((x) => /\b(rice|arroz)\b/i.test(x.name));
  const meat = mesa.filter((x) => /\b(chicken|beef|steak|carne|pork|carnitas|barbacoa|turkey|meat|protein)\b/i.test(x.name));
  if (!beans.length || !rice.length || !meat.length) return null;

  const totalOf = (items) => items.reduce((t, p) => {
    t.calories += p.item.calories * p.servings;
    t.protein += p.item.protein * p.servings;
    t.carbs += p.item.carbs * p.servings;
    t.fat += p.item.fat * p.servings;
    return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const varietyPenalty = (picks) => picks.reduce((n, p) => {
    const key = itemKey(p.item.station, p.item.name);
    const resetPenalty = options.avoidKeys?.includes(key) ? 260 * p.servings : 0;
    return n + ((usageMap.get(key) || 0) * 25 * p.servings) + resetPenalty;
  }, 0);

  // Pick one bean + one rice + one meat first. This makes La Mesa behave like
  // the composed meal it actually serves instead of returning a plate made of
  // only rice or only meat.
  let best = null;
  for (const bean of beans) for (const r of rice) for (const m of meat) {
    const picks = [{ item: bean, servings: 1 }, { item: r, servings: 1 }, { item: m, servings: 1 }];
    const totals = totalOf(picks);
    const score = scorePlan(totals, budget, varietyPenalty(picks));
    if (!best || score < best.score - 1e-9 || (options.randomize && score <= best.score + 8 && Math.random() < 0.35)) best = { picks, totals, score };
  }
  if (!best) return null;

  // Add a small amount of extra food only when it improves the macro fit. The
  // required bean/rice/meat trio is never removed by this pass.
  const used = new Map(best.picks.map((p) => [p.item.name.toLowerCase(), p.servings]));
  let picks = best.picks.map((p) => ({ ...p }));
  let totals = { ...best.totals };
  for (let guard = 0; guard < 4; guard++) {
    let bestAdd = null;
    for (const item of mesa) {
      const key = item.name.toLowerCase();
      const count = used.get(key) || 0;
      if (count >= MAX_SERVINGS) continue;
      if (count === 0 && picks.length >= MAX_DISTINCT) continue;
      const trial = [...picks, { item, servings: 1 }];
      const trialTotals = totalOf(trial);
      const trialScore = scorePlan(trialTotals, budget, varietyPenalty(trial));
      if (trialScore < scorePlan(totals, budget, varietyPenalty(picks)) - 1e-9) {
        if (!bestAdd || trialScore < bestAdd.score) bestAdd = { item, trialTotals, score: trialScore };
      }
    }
    if (!bestAdd) break;
    const existing = picks.find((p) => p.item.name.toLowerCase() === bestAdd.item.name.toLowerCase());
    if (existing) existing.servings += 1;
    else picks.push({ item: bestAdd.item, servings: 1 });
    used.set(bestAdd.item.name.toLowerCase(), (used.get(bestAdd.item.name.toLowerCase()) || 0) + 1);
    totals = bestAdd.trialTotals;
  }

  return { picks, totals, laMesaPlate: true };
}

function buildFlameOmelet(pool, budget, usageMap, options = {}) {
  const flame = pool.filter((x) => x.isFlameBreakfast);
  if (!flame.length) return null;
  const eggs = flame.filter((x) => /\b(egg|eggs|whole egg|scrambled egg)\b/i.test(x.name));
  if (!eggs.length) return null;
  const eggCandidates = options.avoidKeys?.length && eggs.some(e => !options.avoidKeys.includes(itemKey(e.station, e.name)))
    ? eggs.filter(e => !options.avoidKeys.includes(itemKey(e.station, e.name)))
    : eggs;
  const egg = options.randomize ? [...eggCandidates].sort(() => Math.random() - 0.5)[0] : eggCandidates.sort((a,b) => a.calories - b.calories)[0];
  const toppings = flame.filter((x) => x !== egg &&
    /bacon|sausage|ham|turkey|chicken|beef|cheese|tomato|onion|pepper|spinach|mushroom|jalape|vegetable|broccoli|avocado/i.test(x.name));
  const base = [{ item: egg, servings: 3 }];
  let total = { calories: egg.calories * 3, protein: egg.protein * 3, carbs: egg.carbs * 3, fat: egg.fat * 3 };
  const chosen = new Set([egg.name.toLowerCase()]);
  const ranked = toppings
    .filter(x => !chosen.has(x.name.toLowerCase()))
    .sort((a,b) => (b.protein - a.protein) - (b.calories - a.calories) * 0.02);
  if (options.randomize && ranked.length > 1) ranked.sort(() => Math.random() - 0.5);
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

export function optimizeMeal(pool, budget, usageMap = new Map(), options = {}) {
  if (!pool.length) return { picks: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };

  // A manual reset first attempts a genuinely new meal by excluding every item
  // from the previous meal. If that leaves too little protein/calorie coverage,
  // the caller can retry without strict exclusion. This prevents a reset from
  // merely changing one low-impact item when the menu has other viable choices.
  if (options.resetStrict && options.avoidKeys?.length) {
    const avoided = new Set(options.avoidKeys);
    const freshPool = pool.filter((item) => !avoided.has(itemKey(item.station, item.name)));
    if (freshPool.length >= 1) {
      const fresh = optimizeMeal(freshPool, budget, usageMap, { ...options, resetStrict: false, avoidKeys: [], _strictPass: true });
      const proteinNeeded = Math.max(10, budget.protein * 0.82);
      const calorieNeeded = Math.max(150, budget.calories * 0.55);
      if (fresh.totals.protein >= proteinNeeded || fresh.totals.calories >= calorieNeeded) return fresh;
    }
  }

  // A reset can request a fresh randomized search order. Normal planning remains
  // deterministic, while repeated manual resets can produce a genuinely different
  // combination when several plans score similarly.
  if (options.randomize) {
    pool = [...pool].sort(() => Math.random() - 0.5);
  }
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
    const totals = totalsOf(sv, pool);
    const overlapPenalty = options.avoidKeys?.length
      ? sv.reduce((sum, count, idx) => {
          if (!count) return sum;
          const key = itemKey(pool[idx].station, pool[idx].name);
          return sum + (options.avoidKeys.includes(key) ? 260 * count : 0);
        }, 0)
      : 0;
    const score = scorePlan(totals, budget, varietyOf(sv), stationPenalty) + overlapPenalty;
    // Manual reset deliberately penalizes reusing foods from the previous meal.
    // The penalty is soft: if an item is genuinely needed to satisfy the protein
    // target, the optimizer may still keep it rather than producing an invalid meal.
    return options.randomize ? score + Math.random() * 14 : score;
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
      if (sc < bestScore - 1e-9 || (options.randomize && Math.abs(sc - bestScore) < 1e-9 && Math.random() < 0.45)) {
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
        if (sc < bestScore - 1e-9 || (options.randomize && Math.abs(sc - bestScore) < 1e-9 && Math.random() < 0.45)) {
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
  if (pool.some(x => /\bla\s*mesa\b/i.test(String(x.station))) && picks.some(p => /\bla\s*mesa\b/i.test(String(p.item.station)))) {
    const plate = buildLaMesaPlate(pool, budget, usageMap, options);
    if (plate) return plate;
  }
  if (pool.some(x => x.isFlameBreakfast) && picks.some(p => p.item.isFlameBreakfast)) {
    const omelet = buildFlameOmelet(pool, budget, usageMap, options);
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
    // Brunch is retained only as a compatibility fallback for older saved plans.
    // New weekend plans use distinct Breakfast/Lunch/Dinner canonical buckets.
    if (meal.canonical === "brunch") share = (splits.breakfast ?? 0) + (splits.lunch ?? 0);
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
