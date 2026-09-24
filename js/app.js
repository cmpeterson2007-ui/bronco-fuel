import { getSchools, getLocations, getPeriods, getMenu } from "./api.js";
import {
  buildCandidatePool,
  optimizeMeal,
  allocateBudgets,
  canonicalMeal,
  itemKey,
  maxServingsForItem,
} from "./planner.js";

/* ---- settings ------------------------------------------------------- */

const DEFAULTS = {
  schoolName: "Boise State University",
  schoolId: null,
  locationName: "Buster's Kitchen",
  locationId: null,
  goals: { calories: 2400, protein: 150, fatMax: null, carbMax: null },
  meals: { breakfast: true, lunch: true, dinner: true },
  splits: { breakfast: 25, lunch: 35, dinner: 40 },
  vegetarian: false,
  vegan: false,
  avoidAllergens: [],
  days: 7,
  planMode: "week",
  planningStyle: "auto",
  favoriteStations: { breakfast: [], lunch: [], dinner: [], brunch: [] },
};

const PRESETS = {
  cut: { calories: 1900, protein: 170, fatMax: 60, carbMax: null },
  maintain: { calories: 2400, protein: 150, fatMax: null, carbMax: null },
  bulk: { calories: 3100, protein: 180, fatMax: null, carbMax: null },
};

const ALLERGENS = ["Milk", "Eggs", "Wheat", "Gluten", "Soy", "Peanuts", "Tree Nuts", "Fish", "Shellfish", "Sesame"];

let settings = loadSettings();
let excluded = new Set(JSON.parse(localStorage.getItem("bf.excluded") || "[]"));
let weekPlan = []; // all generated day plans retained locally
let availableLocations = [];
const collapsedMeals = new Set();
const BUILD_VERSION = 'Manual Planning + Station Serving v17 · 2026-09-24 · 11:30 MDT';
let activeDate = localStorage.getItem("bf.activeDate") || fmtDate(new Date());
const PLAN_STORAGE_KEY = "bf.savedPlan";
function planStorageKey(style = settings.planningStyle || "auto") { return `${PLAN_STORAGE_KEY}.${style}`; }

function planSettingsSignature() {
  return JSON.stringify({
    schoolId: settings.schoolId,
    locationId: settings.locationId,
    planMode: settings.planMode,
    planningStyle: settings.planningStyle || "auto",
    days: settings.days,
    goals: settings.goals,
    meals: settings.meals,
    splits: settings.splits,
    vegetarian: settings.vegetarian,
    vegan: settings.vegan,
    avoidAllergens: [...settings.avoidAllergens].sort(),
    excluded: [...excluded].sort(),
  });
}

function saveSavedPlan() {
  if (!weekPlan.length) return;
  try {
    const style = settings.planningStyle || "auto";
    localStorage.setItem(planStorageKey(style), JSON.stringify({
      savedOn: fmtDate(new Date()),
      planMode: settings.planMode,
      planningStyle: style,
      locationId: settings.locationId,
      signature: planSettingsSignature(),
      activeDate,
      weekPlan,
    }));
    localStorage.setItem("bf.activeDate", activeDate);
  } catch (err) { console.warn("Could not save meal plan locally:", err); }
}

function loadSavedPlan(style = settings.planningStyle || "auto") {
  try {
    let saved = JSON.parse(localStorage.getItem(planStorageKey(style)) || "null");
    // Migrate the v9 single-plan key once when it matches the requested mode.
    if (!saved) {
      const legacy = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || "null");
      if (legacy?.planningStyle === style || (!legacy?.planningStyle && style === "auto")) saved = legacy;
    }
    if (!saved?.weekPlan?.length) return false;
    if (saved.locationId && settings.locationId && saved.locationId !== settings.locationId) return false;
    if (saved.signature !== planSettingsSignature()) return false;
    weekPlan = saved.weekPlan;
    activeDate = saved.activeDate || activeDate;
    localStorage.setItem("bf.activeDate", activeDate);
    return true;
  } catch { return false; }
}

function clearSavedPlan(style = settings.planningStyle || "auto") {
  localStorage.removeItem(planStorageKey(style));
  weekPlan = [];
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("bf.settings") || "{}");
    return {
      ...DEFAULTS,
      ...saved,
      goals: { ...DEFAULTS.goals, ...(saved.goals || {}) },
      meals: { ...DEFAULTS.meals, ...(saved.meals || {}) },
      splits: { ...DEFAULTS.splits, ...(saved.splits || {}) },
      favoriteStations: { ...DEFAULTS.favoriteStations, ...(saved.favoriteStations || {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  localStorage.setItem("bf.settings", JSON.stringify(settings));
}

function saveExcluded() {
  localStorage.setItem("bf.excluded", JSON.stringify([...excluded]));
}

function clearManualRemovedKeys(plan) {
  for (const day of (plan || [])) {
    for (const meal of (day.meals || [])) delete meal.manualRemovedKeys;
  }
}

function resetExcludedItems() {
  excluded = new Set();
  saveExcluded();

  // Manual-plan removals are temporary choices, not permanent exclusions.
  // Clear any legacy manualRemovedKeys from the active plan as well.
  clearManualRemovedKeys(weekPlan);
  if (weekPlan.length) saveSavedPlan();

  // Also repair a saved manual plan that may have been polluted by the old bug,
  // so switching back to manual mode does not resurrect the exclusions.
  try {
    const key = planStorageKey('manual');
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved?.weekPlan?.length) {
      clearManualRemovedKeys(saved.weekPlan);
      localStorage.setItem(key, JSON.stringify(saved));
    }
  } catch (err) { console.warn('Could not repair saved manual plan:', err); }

  renderWeek();
  setStatus("Cleared your excluded-items list and restored manually removed foods.", "info");
  setTimeout(() => setStatus(""), 2500);
}

/* ---- tiny DOM helpers ------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "hidden") el[k] = Boolean(v);
    else if (k === "value") el.value = v ?? "";
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function setStatus(msg, kind = "info") {
  const el = $("#status");
  el.textContent = msg || "";
  el.className = `status ${kind}`;
  el.hidden = !msg;
}

function applyTheme(theme) {
  const value = ["light","tan","dark"].includes(theme) ? theme : "light";
  document.body.dataset.theme = value;
  const sel = $("#theme-select"); if (sel) sel.value = value;
  localStorage.setItem("bf.theme", value);
}

function bindTheme() {
  const sel = $("#theme-select"); if (!sel) return;
  applyTheme(localStorage.getItem("bf.theme") || "light");
  sel.addEventListener("change", () => applyTheme(sel.value));
}

/* ---- date utils ------------------------------------------------------ */

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/* ---- setup UI -------------------------------------------------------- */

async function initPickers() {
  const schoolSel = $("#school");
  const locSel = $("#location");
  try {
    setStatus("Loading schools…");
    const schools = await getSchools();
    schools.sort((a, b) => a.name.localeCompare(b.name));
    schoolSel.replaceChildren(...schools.map((s) => h("option", { value: s.id }, s.name)));

    let school =
      schools.find((s) => s.id === settings.schoolId) ||
      schools.find((s) => s.name.toLowerCase().includes("boise state")) ||
      schools[0];
    schoolSel.value = school.id;
    settings.schoolId = school.id;
    settings.schoolName = school.name;

    await refreshLocations();
    if (loadSavedPlan()) renderWeek();
    setStatus("");
  } catch (err) {
    setStatus(
      "Couldn't reach the DineOnCampus menu service. Check your connection and hit Retry. " +
        `(${err.message})`,
      "error"
    );
    $("#retry").hidden = false;
    if (loadSavedPlan()) renderWeek();
  }

  schoolSel.addEventListener("change", async () => {
    settings.schoolId = schoolSel.value;
    settings.schoolName = schoolSel.selectedOptions[0]?.textContent || "";
    settings.locationId = null;
    await refreshLocations();
    saveSettings();
  });
  locSel.addEventListener("change", () => {
    settings.locationId = locSel.value;
    settings.locationName = locSel.selectedOptions[0]?.textContent || "";
    saveSettings();
  });
}

async function refreshLocations() {
  const locSel = $("#location");
  locSel.replaceChildren(h("option", {}, "Loading…"));
  const locs = await getLocations(settings.schoolId);
  locs.sort((a, b) => a.name.localeCompare(b.name));
  availableLocations = locs;
  locSel.replaceChildren(...locs.map((l) => h("option", { value: l.id }, l.name)));
  const loc =
    locs.find((l) => l.id === settings.locationId) ||
    locs.find((l) => l.name.toLowerCase().includes("buster")) ||
    locs[0];
  if (loc) {
    locSel.value = loc.id;
    settings.locationId = loc.id;
    settings.locationName = loc.name;
  }
  saveSettings();
}

function bindGoalInputs() {
  const cal = $("#cal"), pro = $("#protein"), fat = $("#fatmax"), carb = $("#carbmax");
  cal.value = settings.goals.calories;
  pro.value = settings.goals.protein;
  fat.value = settings.goals.fatMax ?? "";
  carb.value = settings.goals.carbMax ?? "";

  const sync = () => {
    settings.goals.calories = Math.max(800, parseInt(cal.value, 10) || DEFAULTS.goals.calories);
    settings.goals.protein = Math.max(20, parseInt(pro.value, 10) || DEFAULTS.goals.protein);
    settings.goals.fatMax = fat.value ? Math.max(10, parseInt(fat.value, 10)) : null;
    settings.goals.carbMax = carb.value ? Math.max(20, parseInt(carb.value, 10)) : null;
    saveSettings();
  };
  [cal, pro, fat, carb].forEach((el) => el.addEventListener("change", sync));

  const planMode = $("#plan-mode");
  if (planMode) {
    planMode.value = settings.planMode || "week";
    planMode.addEventListener("change", () => {
      settings.planMode = planMode.value;
      saveSettings();
      updatePlanningButtons();
    });
  }

  document.querySelectorAll("[data-preset]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = PRESETS[btn.dataset.preset];
      settings.goals = { ...p };
      cal.value = p.calories;
      pro.value = p.protein;
      fat.value = p.fatMax ?? "";
      carb.value = p.carbMax ?? "";
      saveSettings();
    })
  );

  for (const meal of ["breakfast", "lunch", "dinner"]) {
    const cb = $(`#meal-${meal}`);
    const split = $(`#split-${meal}`);
    cb.checked = settings.meals[meal];
    split.value = settings.splits[meal];
    cb.addEventListener("change", () => {
      settings.meals[meal] = cb.checked;
      saveSettings();
    });
    split.addEventListener("change", () => {
      settings.splits[meal] = Math.max(5, Math.min(80, parseInt(split.value, 10) || 33));
      saveSettings();
    });
  }

  $("#veg").checked = settings.vegetarian;
  $("#vegan").checked = settings.vegan;
  $("#veg").addEventListener("change", (e) => { settings.vegetarian = e.target.checked; saveSettings(); });
  $("#vegan").addEventListener("change", (e) => { settings.vegan = e.target.checked; saveSettings(); });

  const wrap = $("#allergens");
  wrap.replaceChildren(
    ...ALLERGENS.map((a) => {
      const active = settings.avoidAllergens.includes(a);
      const chip = h(
        "button",
        {
          class: `chip ${active ? "chip-on" : ""}`,
          type: "button",
          onclick: () => {
            const i = settings.avoidAllergens.indexOf(a);
            if (i >= 0) settings.avoidAllergens.splice(i, 1);
            else settings.avoidAllergens.push(a);
            chip.classList.toggle("chip-on");
            saveSettings();
          },
        },
        a
      );
      return chip;
    })
  );
}


