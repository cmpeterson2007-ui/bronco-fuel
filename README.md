# 🍽️ Bronco Fuel

A cafeteria meal planner that reads your school's live DineOnCampus menu (defaults: Boise State → Buster's Kitchen) and tells you which stations to visit and how many servings to grab to hit your calorie and protein goals.

## What's new

- **Planning period:** choose **Today only** or **This week**. The original weekly planner remains the default.
- **Balanced meal additions:** each planned meal now suggests a **fruit, vegetable, and drink** when suitable items are available in that meal's DineOnCampus menu.
- **Drink choices:** choose skim, whole, or chocolate milk, water, juices, soda, diet soda, or Powerade. Milk is hidden when vegan or avoiding milk.
- **Nutrition-aware additions:** calories, protein, carbs, and fat from the suggested additions are included in the meal and daily totals. The main-food optimizer reserves room for those additions rather than simply adding them on top of the existing meal budget.
- **Direct food swaps:** each planned food can be swapped for up to five alternatives that keep the rest of the meal unchanged and stay within the meal's calorie/protein/cap limits when possible.
- **Per-meal dining location:** change an individual meal to another Boise State dining location (including Panda Express or La Tapatia when published by DineOnCampus) without changing the rest of the day.
- **La Mesa handling:** generic Torta entries are excluded; when La Mesa is used, the planner tries to build a composed plate with beans + rice + a meat/protein item instead of selecting only one component.
- Existing presets, meal splits, diet filters, allergen filters, excluded-item recalculation, variety logic, DineOnCampus caching, PWA behavior, and light/dark appearance are retained.

## How it works

- Your browser fetches the public DineOnCampus API directly. There is no backend.
- You set daily calories, protein, optional fat/carb caps, meals, calorie splits, and dietary filters.
- The planner pulls the menu for each selected day and meal period and uses the existing greedy + local-search optimizer for the main dishes.
- Fruit, vegetable, and drink suggestions are selected from the same menu data and obey the existing dietary/allergen/excluded-item preferences.

## Run locally

Any static file server works:

```sh
cd bronco-fuel
python3 -m http.server 8471
# open http://localhost:8471
```

## Notes

Nutrition values are the cafeteria's own published estimates per listed portion; treat them as a guide. Menus may not be published for future days yet.

## Install Bronco Fuel on Android

Bronco Fuel is a Progressive Web App (PWA). Once this folder is deployed over HTTPS, open the site in Chrome on Android and choose **Install app** from Chrome's menu (or the install prompt when shown). It will appear on the Android home screen and launch in standalone app mode.

## Deployment

This is a static site. It can be deployed directly from the `main` branch of a GitHub repository using Cloudflare Pages. No build command is required; the repository root is the publish directory.

## Test build
Meal Reset Variety · 2026-09-19 · 20:20 MDT
- Weekend plans use Breakfast, Lunch, Dinner; Breakfast/Lunch may share the published Brunch menu.
- Meal Reset strongly prefers a different food set while allowing required repeat foods when necessary.
- Added visible version marker in the app header.


## v26 additions (2026-10-12)

- Adds static Buster's Kitchen Bake items missing from DineOnCampus: one-cup soft-serve ice cream estimate and Cheerios, Lucky Charms, Golden Grahams, Cinnamon Toast Crunch, and Froot Loops. Values are estimates based on USDA FoodData Central and product-label serving information; actual dispenser portions and product labels can differ.
- Preserves open manual food-picker groups and their internal scroll position when recalculating the meal after an item is added.
- Adds boxing, climbing, cycling, and rowing exercise choices using general/moderate MET estimates from the 2024 Adult Compendium of Physical Activities.


## v30 — Chick-fil-A static menu (2026-10-19)

- Added `js/chick-fil-a.js`, a static menu based on the Boost ordering item list supplied for Bronco Fuel.
- The menu is selected when a Chick-fil-A location is chosen, and its static all-day menu is reused for Breakfast, Lunch, and Dinner cards.
- Item nutrition and serving sizes use Chick-fil-A's official Nutrition & Allergens guide where matching entries are available: https://www.chick-fil-a.com/nutrition-allergens
- Combo meals are calculated estimates (entrée + medium Waffle Potato Fries + medium fountain Coke). Items whose current exact values were not available as matching guide rows are marked in source as estimates. Combo totals vary by drink and customization.
- Visible build tag and service-worker cache are updated to v30.


## v31 — Produce, Status & Protein Labels (2026-10-19)
- Separate fruit and vegetable add-on pickers are available only for Buster's Kitchen and SouthFork.
- Manual planning status now explains that Bronco Fuel is gathering data from DineOnCampus.
- Underallocation notices reference the current saved eaten-meal calorie total instead of relying only on a stale number.
- Top-five protein suggestions display a subdued dining-station label.


## v32 — Reversible Meal Adjustments (2026-10-19)
- Unchecking a meal as eaten reverses the unused-calorie transfer from the receiving meal's budget.
- Removes the adjustment notice tied to that transfer, and allows the source meal to be checked again without stale transfer state.
- Visible build tag and service-worker cache are updated to v32.
