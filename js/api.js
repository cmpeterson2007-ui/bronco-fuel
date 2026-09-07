/* DineOnCampus API client (apiv4) with localStorage caching.
 * All requests run client-side in the user's browser — the API is public
 * and this is the same traffic the dineoncampus.com site itself generates.
 */

const DOC_API = "https://api.dineoncampus.com/v1";

const CACHE_PREFIX = "bf.cache.";

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { exp, data } = JSON.parse(raw);
    if (Date.now() > exp) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function cacheSet(key, data, ttlMs) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ exp: Date.now() + ttlMs, data }));
  } catch {
    // Storage full — drop oldest cache entries and retry once.
    pruneCache();
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ exp: Date.now() + ttlMs, data }));
    } catch { /* give up silently; caching is best-effort */ }
  }
}

function pruneCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
}

async function apiGet(path, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(DOC_API + path, { headers: { Accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const HOUR = 3600e3;

export async function getSchools() {
  const cached = cacheGet("schools");
  if (cached) return cached;
  const data = await apiGet("/sites/public?domain=dineoncampus");
  const sites = (data.sites || []).map((s) => ({ id: s.id, name: s.name }));
  cacheSet("schools", sites, 7 * 24 * HOUR);
  return sites;
}

export async function getLocations(siteId) {
  const key = `locations.${siteId}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await apiGet(`/locations/status?site_id=${encodeURIComponent(siteId)}&platform=0`);
  const locs = (data.locations || []).map((l) => ({ id: l.id, name: l.name }));
  cacheSet(key, locs, 24 * HOUR);
  return locs;
}

export async function getPeriods(locationId, dateStr) {
  const key = `periods.${locationId}.${dateStr}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await apiGet(`/location/${encodeURIComponent(locationId)}/periods?platform=0&date=${dateStr}`);
  const periods = (data.periods || []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: (p.slug || p.name || "").toLowerCase(),
  }));
  cacheSet(key, periods, 6 * HOUR);
  return periods;
}

export async function getMenu(locationId, dateStr, periodId) {
  const key = `menu.${locationId}.${dateStr}.${periodId}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await apiGet(
    `/location/${encodeURIComponent(locationId)}/periods/${encodeURIComponent(periodId)}?platform=0&date=${dateStr}`
  );
  const menu = normalizeMenu(data);
  cacheSet(key, menu, 6 * HOUR);
  return menu;
}

/* ---- normalization ------------------------------------------------- */

function normalizeMenu(payload) {
  // v4 shape: { period: { categories: [...] } }; older v1: { menu: { periods: { categories } } }
  const period =
    (payload && payload.period) ||
    (payload && payload.menu && payload.menu.periods) ||
    {};
  const categories = period.categories || [];
  const stations = [];
  for (const cat of categories) {
    const items = (cat.items || []).map(normalizeItem).filter(Boolean);
    if (items.length) stations.push({ station: cat.name || "Station", items });
  }
  return stations;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findNutrient(nutrients, matcher) {
  for (const n of nutrients) {
    const name = (n.name || "").toLowerCase();
    if (matcher(name)) {
      const val = num(n.value_numeric) ?? num(n.value);
      if (val != null) return val;
    }
  }
  return null;
}

function normalizeItem(it) {
  if (!it || !it.name) return null;
  const nutrients = it.nutrients || [];
  const calories =
    num(it.calories) ??
    findNutrient(nutrients, (n) => n.startsWith("calories") && !n.includes("from fat"));
  const protein = findNutrient(nutrients, (n) => n.startsWith("protein"));
  const carbs = findNutrient(nutrients, (n) => n.includes("carbohydrate"));
  const fat =
    findNutrient(nutrients, (n) => n.startsWith("total fat")) ??
    findNutrient(nutrients, (n) => n === "fat" || n.startsWith("fat ("));

  const filters = it.filters || [];
  const labels = filters.filter((f) => f.type === "label").map((f) => f.name);
  const allergens = filters.filter((f) => f.type === "allergen").map((f) => f.name);

  return {
    name: it.name.trim(),
    desc: it.desc || "",
    portion: it.portion || "",
    calories: calories ?? 0,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
    hasNutrition: calories != null,
    labels,
    allergens,
  };
}