/* ---- meal extras ------------------------------------------------------ */

/* Produce is selected from the foods actually returned by DineOnCampus.
 * We use conservative name/description matching so the app never invents a
 * fruit or vegetable that the cafeteria did not publish for that meal. */
const FRUIT_WORDS = /\b(apple|apples|apricot|apricots|banana|bananas|berry|berries|blackberries|blueberries|cantaloupe|cherries|cherry|clementine|clementines|cranberries|grape|grapes|honeydew|kiwi|mango|melon|nectarine|orange|oranges|papaya|peach|peaches|pear|pears|pineapple|plum|plums|raspberries|strawberries|watermelon|fruit cup|fruit salad)\b/i;
const VEG_WORDS = /\b(asparagus|beet|beets|broccoli|brussels sprouts|cabbage|carrot|carrots|cauliflower|celery|collard|corn|cucumber|eggplant|green beans?|greens|kale|lettuce|mixed vegetables|mushrooms?|okra|onions?|peas|peppers?|potatoes?|spinach|squash|sweet potato|tomatoes?|vegetables?|zucchini|side salad|garden salad|mixed greens)\b/i;
const DESSERT_WORDS = /\b(pudding|cake|cookie|brownie|ice cream|dessert|pie|pastry|muffin|donut|doughnut|candy|cobbler|crisp|sweet treat)\b/i;
const CONDIMENT_WORDS = /\b(juice|sauce|syrup|dressing|vinaigrette|relish|chutney|jelly|jam|glaze|lemon juice|lime juice)\b/i;
// A vegetable word in the name is not enough: these are common cases where
// the vegetable is an ingredient/flavoring rather than a vegetable serving.
const NON_VEG_ITEM_WORDS = /\b(tortilla|wrap|flatbread|bread|bun|roll|crust|pizza|sandwich|quesadilla|burrito|taco|chips?|cracker|seasoning|spice|powder|flakes?|crushed|dried herb|herb blend|stuffing|stuffed)\b/i;

function classifyProduce(item) {
  // Use the published menu item's NAME first. Description-only matches can
  // turn ingredients/condiments into fake produce choices.
  const name = String(item?.name || '').trim();
  if (!name || DESSERT_WORDS.test(name) || CONDIMENT_WORDS.test(name)) return null;
  if (FRUIT_WORDS.test(name)) return 'fruit';
  if (VEG_WORDS.test(name) && !NON_VEG_ITEM_WORDS.test(name)) return 'vegetable';
  return null;
}

function isRecommendedProduce(item, type) {
  const n = item.name.toLowerCase();
  if (type === 'fruit') return /blueberr|strawberr|raspberr|blackberr|orange|grapefruit|kiwi|melon|pineapple/.test(n);
  return /broccoli|spinach|kale|greens|carrot|cauliflower|cabbage|asparagus|pepper|mixed vegetables/.test(n);
}

function produceOptions(stations, type) {
  const seen = new Set();
  const out = [];
  for (const { station, items } of stations || []) {
    for (const item of items || []) {
      const name = String(item?.name || '').trim();
      if (!item?.hasNutrition || !name) continue;
      if (classifyProduce(item) !== type) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, station, recommended: isRecommendedProduce(item, type) });
    }
  }
  out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
  return out;
}

const DRINK_OPTIONS = [
  { name: 'Water', portion: '12 fl oz', calories: 0, protein: 0, carbs: 0, fat: 0, recommended: true },
  { name: 'Skim milk', portion: '1 cup', calories: 83, protein: 8.3, carbs: 12.2, fat: 0.2 },
  { name: 'Whole milk', portion: '1 cup', calories: 149, protein: 7.7, carbs: 11.7, fat: 8.0 },
  { name: 'Chocolate milk', portion: '1 cup', calories: 190, protein: 8, carbs: 30, fat: 5 },
  { name: 'Orange juice', portion: '8 fl oz', calories: 112, protein: 1.7, carbs: 26, fat: 0.3 },
  { name: 'Apple juice', portion: '8 fl oz', calories: 114, protein: 0.2, carbs: 28, fat: 0.3 },
  { name: 'Coca-Cola', portion: '12 fl oz', calories: 140, protein: 0, carbs: 39, fat: 0 },
  { name: 'Pepsi', portion: '12 fl oz', calories: 150, protein: 0, carbs: 41, fat: 0 },
  { name: 'Diet Coke', portion: '12 fl oz', calories: 0, protein: 0, carbs: 0, fat: 0 },
  { name: 'Diet Pepsi', portion: '12 fl oz', calories: 0, protein: 0, carbs: 0, fat: 0 },
  { name: 'Powerade', portion: '20 fl oz', calories: 130, protein: 0, carbs: 34, fat: 0 },
];

function drinkOptions() {
  return DRINK_OPTIONS.filter((item) => {
    if (/milk/i.test(item.name) && (settings.vegan || settings.avoidAllergens.includes('Milk'))) return false;
    return true;
  });
}

function cloneExtra(item) {
  return item ? { ...item, hasNutrition: true } : null;
}

function buildMealExtras(stations) {
  const fruits = produceOptions(stations, 'fruit');
  const vegetables = produceOptions(stations, 'vegetable');
  const drinks = drinkOptions();
  return {
    fruits: [],
    vegetables: [],
    drinks: [],
    options: { fruit: fruits, vegetable: vegetables, drink: drinks },
  };
}

