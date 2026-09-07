# 🍽️ Bronco Fuel

A cafeteria meal planner that reads your school's live DineOnCampus menu (defaults: Boise State → Buster's Kitchen) and tells you which stations to visit and how many servings to grab to hit your calorie and protein goals.

## What's new

- **Planning period:** choose **Today only** or **This week**. The original weekly planner remains the default.
- **Balanced meal additions:** each planned meal now suggests a **fruit, vegetable, and drink** when suitable items are available in that meal's DineOnCampus menu.
- **Milk preference:** milk is preferred as the drink when it is available and compatible with dietary/allergen settings; otherwise the app recommends water.
- **Nutrition-aware additions:** calories, protein, carbs, and fat from the suggested additions are included in the meal and daily totals. The main-food optimizer reserves room for those additions rather than simply adding them on top of the existing meal budget.
- Existing presets, meal splits, diet filters, allergen filters, excluded-item swapping, variety logic, DineOnCampus caching, PWA behavior, and light/dark appearance are retained.

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
