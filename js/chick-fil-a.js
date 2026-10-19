/*
 * Chick-fil-A — Boise State static menu
 *
 * Menu roster is based on the Boost ordering items supplied for Bronco Fuel.
 * Individual-item calories/macros/portion sizes use Chick-fil-A's official
 * Nutrition & Allergens guide where a matching entry is available:
 * https://www.chick-fil-a.com/nutrition-allergens
 *
 * Boost's “meal” names are not standalone nutrition rows in the guide. Those
 * entries below are calculated estimates using the named entrée + medium
 * Waffle Potato Fries + a medium fountain Coke (unless the entrée is nuggets,
 * in which case it is the stated nugget count + the same sides/drink). Real
 * meal totals vary with drink choice, customizations, and actual serving size.
 * Some limited-time beverages are estimates until the current guide publishes
 * a matching row. These are static values, not a live Chick-fil-A feed.
 */
const food = (name, station, portion, calories, protein, carbs, fat, extra = {}) => ({
  name, station, desc: '', portion, calories, protein, carbs, fat,
  hasNutrition: true, labels: [], allergens: [], chickFilA: true, ...extra,
});

const sandwich = {
  regular: { name: 'CFA Regular', portion: '1 sandwich · 183 g', c: 420, p: 29, cb: 41, f: 16 },
  regularLT: { name: 'CFA Regular w/ Lettuce & Tomato', portion: '1 sandwich · estimated with toppings', c: 425, p: 29, cb: 42, f: 16 },
  deluxe: { name: 'CFA Deluxe', portion: '1 sandwich · 247 g', c: 490, p: 32, cb: 43, f: 21 },
  grilledClub: { name: 'CFA Grilled Club', portion: '1 sandwich · 237 g', c: 520, p: 37, cb: 45, f: 22 },
  grilled: { name: 'CFA Grilled', portion: '1 sandwich · 206 g', c: 390, p: 28, cb: 45, f: 11 },
  spicy: { name: 'CFA Spicy', portion: '1 sandwich · 188 g', c: 450, p: 28, cb: 44, f: 18 },
  spicyLT: { name: 'CFA Spicy w/ Lettuce & Tomato', portion: '1 sandwich · estimated with toppings', c: 455, p: 28, cb: 45, f: 18 },
  spicyDeluxe: { name: 'CFA Spicy Deluxe', portion: '1 sandwich · 259 g', c: 540, p: 34, cb: 46, f: 24 },
  lettuceWrap: { name: 'Lettuce Wrap', portion: '1 regular filet wrapped in lettuce · estimate', c: 310, p: 28, cb: 10, f: 16 },
  coolWrap: { name: 'Chick-fil-A® Cool Wrap', portion: '1 wrap · 231 g', c: 660, p: 43, cb: 32, f: 45 },
};
const grilledFilet = { name: 'CFA Grilled', portion: '1 grilled sandwich · 206 g', c: 390, p: 28, cb: 45, f: 11 };
const mediumFries = { c: 420, p: 5, cb: 45, f: 24 };
const mediumCoke = { c: 170, p: 0, cb: 46, f: 0 };
function combo(name, entree, portion) {
  return food(name, 'Chick-fil-A — Meals', portion || '1 entrée + medium fries + medium fountain Coke (estimated)',
    entree.c + mediumFries.c + mediumCoke.c,
    entree.p + mediumFries.p + mediumCoke.p,
    entree.cb + mediumFries.cb + mediumCoke.cb,
    entree.f + mediumFries.f + mediumCoke.f,
    { nutritionEstimated: true });
}