function extrasTotals(extras) {
  const all = [
    ...(extras?.fruits || []),
    ...(extras?.vegetables || []),
    ...(extras?.drinks || []),
  ];
  return all.reduce((t, item) => {
    t.calories += item.calories || 0; t.protein += item.protein || 0;
    t.carbs += item.carbs || 0; t.fat += item.fat || 0; return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function combinedTotals(mainTotals, extras) {
  const e = extrasTotals(extras);
  return { calories: mainTotals.calories + e.calories, protein: mainTotals.protein + e.protein, carbs: mainTotals.carbs + e.carbs, fat: mainTotals.fat + e.fat };
}

function recomputeMeal(day, meal) {
  const extraT = extrasTotals(meal.result.extras);
  const mainBudget = {
    calories: Math.max(200, meal.budget.calories - extraT.calories),
    protein: Math.max(10, meal.budget.protein - extraT.protein),
    fatMax: meal.budget.fatMax == null ? null : Math.max(5, meal.budget.fatMax - extraT.fat),
    carbMax: meal.budget.carbMax == null ? null : Math.max(10, meal.budget.carbMax - extraT.carbs),
  };
  const pool = buildCandidatePool(meal.stations, { ...prefs(), mealCanonical: meal.canonical });
  const result = optimizeMeal(pool, mainBudget, new Map());
  result.mainTotals = result.totals;
  result.extras = meal.result.extras;
  result.totals = combinedTotals(result.totals, result.extras);
  meal.result = result;
}

function mealMainTotals(meal) {
  return meal.result?.mainTotals || { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

function currentMealTotalCalories(meal) {
  return Number(meal.result?.totals?.calories) || 0;
}

function extraRemovalOptions(meal) {
  const foods = (meal.result?.picks || []).map((pick, index) => ({
    kind: 'food', index,
    name: pick.item.name,
    protein: Number(pick.item.protein || 0) * Number(pick.servings || 1),
    calories: Number(pick.item.calories || 0) * Number(pick.servings || 1),
    label: `${pick.servings}× ${pick.item.name}`,
  }));
  const extras = [];
  for (const type of ['fruits', 'vegetables', 'drinks']) {
    for (let index = 0; index < (meal.result?.extras?.[type] || []).length; index++) {
      const item = meal.result.extras[type][index];
      extras.push({ kind: 'extra', type, index, name: item.name,
        protein: Number(item.protein || 0), calories: Number(item.calories || 0), label: item.name });
    }
  }
  return [...foods, ...extras].sort((a, b) => a.protein - b.protein || a.calories - b.calories || a.label.localeCompare(b.label));
}

function removeMealItemForExtra(day, meal, option) {
  if (option.kind === 'food') {
    const pick = meal.result.picks[option.index];
    if (!pick) return;
    meal.manualRemovedKeys = [...new Set([...(meal.manualRemovedKeys || []), itemKey(pick.item.station, pick.item.name)])];
    meal.result.picks.splice(option.index, 1);
    manualMealTotals(meal);
  } else {
    const list = meal.result.extras?.[option.type] || [];
    list.splice(option.index, 1);
    manualMealTotals(meal);
  }
}

function laterMealSequence(day, meal) {
  const result = [];
  const days = [...weekPlan].sort((a, b) => a.date.localeCompare(b.date));
  let found = false;
  for (const d of days) {
    for (const m of (d.meals || [])) {
      if (d.date === day.date && m === meal) { found = true; continue; }
      if (found) result.push({ day: d, meal: m });
    }
  }
  return result;
}

function shiftCaloriesToLaterMeal(day, meal, calories) {
  let remaining = Math.max(0, Math.round(calories));
  if (!remaining) return;
  for (const { day: laterDay, meal: laterMeal } of laterMealSequence(day, meal)) {
    if (remaining <= 0 || isMealEaten(laterDay, laterMeal)) continue;
    const planned = (laterMeal.result?.picks || []).length > 0;
    if (!planned) {
      const oldBudget = Number(laterMeal.budget?.calories) || 0;
      const cut = Math.min(remaining, Math.max(0, oldBudget));
      laterMeal.budget.calories = Math.max(0, oldBudget - cut);
      laterMeal.calorieAdjustment = `* This meal has been adjusted due to having too many calories in ${meal.periodName}.`;
      remaining -= cut;
    } else {
      laterMeal.calorieOverallocated = true;
      laterMeal.calorieAdjustment = `* This meal is overallocated for calories because ${meal.periodName} used ${remaining.toLocaleString()} extra calories.`;
      remaining = 0;
    }
  }
  if (remaining > 0) {
    meal.calorieOverflowUnallocated = remaining;
  }
}

function shiftUnusedCaloriesToLaterMeal(day, meal, calories) {
  let remaining = Math.max(0, Math.round(calories));
  if (!remaining) return;
  for (const { day: laterDay, meal: laterMeal } of laterMealSequence(day, meal)) {
    if (remaining <= 0 || isMealEaten(laterDay, laterMeal)) continue;

    // Move the unused calories into the next available meal's budget. This is
    // an allocation change, not a re-plan, so already-selected foods stay put.
    const oldBudget = Number(laterMeal.budget?.calories) || 0;
    laterMeal.budget.calories = oldBudget + remaining;
    laterMeal.calorieAdjustment = `* This meal has been adjusted because ${meal.periodName} used ${remaining.toLocaleString()} fewer calories than planned.`;
    remaining = 0;
  }
  if (remaining > 0) {
    meal.calorieOverflowUnallocated = remaining;
  }
}

function addExtraWithoutReplanning(day, meal, item, type, selected) {
  selected.push(cloneExtra(item));
  manualMealTotals(meal);
  return item.calories || 0;
}

function requestExtraAdd(day, meal, item, type, label, selected) {
  if (isPastDate(day.date) || isMealEaten(day, meal)) return;
  // Manual planning must remain manual. Adding an extra never invokes the AI optimizer.
  if (meal.result?.manual || settings.planningStyle === 'manual') {
    const projected = currentMealTotalCalories(meal) + Number(item.calories || 0);
    const over = Math.max(0, projected - (Number(meal.budget?.calories) || 0));
    if (over <= 0) {
      addExtraWithoutReplanning(day, meal, item, type, selected);
      renderWeek(); saveSavedPlan();
      return;
    }
    openExtraOverflowDialog(day, meal, item, type, label, selected, over);
    return;
  }
  selected.push(cloneExtra(item));
  recomputeMeal(day, meal);
  renderWeek(); saveSavedPlan();
}

function openExtraOverflowDialog(day, meal, item, type, label, selected, over) {
  document.querySelector('.extra-overflow-overlay')?.remove();
  const options = extraRemovalOptions(meal);
  const overlay = h('div', { class: 'extra-overflow-overlay', role: 'dialog', 'aria-modal': 'true' });
  const card = h('div', { class: 'extra-overflow-card' });
  const close = () => overlay.remove();
  const addAfterRemoval = (option) => {
    removeMealItemForExtra(day, meal, option);
    selected.push(cloneExtra(item));
    manualMealTotals(meal);
    close(); renderWeek(); saveSavedPlan();
  };
  const rows = options.map((option) => h('button', { type: 'button', class: 'extra-removal-option', onclick: () => addAfterRemoval(option) },
    h('span', {}, option.label),
    h('span', { class: 'extra-removal-stats' }, `${Math.round(option.protein)}g protein · ${Math.round(option.calories)} cal`)
  ));
  const override = h('button', { type: 'button', class: 'primary extra-overflow-override', onclick: () => {
    selected.push(cloneExtra(item));
    manualMealTotals(meal);
    shiftCaloriesToLaterMeal(day, meal, over);
    close(); renderWeek(); saveSavedPlan();
  }}, `Add ${item.name} anyway`);
  const cancel = h('button', { type: 'button', class: 'extra-overflow-cancel', onclick: close }, 'Cancel');
  card.append(
    h('div', { class: 'extra-overflow-title' }, `Too many calories for ${meal.periodName}`),
    h('div', { class: 'extra-overflow-copy' }, `Adding ${item.name} would put this meal ${Math.round(over)} calories over its limit. You must remove an item to add it, or override the limit.`),
    options.length ? h('div', { class: 'extra-overflow-subtitle' }, 'Remove an item — least to most protein') : h('div', { class: 'extra-overflow-subtitle' }, 'There are no items available to remove.'),
    h('div', { class: 'extra-removal-list' }, ...rows),
    override,
    cancel
  );
  overlay.append(card);
  document.body.append(overlay);
}

function renderExtraSelector(day, meal, type, label, icon) {
  const options = meal.result.extras.options?.[type] || [];
  if (type === 'drink') return renderDrinkAdder(day, meal, label, icon, options);
  return renderProduceAdder(day, meal, type, label, icon, options);
}

function renderProduceAdder(day, meal, type, label, icon, options) {
  const locked = isPastDate(day.date);
  const key = type === 'fruit' ? 'fruits' : 'vegetables';
  const selected = meal.result.extras[key] || (meal.result.extras[key] = []);
  const select = h('select', { class: 'extra-select', disabled: locked },
    h('option', { value: '' }, `Choose ${label.toLowerCase()} to add…`),
    ...options.map(x => h('option', { value: x.name }, `${x.name} — ${x.station}${x.recommended ? ' — ⭐ Best choice' : ''}`))
  );
  const add = h('button', { type:'button', class:'add-drink', disabled: locked || !options.length, onclick: () => {
    const item = options.find(x => x.name === select.value); if (!item) return;
    select.value = '';
    requestExtraAdd(day, meal, item, type, label, selected);
  }}, '+ Add');
  const rows = selected.length ? selected.map((item, i) => h('div',{class:'drink-row'},
    h('span',{},`${item.name} · ${Math.round(item.calories)} cal${item.protein?` · ${Math.round(item.protein)}g protein`:''}`),
    !locked ? h('button',{type:'button',class:'drink-remove',title:`Remove ${label.toLowerCase()}`,onclick:()=>{ selected.splice(i,1); recomputeMeal(day,meal); renderWeek(); saveSavedPlan(); }},'✕') : null
  )) : [h('div',{class:'dim small'}, options.length ? `No ${label.toLowerCase()} added yet.` : `No ${label.toLowerCase()} options found on the DineOnCampus menu.`)];
  return h('div',{class:'meal-extra drink-extra'},
    h('div',{class:'extra-label'},`${icon} ${label}`),
    h('div',{class:'drink-add-row'},select,add),
    h('div',{class:'drink-list'},...rows)
  );
}

function renderDrinkAdder(day, meal, label, icon, options) {
  const locked = isPastDate(day.date);
  const drinks = meal.result.extras.drinks || (meal.result.extras.drinks = []);
  const select = h('select', { class: 'extra-select', disabled: locked }, h('option', { value: '' }, 'Choose a drink to add…'), ...options.map(x => h('option', { value: x.name }, `${x.name}${x.recommended ? ' — ⭐ Best choice' : ''}`)));
  const add = h('button', { type:'button', class:'add-drink', disabled: locked, onclick: () => {
    const item = options.find(x => x.name === select.value); if (!item) return;
    select.value = '';
    requestExtraAdd(day, meal, item, 'drink', label, drinks);
  }}, '+ Add drink');
  const rows = drinks.length ? drinks.map((d, i) => h('div',{class:'drink-row'}, h('span',{},`${d.name} · ${Math.round(d.calories)} cal${d.protein?` · ${Math.round(d.protein)}g protein`:''}`), !locked ? h('button',{type:'button',class:'drink-remove',title:'Remove drink',onclick:()=>{ drinks.splice(i,1); recomputeMeal(day,meal); renderWeek(); saveSavedPlan(); }},'✕'):null)) : [h('div',{class:'dim small'},'No drink added yet.')];
  return h('div',{class:'meal-extra drink-extra'},h('div',{class:'extra-label'},`${icon} ${label}`),h('div',{class:'drink-add-row'},select,add),h('div',{class:'drink-list'},...rows));
}



function renderStationPreferences() {
  const wrap = $('#station-preference-options');
  if (!wrap) return;
  const byMeal = new Map();
  for (const day of weekPlan || []) for (const meal of day.meals || []) {
    const key = meal.canonical || canonicalMeal({ name: meal.periodName });
    if (!byMeal.has(key)) byMeal.set(key, new Set());
    for (const st of meal.stations || []) if (st.station) byMeal.get(key).add(st.station);
  }
  if (!byMeal.size) { wrap.replaceChildren(h('div',{class:'dim small'},'Station choices will appear after a menu has been loaded. Build a plan once, then choose your favorites here for future plans.')); return; }
  const labels={breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',brunch:'Brunch'};
  const groups=[];
  for (const [meal, set] of byMeal.entries()) {
    const chosen=settings.favoriteStations?.[meal] || [];
    groups.push(h('div',{class:'station-pref-group'},h('strong',{},labels[meal]||meal),...Array.from(set).sort().map(st=>{
      const cb=h('input',{type:'checkbox',checked:chosen.includes(st)});
      cb.addEventListener('change',()=>{
        const arr=settings.favoriteStations[meal] || (settings.favoriteStations[meal]=[]);
        const i=arr.indexOf(st); if(cb.checked && i<0) arr.push(st); if(!cb.checked && i>=0) arr.splice(i,1);
        saveSettings();
      });
      return h('label',{class:'check station-pref-check'},cb,h('span',{},st));
    })));
  }
  wrap.replaceChildren(...groups);
}

/* ---- plan building --------------------------------------------------- */


function prefs() {
  return {
    vegetarian: settings.vegetarian,
    vegan: settings.vegan,
    avoidAllergens: settings.avoidAllergens,
    excluded,
    favoriteStations: settings.favoriteStations || {},
  };
}

function exerciseEntriesForDate(dateStr) {
  try { return JSON.parse(localStorage.getItem("bf.exercise") || "[]").filter((x) => x.date === dateStr); } catch { return []; }
}

function exerciseSummary(dateStr) {
  const entries = exerciseEntriesForDate(dateStr);
  return entries.reduce((t, e) => {
    t.calories += Number(e.calories) || 0;
    t.protein += Number(e.proteinAdd) || 0;
    t.carbs += Number(e.carbAdd) || 0;
    return t;
  }, { calories: 0, protein: 0, carbs: 0 });
}

function dailyTargets(dateStr) {
  const ex = exerciseSummary(dateStr);
  return {
    calories: settings.goals.calories + ex.calories,
    protein: settings.goals.protein + ex.protein,
    fatMax: settings.goals.fatMax,
    carbMax: settings.goals.carbMax == null ? null : settings.goals.carbMax + ex.carbs,
  };
}

function splitFractions() {
  const total =
    (settings.meals.breakfast ? settings.splits.breakfast : 0) +
    (settings.meals.lunch ? settings.splits.lunch : 0) +
    (settings.meals.dinner ? settings.splits.dinner : 0);
  const f = (m) => (settings.meals[m] ? settings.splits[m] / (total || 1) : 0);
  return { breakfast: f("breakfast"), lunch: f("lunch"), dinner: f("dinner") };
}

function isWeekendDate(dateStr) {
  // Parse at noon so the result is stable regardless of timezone/DST.
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function periodText(period) {
  return `${period?.name || ''} ${period?.slug || ''}`.trim().toLowerCase();
}

function isNonMealVariant(period) {
  return /late|early|second|extended/i.test(periodText(period));
}

function chooseOrdinaryPeriod(periods, matcher) {
  const matches = (periods || []).filter(matcher);
  return matches.find((p) => !isNonMealVariant(p)) || matches[0] || null;
}

function selectThreeMealPeriods(periods, dateStr = activeDate) {
  const list = Array.isArray(periods) ? periods : [];
  const weekend = isWeekendDate(dateStr);

  /*
   * IMPORTANT: Do not derive weekend meal cards from the canonical meal
   * buckets alone. DineOnCampus has historically returned Buster's weekend
   * periods as Brunch + Dinner. The older working build explicitly selected
   * the Brunch period first; later versions accidentally made Breakfast/Lunch
   * depend on canonical classification and could therefore drop both cards.
   *
   * The planner now has three distinct weekend meals, but Breakfast and Lunch
   * are allowed to share the exact same published Brunch period. That keeps
   * the source period ID intact while giving the user three independent meal
   * cards/budgets/history entries.
   */
  if (weekend) {
    const brunch = chooseOrdinaryPeriod(list, (p) => /brunch/i.test(periodText(p)));
    const breakfast = chooseOrdinaryPeriod(list, (p) => /breakfast/i.test(periodText(p)));
    const lunch = chooseOrdinaryPeriod(list, (p) => /\blunch\b/i.test(periodText(p)) && !/late|second|extended/i.test(periodText(p)));
    const dinner = chooseOrdinaryPeriod(list, (p) => /dinner/i.test(periodText(p)));

    // Source-menu priority for the first two weekend meals:
    // 1) explicit Breakfast/Lunch if published
    // 2) the published Brunch menu
    // 3) the other ordinary daytime menu as a last-resort fallback
    const breakfastSource = breakfast || brunch || lunch;
    const lunchSource = lunch || brunch || breakfast;

    return [
      breakfastSource ? { period: breakfastSource, canonical: 'breakfast', displayCanonical: 'breakfast', periodName: 'Breakfast' } : null,
      lunchSource ? { period: lunchSource, canonical: 'lunch', displayCanonical: 'lunch', periodName: 'Lunch' } : null,
      dinner ? { period: dinner, canonical: 'dinner', displayCanonical: 'dinner', periodName: 'Dinner' } : null,
    ].filter(Boolean);
  }

  // Weekdays retain the normal Breakfast/Lunch/Dinner behavior.
  return [
    chooseOrdinaryPeriod(list, (p) => /breakfast/i.test(periodText(p))),
    chooseOrdinaryPeriod(list, (p) => /\blunch\b/i.test(periodText(p)) && !/late|second|extended/i.test(periodText(p))),
    chooseOrdinaryPeriod(list, (p) => /dinner/i.test(periodText(p))),
  ].filter(Boolean).map((period) => ({ period, canonical: canonicalMeal(period) }));
}

function selectPeriodForMeal(periods, canonical, dateStr = activeDate) {
  const list = periods || [];
  const matches = list.filter((p) => canonicalMeal(p) === canonical);
  const isVariant = (p) => /late|early|second|extended/i.test(`${p.name || ''} ${p.slug || ''}`);
  const exact = matches.find((p) => !isVariant(p)) || matches[0];
  if (exact) return exact;

  // Weekend dining halls may publish one Brunch period instead of separate
  // Breakfast/Lunch periods. Breakfast and Lunch are still distinct planner
  // meals, but both may legitimately draw from that same published menu.
  if (canonical === 'breakfast' || canonical === 'lunch') {
    // Weekend dining halls commonly publish Brunch instead of separate
    // Breakfast/Lunch periods. Treat that published period as valid for both
    // planner cards, regardless of the synthetic card name.
    const brunch = list.find((p) => /brunch/i.test(`${p.name || ''} ${p.slug || ''}`));
    if (brunch) return brunch;
  }

  // Campus retail/restaurant locations commonly publish one "All Day" period
  // instead of separate Breakfast/Lunch/Dinner periods. Treat that period as
  // valid for whichever meal the user assigned this location to.
  const allDay = list.find((p) => /all[ -]?day/i.test(`${p.name || ''} ${p.slug || ''}`));
  if (allDay) return allDay;

  // Some campus retail locations have historically returned a single period
  // with a nonstandard name. If there is exactly one period and it did not map
  // to a meal-specific period, it is still the location's only published menu
  // and should be usable for the selected meal.
  if (list.length === 1) return list[0];
  return null;
}

function budgetAfterExtras(budget, extras) {
  const extraT = extrasTotals(extras);
  return {
    calories: Math.max(200, budget.calories - extraT.calories),
    protein: Math.max(10, budget.protein - extraT.protein),
    fatMax: budget.fatMax == null ? null : Math.max(5, budget.fatMax - extraT.fat),
    carbMax: budget.carbMax == null ? null : Math.max(10, budget.carbMax - extraT.carbs),
  };
}

function locationNameFor(id) {
  return availableLocations.find((x) => String(x.id) === String(id))?.name || settings.locationName || 'Dining location';
}

async function buildMealAtLocation(dateStr, canonical, budget, locationId, usage = new Map(), options = {}) {
  // Use an already-selected published period when one is available. This is
  // critical on weekends: Breakfast and Lunch can be two planner cards that
  // intentionally share the same published Brunch period. Re-querying by the
  // synthetic card name can otherwise reject a perfectly valid menu.
  let period = options.period || null;
  if (!period) {
    const periods = await getPeriods(locationId, dateStr);
    period = selectPeriodForMeal(periods, canonical, dateStr);
  }
  if (!period) throw new Error(`No ${canonical} menu is published at ${locationNameFor(locationId)} for this date.`);
  const stations = await getMenu(locationId, dateStr, period.id);
  const extras = buildMealExtras(stations);
  const mainBudget = budgetAfterExtras(budget, extras);
  const pool = buildCandidatePool(stations, { ...prefs(), mealCanonical: canonical });
  const manual = options.manual === true;
  const result = manual
    ? { picks: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } }
    : optimizeMeal(pool, mainBudget, usage, options);
  result.mainTotals = result.totals;
  result.manual = manual;
  result.extras = extras;
  result.manualPool = pool;
  result.totals = combinedTotals(result.totals, extras);
  return {
    periodName: canonical[0].toUpperCase() + canonical.slice(1),
    sourcePeriodName: period.name,
    periodId: period.id,
    canonical,
    budget,
    locationId,
    locationName: locationNameFor(locationId),
    stations,
    result,
  };
}

async function buildWeek(manualOverride = null) {
  const manual = manualOverride == null ? settings.planningStyle === 'manual' : manualOverride;
  if (!settings.locationId) {
    setStatus("Pick a school and dining location first.", "error");
    return;
  }
  const planButtons = [$("#plan-auto"), $("#plan-manual")].filter(Boolean);
  planButtons.forEach((button) => { button.disabled = true; });
  activeDate = fmtDate(new Date());
  localStorage.setItem("bf.activeDate", activeDate);
  clearSavedPlan(manual ? "manual" : "auto");
  $("#results").replaceChildren();

  const usage = new Map(); // itemKey -> count across the week, for variety
  const splits = splitFractions();
  try {
    const daysToPlan = settings.planMode === "today" ? 1 : settings.days;
    for (let i = 0; i < daysToPlan; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = fmtDate(d);
      setStatus(`Planning ${dayLabel(d)} (${i + 1}/${daysToPlan})…`);

      let periods;
      try {
        periods = await getPeriods(settings.locationId, dateStr);
      } catch {
        weekPlan.push({ date: dateStr, label: dayLabel(d), meals: [], note: "No menu published for this day yet." });
        continue;
      }

      const dayMeals = selectThreeMealPeriods(periods, dateStr);

      if (!dayMeals.length) {
        weekPlan.push({ date: dateStr, label: dayLabel(d), meals: [], note: "No matching meal periods this day." });
        continue;
      }

      const { budgets, coverage } = allocateBudgets(
        dailyTargets(dateStr),
        dayMeals.map((m) => ({ canonical: m.canonical })),
        splits
      );

      const meals = [];
      for (const { period, canonical } of dayMeals) {
        let stations = [];
        try {
          stations = await getMenu(settings.locationId, dateStr, period.id);
        } catch { /* leave empty; rendered as unavailable */ }
        const budget = budgets[canonical];
        const meal = await buildMealAtLocation(dateStr, canonical, budget, settings.locationId, usage, { period, manual });
        for (const pick of meal.result.picks) {
          const k = itemKey(pick.item.station, pick.item.name);
          usage.set(k, (usage.get(k) || 0) + 1);
        }
        meals.push(meal);
        await new Promise((r) => setTimeout(r, 150)); // be polite to the API
      }
      weekPlan.push({
        date: dateStr,
        label: dayLabel(d),
        meals,
        note:
          coverage < 0.85
            ? "Only some meals are published for this day, so the plan covers less than your full daily target."
            : null,
      });
      renderWeek(); // progressive render as days finish
      saveSavedPlan();
    }
    setStatus("");
    renderWeek();
    if (!weekPlan.some((d) => d.meals.length)) {
      setStatus("No menus were available for the coming week. The cafeteria may not have published them yet.", "error");
    }
  } catch (err) {
    setStatus(`Something went wrong while building the plan: ${err.message}`, "error");
  } finally {
    planButtons.forEach((button) => { button.disabled = false; });
    updatePlanningButtons();
  }
}

/* ---- rendering -------------------------------------------------------- */

function macroBar(totals, budget) {
  const pct = Math.min(130, Math.round((totals.calories / (budget.calories || 1)) * 100));
  return h(
    "div",
    { class: "totals" },
    h("div", { class: "bar" }, h("div", { class: `bar-fill ${pct > 112 ? "over" : ""}`, style: `width:${Math.min(100, pct)}%` })),
    h(
      "div",
      { class: "totals-nums" },
      h("span", {}, `${Math.round(totals.calories)} / ${budget.calories} cal`),
      h("span", { class: totals.protein >= budget.protein ? "good" : "short" }, `${Math.round(totals.protein)} / ${budget.protein}g protein`),
      h("span", { class: "dim" }, `${Math.round(totals.carbs)}g C · ${Math.round(totals.fat)}g F`)
    )
  );
}

function mealHistory() { try { return JSON.parse(localStorage.getItem("bf.mealHistory") || "[]"); } catch { return []; } }
function saveMealHistory(records) { localStorage.setItem("bf.mealHistory", JSON.stringify(records.slice(-500))); }
function mealRecordKey(day, meal) { return `${day.date}::${meal.canonical}::${meal.periodId}`; }
function isMealEaten(day, meal) { return mealHistory().some((r) => r.key === mealRecordKey(day, meal)); }
function snapshotMeal(day, meal) {
  return {
    key: mealRecordKey(day, meal), date: day.date, label: day.label, periodName: meal.periodName,
    calories: Math.round(meal.result.totals.calories), protein: Math.round(meal.result.totals.protein),
    carbs: Math.round(meal.result.totals.carbs), fat: Math.round(meal.result.totals.fat),
    items: meal.result.picks.map((p) => ({ name: p.item.name, servings: p.servings, portion: p.item.portion, calories: Math.round(p.item.calories * p.servings), protein: Math.round(p.item.protein * p.servings), station: p.item.station })),
    extras: [
      ...(meal.result.extras?.fruits || []).map((x) => ({ type: 'fruit', name: x.name, portion: x.portion, calories: Math.round(x.calories), protein: Math.round(x.protein) })),
      ...(meal.result.extras?.vegetables || []).map((x) => ({ type: 'vegetable', name: x.name, portion: x.portion, calories: Math.round(x.calories), protein: Math.round(x.protein) })),
      ...(meal.result.extras?.drinks || []).map((x) => ({ type: 'drink', name: x.name, portion: x.portion, calories: Math.round(x.calories), protein: Math.round(x.protein) }))
    ]
  };
}
function toggleMealEaten(day, meal, checked) {
  if (isPastDate(day.date) || isFutureDate(day.date)) return;
  const records = mealHistory().filter((r) => r.key !== mealRecordKey(day, meal));
  if (checked) {
    records.push(snapshotMeal(day, meal));

    // If the planned meal came in under its calorie budget, move those unused
    // calories into a later uneaten meal so the day's allocation stays intact.
    // Only do this once for a meal, so toggling the checkbox off/on cannot
    // repeatedly inflate later meal budgets.
    if (!meal.calorieUnderallocationMoved) {
      const unused = Math.max(0, Math.round((Number(meal.budget?.calories) || 0) - (Number(meal.result?.totals?.calories) || 0)));
      if (unused > 0) {
        shiftUnusedCaloriesToLaterMeal(day, meal, unused);
        meal.calorieUnderallocationMoved = unused;
      }
    }
  }
  saveMealHistory(records);
  renderWeek();
  saveSavedPlan();
  renderHistory();
}

function isPastDate(dateStr) { return dateStr < fmtDate(new Date()); }
function isTodayDate(dateStr) { return dateStr === fmtDate(new Date()); }
function isFutureDate(dateStr) { return dateStr > fmtDate(new Date()); }
function dayForDate(dateStr) { return weekPlan.find((d) => d.date === dateStr) || null; }

function setActiveDate(dateStr) {
  activeDate = dateStr;
  localStorage.setItem("bf.activeDate", activeDate);
  renderWeek();
  saveSavedPlan();
}

function shiftActiveDate(delta) {
  const d = new Date(`${activeDate}T12:00:00`);
  d.setDate(d.getDate() + delta);
  setActiveDate(fmtDate(d));
}

async function buildSingleDay(dateStr) {
  if (!settings.locationId) { setStatus("Pick a school and dining location first.", "error"); return; }
  const d = new Date(`${dateStr}T12:00:00`);
  setStatus(`Planning ${dayLabel(d)}…`);
  try {
    const periods = await getPeriods(settings.locationId, dateStr);
    const dayMeals = selectThreeMealPeriods(periods, dateStr);
    if (!dayMeals.length) {
      weekPlan = weekPlan.filter((x) => x.date !== dateStr);
      weekPlan.push({ date:dateStr, label:dayLabel(d), meals:[], note:"No matching meal periods this day." });
      saveSavedPlan(); renderWeek(); setStatus(""); return;
    }
    const { budgets, coverage } = allocateBudgets(dailyTargets(dateStr), dayMeals.map((m) => ({canonical:m.canonical})), splitFractions());
    const meals = [];
    for (const {period, canonical} of dayMeals) {
      const budget = budgets[canonical];
      const meal = await buildMealAtLocation(dateStr, canonical, budget, settings.locationId, new Map(), { period, manual: settings.planningStyle === 'manual' });
      meals.push(meal);
      await new Promise(r=>setTimeout(r,100));
    }
    weekPlan=weekPlan.filter((x)=>x.date!==dateStr);
    weekPlan.push({date:dateStr,label:dayLabel(d),meals,note:coverage<0.85?"Only some meals are published for this day, so the plan covers less than your full daily target.":null});
    weekPlan.sort((a,b)=>a.date.localeCompare(b.date));
    saveSavedPlan(); renderWeek(); setStatus("");
  } catch(err) { setStatus(`Something went wrong while building the plan: ${err.message}`,"error"); }
}

function renderDayNavigator() {
  const d=new Date(`${activeDate}T12:00:00`);
  const existing=dayForDate(activeDate);
  return h('div',{class:'day-nav'},
    h('button',{type:'button',title:'Previous day',onclick:()=>shiftActiveDate(-1)},'‹'),
    h('div',{class:'day-nav-center'},h('h2',{},dayLabel(d)),h('div',{class:'day-summary'},existing?.meals?.length?`${existing.meals.length} meals planned`:'No plan generated for this day')),
    h('button',{type:'button',title:'Next day',onclick:()=>shiftActiveDate(1)},'›'),
    h('button',{type:'button',class:'today-btn',onclick:()=>setActiveDate(fmtDate(new Date()))},'Today')
  );
}

function currentMainPool(meal) {
  const removed = new Set(meal.manualRemovedKeys || []);
  return buildCandidatePool(meal.stations || [], { ...prefs(), mealCanonical: meal.canonical })
    .filter((item) => !removed.has(itemKey(item.station, item.name)));
}

function manualMealTotals(meal) {
  const mainTotals = (meal.result?.picks || []).reduce((t, p) => {
    t.calories += p.item.calories * p.servings;
    t.protein += p.item.protein * p.servings;
    t.carbs += p.item.carbs * p.servings;
    t.fat += p.item.fat * p.servings;
    return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  meal.result.mainTotals = mainTotals;
  meal.result.totals = combinedTotals(mainTotals, meal.result.extras);
}

function manualAddOptions(meal) {
  const pool = currentMainPool(meal);
  const extras = meal.result?.extras || { fruits: [], vegetables: [], drinks: [] };
  const extraT = extrasTotals(extras);

  // Always derive the current manual-food totals directly from the actual picks.
  // Do not trust result.mainTotals here: saved plans and older builds can carry
  // a stale cached total, which can make the picker hide perfectly valid foods.
  const currentMain = (meal.result?.picks || []).reduce((t, p) => {
    const servings = Number(p.servings) || 0;
    t.calories += (Number(p.item.calories) || 0) * servings;
    t.protein += (Number(p.item.protein) || 0) * servings;
    t.carbs += (Number(p.item.carbs) || 0) * servings;
    t.fat += (Number(p.item.fat) || 0) * servings;
    return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const remainingCalories = Math.max(0, (Number(meal.budget.calories) || 0) - extraT.calories - currentMain.calories);
  const remainingFat = meal.budget.fatMax == null ? null : Math.max(0, meal.budget.fatMax - extraT.fat - currentMain.fat);
  const remainingCarbs = meal.budget.carbMax == null ? null : Math.max(0, meal.budget.carbMax - extraT.carbs - currentMain.carbs);
  const picks = meal.result?.picks || [];
  const currentByKey = new Map(picks.map((p) => [itemKey(p.item.station, p.item.name), p]));

  return pool
    .map((item) => {
      const key = itemKey(item.station, item.name);
      const existing = currentByKey.get(key);
      const max = maxServingsForItem(item);
      if (existing && existing.servings >= max) return null;

      const calories = Number(item.calories) || 0;
      const protein = Number(item.protein) || 0;
      const carbs = Number(item.carbs) || 0;
      const fat = Number(item.fat) || 0;

      // The picker is intentionally a one-serving-at-a-time control. An item is
      // available whenever that next serving itself fits in the actual calories
      // remaining, rather than comparing against a stale cached total.
      if (calories > remainingCalories + 1e-9) return null;
      if (remainingFat != null && fat > remainingFat + 1e-9) return null;
      if (remainingCarbs != null && carbs > remainingCarbs + 1e-9) return null;

      const totals = {
        calories: currentMain.calories + calories + extraT.calories,
        protein: currentMain.protein + protein + extraT.protein,
        carbs: currentMain.carbs + carbs + extraT.carbs,
        fat: currentMain.fat + fat + extraT.fat,
      };
      return { item, totals, station: item.station, existing };
    })
    .filter(Boolean)
    .sort((a, b) => b.item.protein - a.item.protein || a.item.calories - b.item.calories || a.item.name.localeCompare(b.item.name));
}

function addManualFood(day, meal, item) {
  if (isPastDate(day.date) || isMealEaten(day, meal)) return;
  const key = itemKey(item.station, item.name);
  const max = maxServingsForItem(item);
  const existing = (meal.result.picks || []).find((p) => itemKey(p.item.station, p.item.name) === key);
  if (existing) {
    if (existing.servings >= max) return;
    existing.servings += 1;
  } else {
    meal.result.picks.push({ item, servings: 1 });
  }
  manualMealTotals(meal);
  renderWeek();
  saveSavedPlan();
}

function renderManualFoodPicker(day, meal) {
  if (isPastDate(day.date) || isMealEaten(day, meal)) return null;
  const options = manualAddOptions(meal);
  if (!options.length) return h('div', { class:'manual-picker manual-picker-empty' },
    h('strong',{},'No additional foods fit this meal.'),
    h('div',{class:'dim small'},'Remove an item or adjust the meal target to make room for another option.')
  );

  const topFive = options.slice(0, 5);
  const byStation = new Map();
  for (const option of options) {
    if (!byStation.has(option.item.station)) byStation.set(option.item.station, []);
    byStation.get(option.item.station).push(option);
  }

  const choose = (option, details) => {
    addManualFood(day, meal, option.item);
    if (details) details.open = false;
  };

  const foodRow = (option, details) => h('button', {
    type:'button', class:'manual-food-row', onclick:() => choose(option, details),
    title:`Add ${option.item.name}`
  },
    h('span',{class:'manual-food-name'},option.item.name),
    h('span',{class:'manual-food-stats'},
      h('span',{},`+${Math.round(option.item.protein)}g protein`),
      h('span',{},`+${Math.round(option.item.calories)} cal · ${Math.round(option.totals.calories)} cal / ${Math.round(option.totals.protein)}g`))
  );

  const topDetails = h('details',{class:'manual-food-group',open:true},
    h('summary',{},'Top 5 Protein options'),
    h('div',{class:'manual-food-list'},...topFive.map(x => foodRow(x, null)))
  );

  const stationGroups = [...byStation.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([station, items]) => {
    items.sort((a,b) => b.item.protein - a.item.protein || a.item.calories - b.item.calories || a.item.name.localeCompare(b.item.name));
    // Create the <details> element before creating its rows. The row click
    // handlers close this group, so the variable must already be initialized
    // when foodRow() captures it.
    const details = h('details',{class:'manual-food-group'});
    details.append(
      h('summary',{},`${station} · ${items.length}`),
      h('div',{class:'manual-food-list'},...items.map(x => foodRow(x, details)))
    );
    return details;
  });

  const extraOptions = [];
  const extraGroup = (type, label, key) => {
    const extras = meal.result.extras?.options?.[key] || [];
    if (!extras.length) return null;
    const selected = meal.result.extras[type] || (meal.result.extras[type] = []);
    const details = h('details',{class:'manual-food-group'});
    const rows = extras.map((item) => h('button',{
      type:'button', class:'manual-food-row',
      onclick:() => {
        requestExtraAdd(day, meal, item, key === 'fruit' ? 'fruit' : 'vegetable', label, selected);
        details.open = false;
      },
      title:`Add ${item.name}`
    },
      h('span',{class:'manual-food-name'},item.name),
      h('span',{class:'manual-food-stats'},
        h('span',{},`+${Math.round(item.protein || 0)}g protein`),
        h('span',{},`+${Math.round(item.calories || 0)} cal`)
      )
    ));
    details.append(
      h('summary',{},`${label} · ${extras.length}`),
      h('div',{class:'manual-food-list'},...rows)
    );
    return details;
  };
  const fruitGroup = extraGroup('fruits','Fruit','fruit');
  const vegetableGroup = extraGroup('vegetables','Vegetables','vegetable');
  if (fruitGroup) extraOptions.push(fruitGroup);
  if (vegetableGroup) extraOptions.push(vegetableGroup);

  return h('div',{class:'manual-picker'},
    h('div',{class:'manual-picker-title'},'Add food',h('span',{class:'dim small'},`${options.length + extraOptions.reduce((n, g) => n + ((g.querySelector?.('.manual-food-list')?.children.length) || 0), 0)} choices`)),
    h('div',{class:'manual-picker-scroll'}, topDetails, ...stationGroups, ...extraOptions),
    h('div',{class:'dim small manual-picker-note'},`Options over this meal's calorie${meal.budget.calories === 1 ? '' : ' '}budget are hidden. Served stations allow 1 serving; self-serve stations allow up to 3.`)
  );
}

function swapOptionsForPick(meal, pick) {
  const pool = currentMainPool(meal);
  const currentKey = itemKey(pick.item.station, pick.item.name);
  const fixedTotals = { ...meal.result.totals };
  fixedTotals.calories -= pick.item.calories * pick.servings;
  fixedTotals.protein -= pick.item.protein * pick.servings;
  fixedTotals.carbs -= pick.item.carbs * pick.servings;
  fixedTotals.fat -= pick.item.fat * pick.servings;

  const options = pool
    .filter((item) => itemKey(item.station, item.name) !== currentKey)
    .filter((item) => pick.servings <= maxServingsForItem(item))
    .map((item) => {
      const totals = {
        calories: fixedTotals.calories + item.calories * pick.servings,
        protein: fixedTotals.protein + item.protein * pick.servings,
        carbs: fixedTotals.carbs + item.carbs * pick.servings,
        fat: fixedTotals.fat + item.fat * pick.servings,
      };
      const calorieOver = Math.max(0, totals.calories - meal.budget.calories);
      const fatOver = meal.budget.fatMax == null ? 0 : Math.max(0, totals.fat - meal.budget.fatMax);
      const carbOver = meal.budget.carbMax == null ? 0 : Math.max(0, totals.carbs - meal.budget.carbMax);
      const proteinShort = Math.max(0, meal.budget.protein - totals.protein);
      const score = calorieOver * 10000 + fatOver * 100 + carbOver * 100 + proteinShort * 8 + Math.max(0, meal.budget.calories - totals.calories) * 0.15 - item.protein * 0.5;
      return { item, servings: pick.servings, totals, feasible: calorieOver <= 0 && fatOver <= 0 && carbOver <= 0, score };
    })
    .filter((x) => x.feasible)
    .sort((a, b) => a.score - b.score || b.item.protein - a.item.protein || a.item.name.localeCompare(b.item.name));
  return options.slice(0, 5);
}

function applyItemSwap(meal, oldPick, replacement) {
  const idx = meal.result.picks.indexOf(oldPick);
  if (idx < 0) return;
  meal.result.picks[idx] = { item: replacement.item, servings: replacement.servings };
  meal.result.mainTotals = meal.result.picks.reduce((t, p) => {
    t.calories += p.item.calories * p.servings; t.protein += p.item.protein * p.servings;
    t.carbs += p.item.carbs * p.servings; t.fat += p.item.fat * p.servings; return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  meal.result.totals = combinedTotals(meal.result.mainTotals, meal.result.extras);
  delete meal.result.flameOmelet;
  delete meal.result.laMesaPlate;
}

function renderSwapChooser(day, meal, pick) {
  const options = swapOptionsForPick(meal, pick);
  if (!options.length) {
    return h('div', { class: 'swap-panel swap-empty' }, 'No direct swaps found that keep this meal within your current calorie/protein limits.');
  }
  return h('div', { class: 'swap-panel' },
    h('div', { class: 'swap-panel-title' }, `Swap ${pick.item.name} — choose one of ${options.length} options`),
    ...options.map((option) => h('button', {
      type: 'button', class: 'swap-option', onclick: () => {
        if (isPastDate(day.date)) return;
        applyItemSwap(meal, pick, option);
        renderWeek();
        saveSavedPlan();
      }
    }, h('strong', {}, option.item.name), h('span', { class: 'item-meta' }, `${option.item.station} · ${option.servings}× · ${Math.round(option.totals.calories)} cal total · ${Math.round(option.totals.protein)}g protein total`)))
  );
}

function isMealEatenOnDay(day, meal) {
  return isMealEaten(day, meal);
}

function budgetPlanForExistingDay(day) {
  const meals = day.meals || [];
  const targets = dailyTargets(day.date);
  const eaten = meals.filter((m) => isMealEatenOnDay(day, m));
  const remaining = meals.filter((m) => !isMealEatenOnDay(day, m));

  if (!remaining.length) return new Map(meals.map((m) => [m.canonical, m.budget]));

  const consumed = eaten.reduce((t, m) => {
    t.calories += Number(m.result?.totals?.calories) || 0;
    t.protein += Number(m.result?.totals?.protein) || 0;
    t.carbs += Number(m.result?.totals?.carbs) || 0;
    t.fat += Number(m.result?.totals?.fat) || 0;
    return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const remainTarget = {
    calories: Math.max(0, targets.calories - consumed.calories),
    protein: Math.max(0, targets.protein - consumed.protein),
    carbs: targets.carbMax == null ? null : Math.max(0, targets.carbMax - consumed.carbs),
    fat: targets.fatMax == null ? null : Math.max(0, targets.fatMax - consumed.fat),
  };

  const weights = new Map();
  let totalWeight = 0;
  for (const m of remaining) {
    const w = m.canonical === 'brunch'
      ? (settings.splits.breakfast + settings.splits.lunch)
      : (settings.splits[m.canonical] || 0);
    const weight = Math.max(0.01, Number(w) || 0);
    weights.set(m, weight);
    totalWeight += weight;
  }

  const out = new Map();
  for (const m of eaten) out.set(m.canonical, m.budget);
  for (const m of remaining) {
    const frac = (weights.get(m) || 0) / (totalWeight || 1);
    out.set(m.canonical, {
      calories: Math.round(remainTarget.calories * frac),
      protein: Math.round(remainTarget.protein * frac),
      fatMax: remainTarget.fat == null ? null : Math.round(remainTarget.fat * frac),
      carbMax: remainTarget.carbs == null ? null : Math.round(remainTarget.carbs * frac),
    });
  }
  return out;
}

function mealBudgetForCurrentDay(day, meal) {
  const budgets = budgetPlanForExistingDay(day);
  return budgets.get(meal.canonical) || meal.budget;
}

async function resetMeal(day, meal, locationId = meal.locationId || settings.locationId, previousLocation = null) {
  if (isPastDate(day.date)) return;
  const previousMeal = { ...meal };
  if (settings.planningStyle === 'manual' || meal.result?.manual) {
    const targetBudget = mealBudgetForCurrentDay(day, meal);
    setStatus(`Resetting ${meal.periodName.toLowerCase()}…`);
    try {
      const rebuilt = await buildMealAtLocation(day.date, meal.canonical, targetBudget, locationId, new Map(), {
        manual: true,
        period: (!previousLocation || String(locationId) === String(previousLocation.locationId)) && meal.periodId
          ? { id: meal.periodId, name: meal.sourcePeriodName || meal.periodName, slug: String(meal.sourcePeriodName || meal.periodName || '').toLowerCase() }
          : null,
      });
      Object.assign(meal, rebuilt);
      renderWeek(); saveSavedPlan();
      setStatus(`${meal.periodName} reset. Choose your foods again.`, 'info');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      Object.assign(meal, previousMeal);
      renderWeek();
      setStatus(`Couldn't reset this meal: ${err.message}`, 'error');
    }
    return;
  }
  const targetBudget = mealBudgetForCurrentDay(day, meal);
  const targetLocationName = locationNameFor(locationId);
  setStatus(`Resetting ${meal.periodName.toLowerCase()} at ${targetLocationName}…`);
  try {
    const rebuilt = await buildMealAtLocation(
      day.date,
      meal.canonical,
      targetBudget,
      locationId,
      new Map(),
      {
        randomize: true,
        resetNonce: Date.now() + Math.random(),
        resetStrict: true,
        period: (!previousLocation || String(locationId) === String(previousLocation.locationId)) && meal.periodId
          ? { id: meal.periodId, name: meal.sourcePeriodName || meal.periodName, slug: String(meal.sourcePeriodName || meal.periodName || '').toLowerCase() }
          : null,
        avoidKeys: (meal.result?.picks || []).map((p) => itemKey(p.item.station, p.item.name)),
      }
    );
    Object.assign(meal, rebuilt);
    renderWeek();
    saveSavedPlan();
    setStatus(`${meal.periodName} reset. Other meals were not changed.`, 'info');
    setTimeout(() => setStatus(''), 3000);
  } catch (err) {
    // Restore the complete previous meal if the requested location really has
    // no usable menu. The selector therefore never gets stuck displaying a
    // location that failed to load.
    Object.assign(meal, previousMeal);
    if (previousLocation && previousLocation.locationId != null) {
      meal.locationId = previousLocation.locationId;
      meal.locationName = previousLocation.locationName;
    }
    renderWeek();
    setStatus(`Couldn't reset this meal: ${err.message}`, 'error');
  }
}

function renderMealLocationSelector(day, meal) {
  const locked = isPastDate(day.date);
  const selected = meal.locationId || settings.locationId;
  const choices = [...availableLocations].sort((a, b) => {
    const special = (name) => /panda express|la tapatia/i.test(name) ? 0 : /buster/i.test(name) ? 1 : 2;
    return special(a.name) - special(b.name) || a.name.localeCompare(b.name);
  });
  const locationChoices = choices.length ? choices : [{ id: selected, name: meal.locationName || settings.locationName || 'Current dining location' }];
  const select = h('select', { class: 'meal-location-select', disabled: locked, 'aria-label': `Eating location for ${meal.periodName}` },
    ...locationChoices.map((loc) => h('option', { value: loc.id }, loc.name))
  );
  select.value = String(selected);
  if (select.value !== String(selected)) {
    const current = locationChoices.find((loc) => String(loc.id) === String(selected));
    if (current) {
      select.append(h('option', { value: current.id }, current.name));
      select.value = String(selected);
    }
  }
  select.addEventListener('change', () => changeMealLocation(day, meal, select.value));
  return h('div', { class: 'meal-location' },
    h('span', { class: 'meal-location-label' }, 'Eating at'), select,
    locked ? null : h('span', { class: 'dim small' }, 'Changes only this meal')
  );
}

async function changeMealLocation(day, meal, locationId) {
  if (isPastDate(day.date) || String(locationId) === String(meal.locationId || settings.locationId)) return;
  const previous = { locationId: meal.locationId, locationName: meal.locationName };
  meal.locationId = String(locationId);
  meal.locationName = locationNameFor(locationId);
  renderWeek();
  await resetMeal(day, meal, locationId, previous);
}

function renderMeal(day, meal) {
  const past = isPastDate(day.date);
  const future = isFutureDate(day.date);
  const byStation = new Map();
  for (const pick of meal.result.picks) {
    if (!byStation.has(pick.item.station)) byStation.set(pick.item.station, []);
    byStation.get(pick.item.station).push(pick);
  }
  const stationEls = [...byStation.entries()].map(([station, picks]) => h('div', { class: 'station' },
    h('div', { class: 'station-name' }, `📍 ${station}`),
    ...picks.map((pick) => {
      const swapOptions = swapOptionsForPick(meal, pick);
      return h('div', { class: 'item' },
        h('span', { class: 'servings' }, `${pick.servings}×`),
        h('div', { class: 'item-body' }, h('div', { class: 'item-name' }, pick.item.name), h('div', { class: 'item-meta' }, [pick.item.portion, `${Math.round(pick.item.calories)} cal`, `${Math.round(pick.item.protein)}g protein`].filter(Boolean).join(' · '))),
        !past ? h('button', { class: 'swap swap-button', title: 'Choose a direct replacement for this item', disabled: !swapOptions.length, onclick: (e) => {
          const row = e.currentTarget.closest('.item');
          const next = row?.nextElementSibling;
          if (next?.classList.contains('swap-panel')) { next.remove(); return; }
          row?.after(renderSwapChooser(day, meal, pick));
        } }, 'Swap') : null,
        !past ? h('button', { class: 'swap remove-item', title: 'Remove this item and recalculate the meal', onclick: () => {
          if (settings.planningStyle === 'manual' || meal.result.manual) {
            // Removing a food from a manual plan is a one-time plan edit.
            // Do NOT add it to the permanent excluded-items list or manualRemovedKeys.
            meal.result.picks = meal.result.picks.filter((p) => p !== pick);
            manualMealTotals(meal);
            renderWeek(); saveSavedPlan();
          } else {
            excluded.add(itemKey(pick.item.station, pick.item.name)); saveExcluded(); reoptimizeMeal(day, meal);
          }
        } }, '✕') : null
      );
    })
  ));
  const extraCards = (meal.result.manual ? [['drink','Drink','🥛']] : [['drink','Drink','🥛']]).map(([type,label,icon]) => renderExtraSelector(day, meal, type, label, icon));
  const eaten = isMealEaten(day, meal);
  const empty = !meal.result.picks.length;
  const mealKey = `${day.date}::${meal.canonical}::${meal.periodId}`;
  const collapsed = collapsedMeals.has(mealKey);
  const toggle = h('button',{type:'button',class:'meal-collapse-toggle', 'aria-expanded': !collapsed, onclick:() => {
    if (collapsed) collapsedMeals.delete(mealKey); else collapsedMeals.add(mealKey);
    renderWeek();
  }}, `${collapsed ? '▸' : '▾'} ${meal.periodName}`);
  const mealBody = h('div',{class:`meal-body ${collapsed ? 'meal-body-collapsed' : ''}`},
    h('div', { class: 'meal-head' },
      h('div', { class: 'meal-title-row' }, h('span', { class: 'meal-name' }, meal.periodName), eaten ? h('span', { class: 'meal-complete-badge' }, '✓ COMPLETED') : null),
      renderMealLocationSelector(day, meal),
      !past ? h('div', { class: 'meal-actions' },
        h('button', { type:'button', class:'meal-reset-button', onclick:() => resetMeal(day, meal) }, '↻ Meal reset')
      ) : null,
      h('label', { class: `eaten-check ${eaten ? 'checked' : ''}` },
        h('input', { type: 'checkbox', checked: eaten, disabled: past || future, onchange: (e) => toggleMealEaten(day, meal, e.target.checked), 'aria-label': `Mark ${meal.periodName} as eaten` }),
        h('span', { class: 'eaten-box' }, eaten ? '✓' : ''),
        h('span', { class: 'eaten-label' }, past ? 'Past meal — locked' : future ? 'Future meal — not yet available to complete' : (eaten ? 'Meal eaten — complete' : 'I ate this meal as prescribed'))
      ),
      meal.result.manual ? renderManualFoodPicker(day, meal) : null,
      macroBar(meal.result.totals, meal.budget),
      meal.calorieAdjustment ? h('div', { class: `calorie-adjustment ${meal.calorieOverallocated ? 'calorie-overallocated' : ''}` }, meal.calorieAdjustment) : null,
      meal.calorieOverflowUnallocated ? h('div', { class: 'calorie-adjustment calorie-overallocated' }, `* ${meal.calorieOverflowUnallocated} calories could not be reallocated to a later meal.`) : null
    ),
    empty ? h('div', { class: 'dim pad' }, meal.stations.length ? 'No items fit your filters for this meal.' : 'Menu not available.') : h('div', { class: 'stations' }, ...stationEls),
    h('div', { class: 'meal-extras' }, ...extraCards),
    h('div', { class: 'extra-note dim small' }, 'Drink options use generic nutrition values; the Buster’s beverage bar is not represented in DineOnCampus.')
  );
  return h('div', { class: `meal ${eaten ? 'meal-eaten' : ''} ${past ? 'past-meal' : ''} ${future ? 'future-meal' : ''}`, 'data-meal': `${day.date}-${meal.periodId}` }, toggle, mealBody);
}

function reoptimizeMeal(day, meal) {
  recomputeMeal(day, meal);
  renderWeek();
  saveSavedPlan();
}

function renderWeek() {
  renderStationPreferences();
  const wrap = $("#results");
  const day = dayForDate(activeDate);
  const d = new Date(`${activeDate}T12:00:00`);
  if (!day) {
    wrap.replaceChildren(
      renderDayNavigator(),
      h('div',{class:'day-unplanned'},
        h('strong',{},`No meal plan has been generated for ${dayLabel(d)}.`),
        h('p',{class:'dim small'},isPastDate(activeDate)?'You can generate a record for this day, but meals from previous days will remain locked.':'Build a plan for this day using the DineOnCampus menu and your current goals.'),
        h('button',{class:'primary',type:'button',onclick:()=>buildSingleDay(activeDate)},`Generate plan for ${isTodayDate(activeDate)?'today':dayLabel(d)}`)
      )
    );
    return;
  }
  const dayTotals={calories:0,protein:0,carbs:0,fat:0};
  day.meals.forEach(m=>{dayTotals.calories+=m.result.totals.calories;dayTotals.protein+=m.result.totals.protein;dayTotals.carbs+=m.result.totals.carbs;dayTotals.fat+=m.result.totals.fat;});
  const ex=exerciseSummary(day.date);
  wrap.replaceChildren(
    renderDayNavigator(),
    h('section',{class:`day ${isPastDate(day.date)?'day-locked':''}`},
      h('div',{class:'day-head'},h('div',{class:'day-summary'},day.meals.length?`${Math.round(dayTotals.calories)} cal · ${Math.round(dayTotals.protein)}g protein`:'')),
      ex.calories?h('div',{class:'exercise-day-note dim small'},`🏃 Exercise adds ${Math.round(ex.calories)} cal · +${Math.round(ex.protein)}g protein suggestion${ex.carbs?` · +${Math.round(ex.carbs)}g carbs`:''}`):null,
      day.note?h('div',{class:'dim pad'},day.note):null,
      h('div',{class:'day-meals'},...day.meals.map(m=>renderMeal(day,m)))
    )
  );
}

function updatePlanningButtons() {
  const auto = $('#plan-auto');
  const manual = $('#plan-manual');
  if (!auto || !manual) return;
  auto.classList.toggle('selected', settings.planningStyle === 'auto');
  manual.classList.toggle('selected', settings.planningStyle === 'manual');
  auto.textContent = 'Plan my day for me 🤖';
  manual.textContent = "I'll plan my own day ✋";
}

function setPlanningStyle(style) {
  // Preserve the plan we are leaving so switching modes never destroys the user's work.
  saveSavedPlan();
  settings.planningStyle = style === 'manual' ? 'manual' : 'auto';
  saveSettings();
  updatePlanningButtons();
}

async function switchPlanningStyle(style) {
  setPlanningStyle(style);
  if (loadSavedPlan(style)) {
    renderWeek();
    setStatus("");
    return;
  }
  await buildWeek(style === 'manual');
}

function bindPlanMode() {
  const mode = $("#plan-mode");
  if (!mode) return;
  mode.value = settings.planMode === "today" ? "today" : "week";
  mode.addEventListener("change", () => {
    settings.planMode = mode.value;
    saveSettings();
    updatePlanningButtons();
  });
  updatePlanningButtons();
}

/* ---- exercise -------------------------------------------------------- */
const ACTIVITY_DEFAULTS = { lifting: 3.5, running: 8.5, rucking: 7.0, swimming: 6.0, walking: 3.5 };
const ACTIVITY_LABELS = { lifting:'Weight lifting', running:'Running', rucking:'Rucking', swimming:'Swimming', walking:'Walking' };
function paceToMph(value) { const n = parseFloat(value); if (!Number.isFinite(n) || n <= 0) return null; return 60 / n; }
function runningMet(paceMinPerMile) {
  const mph = paceToMph(paceMinPerMile); if (!mph) return 8.5;
  if (mph <= 3.0) return 4.5; if (mph <= 3.7) return 6.0; if (mph <= 4.2) return 6.5; if (mph <= 4.8) return 7.8; if (mph <= 5.2) return 8.5; if (mph <= 5.8) return 9.0; if (mph <= 6.3) return 9.3; if (mph <= 6.7) return 10.5; if (mph <= 7.0) return 11.0; if (mph <= 7.5) return 11.8; if (mph <= 8.0) return 12.0; if (mph <= 8.6) return 12.5; return 13.0;
}
function walkingMet(paceMinPerMile) { const mph = paceToMph(paceMinPerMile); if (!mph) return 3.5; if (mph < 2) return 2.3; if (mph < 2.8) return 3.0; if (mph < 3.5) return 3.8; if (mph < 4.0) return 4.8; return 5.0; }
function ruckMet(ruckWeight, pace) { const w = Number(ruckWeight) || 0; const mph = paceToMph(pace); let met = mph && mph >= 4 ? 7.8 : mph && mph >= 3.5 ? 7.0 : 6.0; if (w >= 50) met += 0.8; else if (w >= 30) met += 0.4; return met; }
function exerciseMet(activity, pace, ruckWeight) { if (activity === 'running') return runningMet(pace); if (activity === 'walking') return walkingMet(pace); if (activity === 'rucking') return ruckMet(ruckWeight, pace); return ACTIVITY_DEFAULTS[activity] || 3.5; }
function calculateExerciseCalories(activity, minutes, weight, pace, ruckWeight) {
  const met = exerciseMet(activity, pace, ruckWeight); const kg = Number(weight) * 0.453592; const min = Number(minutes); if (!(kg > 0 && min > 0)) return 0;
  return Math.max(0, (met - 1) * 3.5 * kg / 200 * min);
}
function exerciseNutrition(activity, calories) {
  if (activity === 'lifting') return { proteinAdd: Math.round(calories * 0.05), carbAdd: 0 };
  if (activity === 'running' || activity === 'rucking' || activity === 'swimming') return { proteinAdd: Math.round(calories * 0.025), carbAdd: Math.round(calories * 0.10) };
  return { proteinAdd: Math.round(calories * 0.015), carbAdd: Math.round(calories * 0.05) };
}
function getExercises() { try { return JSON.parse(localStorage.getItem('bf.exercise') || '[]'); } catch { return []; } }
function saveExercises(items) { localStorage.setItem('bf.exercise', JSON.stringify(items.slice(-500))); }
function clearMealHistoryForDates(dates) {
  const wanted = new Set(dates.filter(Boolean));
  saveMealHistory(mealHistory().filter((r) => !wanted.has(r.date)));
}
function exerciseWarning(action, dates) {
  const dayText = dates.length === 1 ? dates[0] : dates.join(', ');
  return confirm(`Changing this exercise will recalculate only meals you have not eaten yet for ${dayText}. Meals already recorded as “eaten as prescribed” will stay unchanged.\n\nDo you want to continue?`);
}

async function rebuildPlanDay(dateStr) {
  const idx = weekPlan.findIndex((d) => d.date === dateStr);
  if (idx < 0) return;
  const oldDay = weekPlan[idx];
  const d = new Date(`${dateStr}T12:00:00`);
  let periods = [];
  try { periods = await getPeriods(settings.locationId, dateStr); } catch { periods = []; }
  const dayMeals = selectThreeMealPeriods(periods, dateStr);
  if (!dayMeals.length) return;

  const oldByCanonical = new Map((oldDay.meals || []).map((m) => [m.canonical, m]));
  const descriptors = dayMeals.map(({ canonical }) => ({ canonical }));
  const tempDay = { ...oldDay, meals: dayMeals.map(({ canonical }) => oldByCanonical.get(canonical) || { canonical, result: { totals: {} }, budget: {} }) };
  const budgets = budgetPlanForExistingDay(tempDay);

  const meals = [];
  const usage = new Map();
  for (const { canonical } of dayMeals) {
    const oldMeal = oldByCanonical.get(canonical);
    if (oldMeal && isMealEatenOnDay(oldDay, oldMeal)) {
      // Never rewrite food that the user has already eaten. Exercise changes
      // belong entirely to the meals that remain.
      meals.push(oldMeal);
      continue;
    }

    const budget = budgets.get(canonical) || oldMeal?.budget;
    const mealLocationId = oldMeal?.locationId || settings.locationId;
    const meal = await buildMealAtLocation(dateStr, canonical, budget, mealLocationId, usage, { randomize: true, manual: settings.planningStyle === 'manual' });
    for (const pick of meal.result.picks) {
      const k = itemKey(pick.item.station, pick.item.name);
      usage.set(k, (usage.get(k) || 0) + 1);
    }
    meals.push(meal);
  }

  weekPlan[idx] = {
    date: dateStr,
    label: oldDay.label || dayLabel(d),
    meals,
    note: oldDay.note || null,
  };
  renderWeek(); saveSavedPlan();
}

async function applyExerciseChange(affectedDates) {
  setStatus('Recalculating the remaining meal plan…');
  try {
    for (const date of [...new Set(affectedDates)]) await rebuildPlanDay(date);
    renderHistory();
    setStatus('Meal plan recalculated. Meals you already ate were left unchanged.', 'info');
  } catch (err) {
    setStatus(`Exercise changed, but the meal plan could not be fully recalculated: ${err.message}`, 'error');
  }
  setTimeout(() => setStatus(''), 4500);
}

function renderExerciseLog() {
  const wrap = $('#exercise-log'); if (!wrap) return;
  const items = getExercises().slice(-12).reverse();
  wrap.replaceChildren(...items.map((e) => {
    const editBtn = h('button', { class:'swap', title:'Edit exercise', onclick:() => editExercise(e.id) }, 'Edit');
    const removeBtn = h('button', { class:'swap', title:'Remove exercise', onclick:() => removeExercise(e.id) }, '✕');
    return h('div', { class:'exercise-entry' },
      h('div', {}, h('strong', {}, `${e.date} · ${e.activityLabel}`), h('div', { class:'item-meta' }, `${e.minutes} min${e.pace ? ` · ${e.pace} min/mi` : ''}${e.ruckWeight ? ` · ${e.ruckWeight} lb ruck` : ''} · ${Math.round(e.calories)} net cal · +${e.proteinAdd}g protein${e.carbAdd ? ` · +${e.carbAdd}g carbs` : ''}`)),
      h('div', { class:'exercise-actions' }, editBtn, removeBtn)
    );
  }));
}

function removeExercise(id) {
  const item = getExercises().find((x) => x.id === id); if (!item) return;
  if (!exerciseWarning('remove', [item.date])) return;
  saveExercises(getExercises().filter((x) => x.id !== id));
  renderExerciseLog();
  applyExerciseChange([item.date]);
}

function exerciseFieldSet(activity, values = {}) {
  const paceNeeded = ['running','walking','rucking'].includes(activity);
  const ruckNeeded = activity === 'rucking';
  return h('div', { class:'exercise-edit-fields' },
    h('div', { class:'field-row' },
      h('label', {}, 'Date', h('input', { id:'edit-exercise-date', type:'date', value:values.date || fmtDate(new Date()) })),
      h('label', {}, 'Activity', h('select', { id:'edit-exercise-activity' }, ...Object.entries(ACTIVITY_LABELS).map(([v,l]) => h('option', { value:v, selected:v===activity }, l)))
    )),
    h('div', { class:'field-row' },
      h('label', {}, 'Time (minutes)', h('input', { id:'edit-exercise-minutes', type:'number', min:'1', step:'1', value:values.minutes || '' })),
      h('label', {}, 'Body weight (lb)', h('input', { id:'edit-exercise-weight', type:'number', min:'50', step:'1', value:values.weight || '' }))
    ),
    h('div', { class:'field-row' },
      h('label', { id:'edit-pace-wrap', hidden:!paceNeeded }, 'Pace (min/mile)', h('input', { id:'edit-exercise-pace', type:'number', min:'3', max:'30', step:'0.1', value:values.pace || '' })),
      h('label', { id:'edit-ruck-wrap', hidden:!ruckNeeded }, 'Ruck weight (lb)', h('input', { id:'edit-exercise-ruck', type:'number', min:'0', step:'1', value:values.ruckWeight || '' }))
    ),
    h('div', { class:'exercise-edit-actions' },
      h('button', { type:'button', class:'primary', onclick:() => saveExerciseEdit(values.id) }, 'Save changes'),
      h('button', { type:'button', onclick:() => renderExerciseLog() }, 'Cancel')
    )
  );
}

function editExercise(id) {
  const item = getExercises().find((x) => x.id === id); if (!item) return;
  const wrap = $('#exercise-log');
  const existing = wrap.querySelector(`[data-edit-id="${CSS.escape(id)}"]`);
  if (existing) return;
  const editor = h('div', { class:'exercise-editor', 'data-edit-id':id }, exerciseFieldSet(item.activity, item));
  wrap.prepend(editor);
  const activity = editor.querySelector('#edit-exercise-activity');
  activity.addEventListener('change', () => {
    editor.querySelector('#edit-pace-wrap').hidden = !['running','walking','rucking'].includes(activity.value);
    editor.querySelector('#edit-ruck-wrap').hidden = activity.value !== 'rucking';
  });
}

async function saveExerciseEdit(id) {
  const item = getExercises().find((x) => x.id === id); if (!item) return;
  const newDate = $('#edit-exercise-date').value;
  const newActivity = $('#edit-exercise-activity').value;
  const minutes = Number($('#edit-exercise-minutes').value);
  const weight = Number($('#edit-exercise-weight').value);
  const pace = $('#edit-exercise-pace').value ? Number($('#edit-exercise-pace').value) : null;
  const ruckWeight = $('#edit-exercise-ruck').value ? Number($('#edit-exercise-ruck').value) : 0;
  if (!newDate || !(minutes > 0) || !(weight > 0)) { setStatus('Enter a date, exercise time, and body weight.', 'error'); return; }
  const affected = [...new Set([item.date, newDate])];
  if (!exerciseWarning('edit', affected)) return;
  const calories = calculateExerciseCalories(newActivity, minutes, weight, pace, ruckWeight);
  const nut = exerciseNutrition(newActivity, calories);
  const arr = getExercises().map((x) => x.id === id ? { ...x, date:newDate, activity:newActivity, activityLabel:ACTIVITY_LABELS[newActivity], minutes, weight, pace: ['running','walking','rucking'].includes(newActivity) ? pace : null, ruckWeight:newActivity === 'rucking' ? ruckWeight : 0, calories:Math.round(calories), proteinAdd:nut.proteinAdd, carbAdd:nut.carbAdd } : x);
  saveExercises(arr); renderExerciseLog();
  await applyExerciseChange(affected);
}

function bindExercise() {
  const form = $('#exercise-form'); if (!form) return;
  const button = $('#add-exercise');
  const activity = $('#exercise-activity'), pace = $('#exercise-pace'), ruck = $('#exercise-ruck'), date = $('#exercise-date');
  date.value = fmtDate(new Date());
  function updateFields() {
    const needsPace = ['running','walking','rucking'].includes(activity.value);
    pace.parentElement.hidden = !needsPace;
    ruck.parentElement.hidden = activity.value !== 'rucking';
  }
  activity.addEventListener('change', updateFields); updateFields();
  const save = (ev) => {
    if (ev) ev.preventDefault();
    const minutes = Number($('#exercise-minutes').value);
    const weight = Number($('#exercise-weight').value);
    const p = pace.value ? Number(pace.value) : null;
    const rw = ruck.value ? Number(ruck.value) : 0;
    if (!(minutes > 0 && weight > 0) || !date.value) { setStatus('Enter a date, exercise time, and body weight.', 'error'); return; }
    const calories = calculateExerciseCalories(activity.value, minutes, weight, p, rw);
    const nut = exerciseNutrition(activity.value, calories);
    const arr = getExercises();
    arr.push({ id:(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`), date:date.value, activity:activity.value, activityLabel:ACTIVITY_LABELS[activity.value], minutes, weight, pace:['running','walking','rucking'].includes(activity.value) ? p : null, ruckWeight:activity.value === 'rucking' ? rw : 0, calories:Math.round(calories), proteinAdd:nut.proteinAdd, carbAdd:nut.carbAdd });
    saveExercises(arr); renderExerciseLog(); renderHistory();
    form.reset(); date.value = fmtDate(new Date()); updateFields();
    setStatus(`Exercise saved: ${Math.round(calories)} net calories added. Build/rebuild the plan to use the new target.`, 'info');
  };
  form.addEventListener('submit', save); if (button) { button.type='button'; button.addEventListener('click', save); }
  renderExerciseLog();
}

/* ---- history --------------------------------------------------------- */
function renderHistory() {
  const details = $('#history'); if (!details) return;
  let wrap = $('#history-content');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'history-content'; details.append(wrap); }
  const records = mealHistory();
  const byDate = {};
  records.forEach(r => (byDate[r.date] ||= []).push(r));
  const dates = Object.keys(byDate).sort().slice(-30);
  const maxCal = Math.max(1, ...dates.map(d => byDate[d].reduce((a,r)=>a+r.calories,0)));
  const maxPro = Math.max(1, ...dates.map(d => byDate[d].reduce((a,r)=>a+r.protein,0)));
  const totalCal = records.reduce((a,r)=>a+r.calories,0), totalPro = records.reduce((a,r)=>a+r.protein,0);
  const dayCount = Object.keys(byDate).length || 1;
  const content = [
    h('div',{class:'history-summary'},h('strong',{},'Recorded intake'),h('span',{},`${Math.round(totalCal/dayCount)} cal/day · ${Math.round(totalPro/dayCount)}g protein/day average`)),
    dates.length ? h('div',{class:'history-chart'},...dates.map(d=>{
      const c=byDate[d].reduce((a,r)=>a+r.calories,0), p=byDate[d].reduce((a,r)=>a+r.protein,0);
      return h('div',{class:'history-row'},h('div',{class:'history-date'},d),h('div',{class:'history-bars'},h('div',{class:'history-bar cal',style:`width:${Math.max(8,Math.round(c/maxCal*100))}%`},`${Math.round(c)} cal`),h('div',{class:'history-bar pro',style:`width:${Math.max(8,Math.round(p/maxPro*100))}%`},`${Math.round(p)}g protein`)));
    })) : h('div',{class:'dim pad'},'No meals recorded yet. Check “Ate as prescribed” after eating a planned meal.'),
    ...dates.slice().reverse().map(d=>h('details',{class:'history-day'},h('summary',{},`${d} — ${Math.round(byDate[d].reduce((a,r)=>a+r.calories,0))} cal · ${Math.round(byDate[d].reduce((a,r)=>a+r.protein,0))}g protein`),...byDate[d].map(r=>h('div',{class:'history-meal'},h('strong',{},r.periodName),h('span',{class:'item-meta'},`${r.calories} cal · ${r.protein}g protein`),h('div',{class:'item-meta'},[...r.items.map(i=>`${i.servings}× ${i.name}`),...r.extras.map(x=>x.name)].join(' · '))))))
  ];
  wrap.replaceChildren(...content);
}

function setBuildVersionMarker() {
  const marker = document.querySelector('.app-version');
  if (marker) marker.textContent = BUILD_VERSION;
}

/* ---- boot -------------------------------------------------------------- */

setBuildVersionMarker();
bindTheme();

$("#plan-auto").addEventListener('click', () => switchPlanningStyle('auto'));
$("#plan-manual").addEventListener('click', () => switchPlanningStyle('manual'));
$("#retry").addEventListener("click", () => {
  $("#retry").hidden = true;
  initPickers();
});
$("#reset-excluded").addEventListener("click", resetExcludedItems);

bindGoalInputs();
bindPlanMode();
bindExercise();
renderHistory();
initPickers();
