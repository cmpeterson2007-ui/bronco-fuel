import { getSchools, getLocations, getPeriods, getMenu } from "./api.js";
import {
  buildCandidatePool,
  optimizeMeal,
  allocateBudgets,
  canonicalMeal,
  itemKey,
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
let activeDate = localStorage.getItem("bf.activeDate") || fmtDate(new Date());
const PLAN_STORAGE_KEY = "bf.savedPlan";

function planSettingsSignature() {
  return JSON.stringify({
    schoolId: settings.schoolId,
    locationId: settings.locationId,
    planMode: settings.planMode,
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
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({
      savedOn: fmtDate(new Date()),
      planMode: settings.planMode,
      locationId: settings.locationId,
      signature: planSettingsSignature(),
      activeDate,
      weekPlan,
    }));
    localStorage.setItem("bf.activeDate", activeDate);
  } catch (err) { console.warn("Could not save meal plan locally:", err); }
}

function loadSavedPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || "null");
    if (!saved?.weekPlan?.length) return false;
    if (saved.locationId && settings.locationId && saved.locationId !== settings.locationId) return false;
    if (saved.signature !== planSettingsSignature()) return false;
    weekPlan = saved.weekPlan;
    activeDate = saved.activeDate || activeDate;
    localStorage.setItem("bf.activeDate", activeDate);
    return true;
  } catch { return false; }
}

function clearSavedPlan() {
  localStorage.removeItem(PLAN_STORAGE_KEY);
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
      const build = $("#build");
      if (build) build.textContent = settings.planMode === "today" ? "Build today’s plan 📅" : "Build my week 🗓️";
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
  { name: '2% Milk', portion: '1 cup', calories: 122, protein: 8.1, carbs: 12, fat: 4.8, recommended: true },
  { name: 'Orange juice', portion: '8 fl oz', calories: 112, protein: 1.7, carbs: 26, fat: 0.3 },
  { name: 'Apple juice', portion: '8 fl oz', calories: 114, protein: 0.2, carbs: 28, fat: 0.3 },
  { name: 'Coca-Cola', portion: '12 fl oz', calories: 140, protein: 0, carbs: 39, fat: 0 },
  { name: 'Pepsi', portion: '12 fl oz', calories: 150, protein: 0, carbs: 41, fat: 0 },
  { name: 'Diet Coke', portion: '12 fl oz', calories: 0, protein: 0, carbs: 0, fat: 0 },
  { name: 'Diet Pepsi', portion: '12 fl oz', calories: 0, protein: 0, carbs: 0, fat: 0 },
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
    fruit: fruits[0] ? cloneExtra(fruits[0]) : null,
    vegetable: vegetables[0] ? cloneExtra(vegetables[0]) : null,
    drinks: [],
    options: { fruit: fruits, vegetable: vegetables, drink: drinks },
  };
}

