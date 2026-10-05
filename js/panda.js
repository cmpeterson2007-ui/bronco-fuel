/*
 * Panda Express — Boise State static menu
 *
 * The DineOnCampus Panda Express feed is incomplete, so Bronco Fuel uses this
 * curated roster whenever the selected location is Panda Express. The item
 * list comes from the Boise State ordering screenshots supplied for Bronco
 * Fuel. Nutrition values are based on Panda Express' official Nutrition &
 * Allergen information page. The current Panda menu also confirms the
 * Cantonese BBQ Brisket at 410 calories; Panda's official press material lists
 * 44g protein per serving. The 16g carbohydrate value below is derived from
 * the published 410-calorie / 44g protein / 19g fat figures.
 *
 * Official nutrition source:
 * https://www.pandaexpress.com/nutritioninformation
 */

const item = (name, role, calories, protein, carbs, fat, portion, extra = {}) => ({
  name,
  desc: '',
  portion,
  calories,
  protein,
  carbs,
  fat,
  hasNutrition: true,
  labels: [],
  allergens: extra.allergens || [],
  pandaExpress: true,
  pandaRole: role,
  ...extra,
});

export const PANDA_EXPRESS_MENU = [
  {
    station: 'Panda Express — Entrées',
    items: [
      item('Orange Chicken', 'entree', 560, 19, 63, 25, '6.2 oz'),
      item('Cantonese BBQ Brisket', 'entree', 410, 44, 16, 19, '5.61 oz', { allergens: ['Wheat', 'Soy', 'Sesame'] }),
      item('Honey Sesame Chicken', 'entree', 420, 16, 44, 20, '6.2 oz'),
      item('Teriyaki Chicken', 'entree', 280, 38, 13, 9, '6.1 oz'),
      item('Kung Pao Chicken', 'entree', 270, 20, 16, 14, '6.7 oz'),
      item('Mushroom Chicken', 'entree', 180, 13, 12, 9, '5.7 oz'),
      item('Sweet Fire Chicken', 'entree', 360, 15, 40, 15, '5.8 oz'),
      item('Beijing Beef', 'entree', 480, 14, 46, 27, '5.6 oz'),
      item('Honey Walnut Shrimp', 'entree', 340, 13, 28, 20, '4.4 oz'),
    ],
  },
  {
    station: 'Panda Express — Sides',
    items: [
      item('Steamed Rice', 'side', 570, 11, 129, 0, '12 oz'),
      item('Fried Rice', 'side', 610, 15, 109, 13, '12 oz'),
      item('Chow Mein', 'side', 520, 14, 89, 12, '12 oz'),
      item('1/2 White Rice 1/2 Chow Mein', 'side', 545, 12.5, 109, 6, '12 oz total'),
      item('1/2 Chow Mein 1/2 Fried Rice', 'side', 565, 14.5, 99, 12.5, '12 oz total'),
      item('1/2 Fried Rice 1/2 White Rice', 'side', 590, 13, 119, 6.5, '12 oz total'),
    ],
  },
  {
    station: 'Panda Express — Add-ons',
    items: [
      item('Vegetable Spring Roll', 'addon', 240, 4, 24, 14, '2 rolls'),
      item('Chicken Eggroll', 'addon', 200, 6, 20, 10, '1 roll'),
      item('Cream Cheese Rangoon (3)', 'addon', 190, 5, 24, 8, '3 pieces'),
      item('Extra Teriyaki Sauce', 'addon', 70, 0, 16, 0, '1 packet/portion'),
    ],
  },
];

export function isPandaExpressLocation(name = '') {
  return /panda\s*express/i.test(String(name));
}

export function getPandaExpressMenu() {
  // Return fresh item objects so a saved/edited meal can never mutate the
  // canonical static menu roster.
  return PANDA_EXPRESS_MENU.map((group) => ({
    station: group.station,
    items: group.items.map((x) => ({ ...x, labels: [...x.labels], allergens: [...x.allergens] })),
  }));
}