export const CHICK_FIL_A_MENU = [
  {
    station: 'Chick-fil-A — Nuggets', items: [
      food('8 piece Chicken Nuggets', 'Chick-fil-A — Nuggets', '8 pieces · 113 g', 250, 27, 11, 11),
      food('12 piece Chicken Nuggets', 'Chick-fil-A — Nuggets', '12 pieces · 170 g', 380, 40, 16, 17),
      food('30 piece Chicken Nuggets', 'Chick-fil-A — Nuggets', '30 pieces · 425 g', 950, 100, 41, 43),
      food('Grilled 8 piece Nuggets', 'Chick-fil-A — Nuggets', '8 pieces · 95 g', 130, 25, 1, 3),
      food('Grilled 12 piece Nuggets', 'Chick-fil-A — Nuggets', '12 pieces · 142 g', 200, 38, 2, 4.5),
      food('Grilled 30 piece Nuggets', 'Chick-fil-A — Nuggets', '30 pieces · 369 g', 510, 98, 4, 11),
    ],
  },
  {
    station: 'Chick-fil-A — Meals', items: [
      combo('CFA Regular Meal', sandwich.regular),
      combo('CFA Deluxe Meal', sandwich.deluxe),
      combo('CFA Grilled Club Meal', sandwich.grilledClub),
      combo('CFA Grilled Meal', sandwich.grilled),
      combo('CFA Reg. Meal w/ Lettuce & Tomato', sandwich.regularLT),
      combo('CFA Spicy Meal w/ Lettuce & Tomato', sandwich.spicyLT),
      combo('CFA Spicy Meal', sandwich.spicy),
      combo('CFA Spicy Deluxe Meal', sandwich.spicyDeluxe),
      combo('Chick-fil-A® Cool Wrap Meal', sandwich.coolWrap),
      combo('CFA 8 Piece Meal', { name: '8 ct nuggets', c: 250, p: 27, cb: 11, f: 11 }, '8 nuggets + medium fries + medium fountain Coke (estimated)'),
      combo('CFA 12 Piece Meal', { name: '12 ct nuggets', c: 380, p: 40, cb: 16, f: 17 }, '12 nuggets + medium fries + medium fountain Coke (estimated)'),
      combo('CFA Grilled Meal 8 Piece', { name: '8 ct grilled nuggets', c: 130, p: 25, cb: 1, f: 3 }, '8 grilled nuggets + medium fries + medium fountain Coke (estimated)'),
      combo('CFA Grilled Meal 12 Piece', { name: '12 ct grilled nuggets', c: 200, p: 38, cb: 2, f: 4.5 }, '12 grilled nuggets + medium fries + medium fountain Coke (estimated)'),
    ],
  },
  {
    station: 'Chick-fil-A — Sandwiches', items: [
      food(sandwich.regular.name, 'Chick-fil-A — Sandwiches', sandwich.regular.portion, sandwich.regular.c, sandwich.regular.p, sandwich.regular.cb, sandwich.regular.f),
      food(sandwich.regularLT.name, 'Chick-fil-A — Sandwiches', sandwich.regularLT.portion, sandwich.regularLT.c, sandwich.regularLT.p, sandwich.regularLT.cb, sandwich.regularLT.f, { nutritionEstimated: true }),
      food(sandwich.deluxe.name, 'Chick-fil-A — Sandwiches', sandwich.deluxe.portion, sandwich.deluxe.c, sandwich.deluxe.p, sandwich.deluxe.cb, sandwich.deluxe.f),
      food(sandwich.grilledClub.name, 'Chick-fil-A — Sandwiches', sandwich.grilledClub.portion, sandwich.grilledClub.c, sandwich.grilledClub.p, sandwich.grilledClub.cb, sandwich.grilledClub.f),
      food(sandwich.grilled.name, 'Chick-fil-A — Sandwiches', sandwich.grilled.portion, sandwich.grilled.c, sandwich.grilled.p, sandwich.grilled.cb, sandwich.grilled.f),
      food(sandwich.spicy.name, 'Chick-fil-A — Sandwiches', sandwich.spicy.portion, sandwich.spicy.c, sandwich.spicy.p, sandwich.spicy.cb, sandwich.spicy.f),
      food(sandwich.spicyLT.name, 'Chick-fil-A — Sandwiches', sandwich.spicyLT.portion, sandwich.spicyLT.c, sandwich.spicyLT.p, sandwich.spicyLT.cb, sandwich.spicyLT.f, { nutritionEstimated: true }),
      food(sandwich.spicyDeluxe.name, 'Chick-fil-A — Sandwiches', sandwich.spicyDeluxe.portion, sandwich.spicyDeluxe.c, sandwich.spicyDeluxe.p, sandwich.spicyDeluxe.cb, sandwich.spicyDeluxe.f),
      food(sandwich.lettuceWrap.name, 'Chick-fil-A — Sandwiches', sandwich.lettuceWrap.portion, sandwich.lettuceWrap.c, sandwich.lettuceWrap.p, sandwich.lettuceWrap.cb, sandwich.lettuceWrap.f, { nutritionEstimated: true }),
      food(sandwich.coolWrap.name, 'Chick-fil-A — Sandwiches', sandwich.coolWrap.portion, sandwich.coolWrap.c, sandwich.coolWrap.p, sandwich.coolWrap.cb, sandwich.coolWrap.f),
      food('Regular Filet', 'Chick-fil-A — Sandwiches', '1 breaded filet', 140, 23, 1, 4),
      food('Spicy Filet', 'Chick-fil-A — Sandwiches', '1 spicy breaded filet', 180, 21, 6, 7),
      food('Grilled Filet', 'Chick-fil-A — Sandwiches', '1 grilled filet', 110, 21, 1, 2.5),
    ],
  },
  {
    station: 'Chick-fil-A — Sides', items: [
      food('Large Waffle Potato Fries', 'Chick-fil-A — Sides', '1 large · approx. 154 g', 600, 7, 65, 35),
      food('Medium Waffle Potato Fries', 'Chick-fil-A — Sides', '1 medium · approx. 125 g', 420, 5, 45, 24),
      food('Waffle Potato Chips', 'Chick-fil-A — Sides', '1 bag · approx. 28 g', 220, 3, 25, 12),
      food('Mac & Cheese', 'Chick-fil-A — Sides', '1 medium · 227 g', 450, 20, 28, 29),
      food('Kale Crunch Side', 'Chick-fil-A — Sides', '1 side · approx. 85 g', 170, 4, 13, 12),
      food('Fruit Cup', 'Chick-fil-A — Sides', '1 medium cup', 60, 1, 15, 0),
      food('Greek Yogurt Parfait', 'Chick-fil-A — Sides', '1 parfait', 270, 13, 36, 8),
      food('Side Salad', 'Chick-fil-A — Sides', '1 side salad; dressing may vary', 470, 9, 27, 38, { nutritionEstimated: true }),
      food('Chick-fil-A Chips', 'Chick-fil-A — Sides', '1 bag', 220, 3, 25, 12),
      food('Lettuce & Tomato', 'Chick-fil-A — Sides', 'topping portion · estimate', 10, 0.5, 2, 0, { nutritionEstimated: true, chickFilALowCal: true }),
    ],
  },
  {
    station: 'Chick-fil-A — Treats & Shakes', items: [
      food('Frosted Lemonade', 'Chick-fil-A — Treats & Shakes', '1 medium · estimate', 350, 6, 65, 8, { nutritionEstimated: true }),
      food('Frosted Lemonade w/ Diet Lemonade', 'Chick-fil-A — Treats & Shakes', '1 medium · estimate', 250, 6, 49, 8, { nutritionEstimated: true }),
      food('Frosted Strawberry Lemonade', 'Chick-fil-A — Treats & Shakes', '1 medium · estimate', 370, 6, 70, 8, { nutritionEstimated: true }),
      food('Frosted Dragonfruit Lemonade', 'Chick-fil-A — Treats & Shakes', '1 medium · seasonal estimate', 360, 5, 70, 8, { nutritionEstimated: true }),
      food('Frosted Strawberry Lemonade Diet', 'Chick-fil-A — Treats & Shakes', '1 medium · estimate', 270, 6, 54, 8, { nutritionEstimated: true }),
      food('6ct Chocolate Chunk Cookies', 'Chick-fil-A — Treats & Shakes', '6 cookies · 6 × 1-cookie serving', 2220, 30, 294, 102, { nutritionEstimated: true, portion: '6 cookies (based on 1 cookie each)' }),
      food('Chocolate Chunk Cookie', 'Chick-fil-A — Treats & Shakes', '1 cookie · approx. 85 g', 370, 5, 49, 17),
      food('Chocolate Fudge Brownie', 'Chick-fil-A — Treats & Shakes', '1 brownie', 370, 6, 49, 18),
      food('Ice Cream Cone', 'Chick-fil-A — Treats & Shakes', '1 Icedream cone', 170, 4, 29, 4.5),
      food('Ice Cream Cup', 'Chick-fil-A — Treats & Shakes', '1 Icedream cup · 122 g', 140, 4, 24, 3.5),
      food('Cookies', 'Chick-fil-A — Treats & Shakes', '1 chocolate chunk cookie', 370, 5, 49, 17),
      food('Strawberry Milkshake', 'Chick-fil-A — Treats & Shakes', '1 medium · 409 g', 560, 10, 92, 18),
      food('Vanilla Milkshake', 'Chick-fil-A — Treats & Shakes', '1 medium · 409 g', 580, 13, 82, 23),
      food('Chocolate Milkshake', 'Chick-fil-A — Treats & Shakes', '1 medium · 409 g', 600, 12, 93, 22),
      food('Cookies and Cream Milkshake', 'Chick-fil-A — Treats & Shakes', '1 medium · estimate', 610, 13, 84, 25, { nutritionEstimated: true }),
    ],
  },
  {
    station: 'Chick-fil-A — Beverages', items: [
      food('Sunjoy (1/2 Sweet Tea, 1/2 Lemonade)', 'Chick-fil-A — Beverages', '1 medium · estimate', 190, 0, 49, 0, { nutritionEstimated: true }),
      food('Sunjoy (1/2 Sweet Tea, 1/2 Diet Lemonade)', 'Chick-fil-A — Beverages', '1 medium · estimate', 100, 0, 25, 0, { nutritionEstimated: true }),
      food('Sunjoy (1/2 Unsweet Tea, 1/2 Lemonade)', 'Chick-fil-A — Beverages', '1 medium · estimate', 150, 0, 38, 0, { nutritionEstimated: true }),
      food('Sunjoy (1/2 Unsweet Tea, 1/2 Diet Lemonade)', 'Chick-fil-A — Beverages', '1 medium · estimate', 10, 0, 2, 0, { nutritionEstimated: true, chickFilALowCal: true }),
      food('Freshly-Brewed Iced Tea Sweetened', 'Chick-fil-A — Beverages', '1 medium · estimate', 120, 0, 30, 0, { nutritionEstimated: true }),
      food('Freshly-Brewed Iced Tea Unsweetened', 'Chick-fil-A — Beverages', '1 medium', 0, 0, 0, 0, { chickFilALowCal: true }),
      food('Chick-fil-A® Lemonade', 'Chick-fil-A — Beverages', '1 medium · estimate', 240, 0, 60, 0, { nutritionEstimated: true }),
      food('Chick-fil-A Dragonfruit Lemonade', 'Chick-fil-A — Beverages', '1 medium · seasonal estimate', 220, 0, 55, 0, { nutritionEstimated: true }),
      food('Chick-fil-A® Diet Lemonade', 'Chick-fil-A — Beverages', '1 medium · estimate', 20, 0, 5, 0, { nutritionEstimated: true, chickFilALowCal: true }),
      food('Medium Fountain Beverage', 'Chick-fil-A — Beverages', '1 medium · Coke used for meal estimates', 170, 0, 46, 0),
      food('Large Fountain Beverage', 'Chick-fil-A — Beverages', '1 large · Coke estimate', 250, 0, 64, 0, { nutritionEstimated: true }),
      food('Bottled Water', 'Chick-fil-A — Beverages', '1 bottle', 0, 0, 0, 0, { chickFilALowCal: true }),
    ],
  },
  {
    station: 'Chick-fil-A — Sauces', items: [
      food('Chick-fil-A Sauce', 'Chick-fil-A — Sauces', '1 packet · 28 g', 140, 0, 6, 13),
      food('Honey Mustard Sauce', 'Chick-fil-A — Sauces', '1 packet · 28 g', 50, 0, 11, 0),
      food('Ketchup', 'Chick-fil-A — Sauces', '1 packet', 10, 0, 2, 0, { chickFilALowCal: true }),
      food('Barbeque Sauce', 'Chick-fil-A — Sauces', '1 packet · 28 g', 45, 0, 11, 0),
      food('Sweet and Spicy Siracha', 'Chick-fil-A — Sauces', '1 packet · 28 g', 45, 0, 11, 0),
      food('Honey Roasted BBQ Sauce', 'Chick-fil-A — Sauces', '1 packet · 12 g', 60, 0, 3, 5),
      food('Polynesian Sauce', 'Chick-fil-A — Sauces', '1 packet · 28 g', 110, 0, 14, 6),
      food('Zesty Buffalo Sauce', 'Chick-fil-A — Sauces', '1 packet · 21 g', 25, 0, 1, 2.5),
      food('Garden Herb Ranch Sauce', 'Chick-fil-A — Sauces', '1 packet · 21 g', 100, 0, 1, 11),
    ],
  },
];

export function isChickFilALocation(name = '') {
  return /chick\s*[- ]?fil\s*[- ]?a/i.test(String(name));
}

export function getChickFilAMenu() {
  return CHICK_FIL_A_MENU.map((group) => ({
    station: group.station,
    items: group.items.map((item) => ({ ...item, labels: [...(item.labels || [])], allergens: [...(item.allergens || [])] })),
  }));
}