function extrasTotals(extras) {
  const types = ['fruit', 'vegetable'];
  return types.reduce((t, type) => {
    const item = extras?.[type];
    if (item) {
      t.calories += item.calories || 0; t.protein += item.protein || 0;
      t.carbs += item.carbs || 0; t.fat += item.fat || 0;
    }
    return t;
  }, (extras?.drinks || []).reduce((t, item) => {
    t.calories += item.calories || 0; t.protein += item.protein || 0;
    t.carbs += item.carbs || 0; t.fat += item.fat || 0; return t;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 }));
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

function renderExtraSelector(day, meal, type, label, icon) {
  const options = meal.result.extras.options?.[type] || [];
  if (type === 'drink') return renderDrinkAdder(day, meal, label, icon, options);
  if (!options.length) return h('div', { class: 'meal-extra extra-empty' }, h('div', { class: 'extra-label' }, `${icon} ${label}`), h('div', { class: 'dim small' }, `No ${label.toLowerCase()} options found on the DineOnCampus menu.`));
  const selectedName = meal.result.extras[type]?.name;
  const selected = options.find((x) => x.name === selectedName) || options[0];
  meal.result.extras[type] = cloneExtra(selected);
  const select = h('select', { class: 'extra-select', 'aria-label': `${label} for ${meal.periodName}` }, ...options.map((item) => h('option', { value: item.name }, `${item.name} — ${item.station}${item.recommended ? ' — ⭐ Best choice' : ''}`)));
  select.value = selected.name;
  const locked = isPastDate(day.date);
  select.disabled = locked;
  select.addEventListener('change', () => { meal.result.extras[type] = cloneExtra(options.find((x) => x.name === select.value) || options[0]); recomputeMeal(day, meal); renderWeek(); saveSavedPlan(); });
  return h('div', { class: `meal-extra ${locked ? 'extra-locked' : ''}` }, h('div', { class: 'extra-label' }, `${icon} ${label}`), select, h('div', { class: 'item-meta' }, [selected.station ? `📍 ${selected.station}` : '', selected.portion, `${Math.round(selected.calories)} cal`, `${Math.round(selected.protein)}g protein`].filter(Boolean).join(' · ')));
}

function renderDrinkAdder(day, meal, label, icon, options) {
  const locked = isPastDate(day.date);
  const drinks = meal.result.extras.drinks || (meal.result.extras.drinks = []);
  const select = h('select', { class: 'extra-select', disabled: locked }, h('option', { value: '' }, 'Choose a drink to add…'), ...options.map(x => h('option', { value: x.name }, `${x.name}${x.recommended ? ' — ⭐ Best choice' : ''}`)));
  const add = h('button', { type:'button', class:'add-drink', disabled: locked, onclick: () => {
    const item = options.find(x => x.name === select.value); if (!item) return;
    drinks.push(cloneExtra(item)); select.value=''; recomputeMeal(day, meal); renderWeek(); saveSavedPlan();
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

function selectThreeMealPeriods(periods) {
  const wanted = new Set(["breakfast", "lunch", "dinner"].filter((m) => settings.meals[m]));
  const matching = periods
    .map((p) => ({ period: p, canonical: canonicalMeal(p) }))
    .filter((m) => wanted.has(m.canonical));

  // DineOnCampus can publish multiple variants (for example Lunch and Late Lunch).
  // Keep exactly one period for each of the three meal slots. Prefer the ordinary
  // period name, but use a variant when it is the only option available.
  const byCanonical = new Map();
  const isVariant = (p) => /late|early|second|extended/i.test(`${p.name || ''} ${p.slug || ''}`);
  for (const candidate of matching) {
    const existing = byCanonical.get(candidate.canonical);
    if (!existing || (isVariant(existing.period) && !isVariant(candidate.period))) {
      byCanonical.set(candidate.canonical, candidate);
    }
  }
  return ["breakfast", "lunch", "dinner"].map((k) => byCanonical.get(k)).filter(Boolean);
}

async function buildWeek() {
  if (!settings.locationId) {
    setStatus("Pick a school and dining location first.", "error");
    return;
  }
  const btn = $("#build");
  btn.disabled = true;
  activeDate = fmtDate(new Date());
  localStorage.setItem("bf.activeDate", activeDate);
  clearSavedPlan();
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

      const dayMeals = selectThreeMealPeriods(periods);

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
        const extras = buildMealExtras(stations);
        const extraT = extrasTotals(extras);
        const budget = budgets[canonical];
        const mainBudget = {
          calories: Math.max(200, budget.calories - extraT.calories),
          protein: Math.max(10, budget.protein - extraT.protein),
          fatMax: budget.fatMax == null ? null : Math.max(5, budget.fatMax - extraT.fat),
          carbMax: budget.carbMax == null ? null : Math.max(10, budget.carbMax - extraT.carbs),
        };
        const pool = buildCandidatePool(stations, { ...prefs(), mealCanonical: canonicalMeal({ name: period.name, slug: period.slug }) });
        const result = optimizeMeal(pool, mainBudget, usage);
        result.mainTotals = result.totals;
        result.extras = extras;
        result.totals = combinedTotals(result.totals, extras);
        for (const pick of result.picks) {
          const k = itemKey(pick.item.station, pick.item.name);
          usage.set(k, (usage.get(k) || 0) + 1);
        }
        meals.push({ periodName: period.name, periodId: period.id, canonical, budget, stations, result });
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
    btn.disabled = false;
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
function mealRecordKey(day, meal) { return `${day.date}::${meal.periodId}`; }
function isMealEaten(day, meal) { return mealHistory().some((r) => r.key === mealRecordKey(day, meal)); }
function snapshotMeal(day, meal) {
  return {
    key: mealRecordKey(day, meal), date: day.date, label: day.label, periodName: meal.periodName,
    calories: Math.round(meal.result.totals.calories), protein: Math.round(meal.result.totals.protein),
    carbs: Math.round(meal.result.totals.carbs), fat: Math.round(meal.result.totals.fat),
    items: meal.result.picks.map((p) => ({ name: p.item.name, servings: p.servings, portion: p.item.portion, calories: Math.round(p.item.calories * p.servings), protein: Math.round(p.item.protein * p.servings), station: p.item.station })),
    extras: [...['fruit','vegetable'].map((t) => meal.result.extras?.[t]).filter(Boolean).map((x) => ({ type: classifyProduce(x) || 'extra', name: x.name, portion: x.portion, calories: Math.round(x.calories), protein: Math.round(x.protein) })), ...(meal.result.extras?.drinks || []).map((x) => ({ type: 'drink', name: x.name, portion: x.portion, calories: Math.round(x.calories), protein: Math.round(x.protein) }))]
  };
}
function toggleMealEaten(day, meal, checked) {
  if (isPastDate(day.date) || isFutureDate(day.date)) return;
  const records = mealHistory().filter((r) => r.key !== mealRecordKey(day, meal));
  if (checked) records.push(snapshotMeal(day, meal));
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
    const dayMeals = selectThreeMealPeriods(periods);
    if (!dayMeals.length) {
      weekPlan = weekPlan.filter((x) => x.date !== dateStr);
      weekPlan.push({ date:dateStr, label:dayLabel(d), meals:[], note:"No matching meal periods this day." });
      saveSavedPlan(); renderWeek(); setStatus(""); return;
    }
    const { budgets, coverage } = allocateBudgets(dailyTargets(dateStr), dayMeals.map((m) => ({canonical:m.canonical})), splitFractions());
    const meals = [];
    for (const {period, canonical} of dayMeals) {
      let stations=[]; try { stations=await getMenu(settings.locationId,dateStr,period.id); } catch {}
      const extras=buildMealExtras(stations), extraT=extrasTotals(extras), budget=budgets[canonical];
      const mainBudget={ calories:Math.max(200,budget.calories-extraT.calories), protein:Math.max(10,budget.protein-extraT.protein), fatMax:budget.fatMax==null?null:Math.max(5,budget.fatMax-extraT.fat), carbMax:budget.carbMax==null?null:Math.max(10,budget.carbMax-extraT.carbs) };
      const result=optimizeMeal(buildCandidatePool(stations,{ ...prefs(), mealCanonical: canonical }),mainBudget,new Map());
      result.mainTotals=result.totals; result.extras=extras; result.totals=combinedTotals(result.totals,extras);
      meals.push({periodName:period.name,periodId:period.id,canonical,budget,stations,result});
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
    ...picks.map((pick) => h('div', { class: 'item' },
      h('span', { class: 'servings' }, `${pick.servings}×`),
      h('div', { class: 'item-body' }, h('div', { class: 'item-name' }, pick.item.name), h('div', { class: 'item-meta' }, [pick.item.portion, `${Math.round(pick.item.calories)} cal`, `${Math.round(pick.item.protein)}g protein`].filter(Boolean).join(' · '))),
      h('button', { class: 'swap', title: "Don't suggest this item — pick something else", disabled: past, onclick: () => { if (past) return; excluded.add(itemKey(pick.item.station, pick.item.name)); saveExcluded(); reoptimizeMeal(day, meal); } }, '✕')
    ))
  ));
  const extraCards = [['fruit','Fruit','🍎'],['vegetable','Vegetable','🥦'],['drink','Drink','🥛']].map(([type,label,icon]) => renderExtraSelector(day, meal, type, label, icon));
  const eaten = isMealEaten(day, meal);
  const empty = !meal.result.picks.length;
  return h('div', { class: `meal ${eaten ? 'meal-eaten' : ''} ${past ? 'past-meal' : ''} ${future ? 'future-meal' : ''}`, 'data-meal': `${day.date}-${meal.periodId}` },
    h('div', { class: 'meal-head' },
      h('div', { class: 'meal-title-row' }, h('span', { class: 'meal-name' }, meal.periodName), eaten ? h('span', { class: 'meal-complete-badge' }, '✓ COMPLETED') : null),
      h('label', { class: `eaten-check ${eaten ? 'checked' : ''}` },
        h('input', { type: 'checkbox', checked: eaten, disabled: past || future, onchange: (e) => toggleMealEaten(day, meal, e.target.checked), 'aria-label': `Mark ${meal.periodName} as eaten` }),
        h('span', { class: 'eaten-box' }, eaten ? '✓' : ''),
        h('span', { class: 'eaten-label' }, past ? 'Past meal — locked' : future ? 'Future meal — not yet available to complete' : (eaten ? 'Meal eaten — complete' : 'I ate this meal as prescribed'))
      ),
      macroBar(meal.result.totals, meal.budget)
    ),
    empty ? h('div', { class: 'dim pad' }, meal.stations.length ? 'No items fit your filters for this meal.' : 'Menu not available.') : h('div', { class: 'stations' }, ...stationEls),
    h('div', { class: 'meal-extras' }, ...extraCards),
    h('div', { class: 'extra-note dim small' }, 'Drink options use generic nutrition values; the Buster’s beverage bar is not represented in DineOnCampus.')
  );
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

function bindPlanMode() {
  const mode = $("#plan-mode");
  if (!mode) return;
  mode.value = settings.planMode === "today" ? "today" : "week";
  mode.addEventListener("change", () => {
    settings.planMode = mode.value;
    saveSettings();
    $("#build").textContent = settings.planMode === "today" ? "Build today's plan 🍽️" : "Build my week 🗓️";
  });
  $("#build").textContent = settings.planMode === "today" ? "Build today's plan 🍽️" : "Build my week 🗓️";
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
  return confirm(`Changing this exercise will recalculate the meal plan for ${dayText}. All meals recorded as “eaten as prescribed” for ${dayText} will be reset to incomplete, because the calorie and nutrient targets may change.\n\nDo you want to continue?`);
}

async function rebuildPlanDay(dateStr) {
  const idx = weekPlan.findIndex((d) => d.date === dateStr);
  if (idx < 0) return;
  const oldDay = weekPlan[idx];
  const d = new Date(`${dateStr}T12:00:00`);
  const splits = splitFractions();
  let periods = [];
  try { periods = await getPeriods(settings.locationId, dateStr); } catch { periods = []; }
  const dayMeals = selectThreeMealPeriods(periods);
  if (!dayMeals.length) {
    weekPlan[idx] = { date: dateStr, label: oldDay.label || dayLabel(d), meals: [], note: "No matching meal periods this day." };
    renderWeek(); saveSavedPlan(); return;
  }
  const { budgets, coverage } = allocateBudgets(dailyTargets(dateStr), dayMeals.map((m) => ({ canonical: m.canonical })), splits);
  const meals = [];
  const usage = new Map();
  for (const { period, canonical } of dayMeals) {
    let stations = [];
    try { stations = await getMenu(settings.locationId, dateStr, period.id); } catch {}
    const extras = buildMealExtras(stations);
    const extraT = extrasTotals(extras);
    const budget = budgets[canonical];
    const mainBudget = {
      calories: Math.max(200, budget.calories - extraT.calories),
      protein: Math.max(10, budget.protein - extraT.protein),
      fatMax: budget.fatMax == null ? null : Math.max(5, budget.fatMax - extraT.fat),
      carbMax: budget.carbMax == null ? null : Math.max(10, budget.carbMax - extraT.carbs),
    };
    const pool = buildCandidatePool(stations, { ...prefs(), mealCanonical: canonicalMeal({ name: period.name, slug: period.slug }) });
    const result = optimizeMeal(pool, mainBudget, usage);
    result.mainTotals = result.totals;
    result.extras = extras;
    result.totals = combinedTotals(result.totals, extras);
    for (const pick of result.picks) { const k = itemKey(pick.item.station, pick.item.name); usage.set(k, (usage.get(k) || 0) + 1); }
    meals.push({ periodName: period.name, periodId: period.id, canonical, budget, stations, result });
  }
  weekPlan[idx] = { date: dateStr, label: oldDay.label || dayLabel(d), meals, note: coverage < 0.85 ? "Only some meals are published for this day, so the plan covers less than your full daily target." : null };
  renderWeek(); saveSavedPlan();
}

async function applyExerciseChange(affectedDates) {
  clearMealHistoryForDates(affectedDates);
  setStatus('Recalculating the affected meal plan…');
  try {
    for (const date of [...new Set(affectedDates)]) await rebuildPlanDay(date);
    renderHistory();
    setStatus('Meal plan recalculated. Previously completed meals for the affected day were reset.', 'info');
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

/* ---- boot -------------------------------------------------------------- */

bindTheme();

$("#build").addEventListener("click", buildWeek);
$("#retry").addEventListener("click", () => {
  $("#retry").hidden = true;
  initPickers();
});
$("#reset-excluded").addEventListener("click", () => {
  excluded = new Set();
  saveExcluded();
  setStatus("Cleared your excluded-items list.", "info");
  setTimeout(() => setStatus(""), 2000);
});

bindGoalInputs();
bindPlanMode();
bindExercise();
renderHistory();
initPickers();
