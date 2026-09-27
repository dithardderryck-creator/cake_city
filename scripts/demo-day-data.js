/**
 * Bakery inputs, recipes, customers and the day's order book.
 *
 * Quantities are the real working numbers a small cake shop in Dar es Salaam
 * would use, and every ingredient is used in exactly one unit, because the
 * recipe lines carry no unit of their own and the app does no unit conversion.
 * Mixing grams and kilos on the same ingredient would make the tap sheet lie.
 */

const INGREDIENTS = [
  // jina, kiasi_kilichopo, kiwango_cha_chini, unit
  ['Unga', 20, 6, 'kg'],
  ['Sukari', 20, 6, 'kg'],
  ['Mayai', 64, 24, 'vipansi'],
  ['Siperi', 6, 2, 'kg'],
  ['Maziwa', 12, 4, 'ltr'],
  ['Kakao', 2.5, 0.8, 'kg'],
  ['Vanilla', 250, 100, 'ml'],
  ['Mvumilizo (baking powder)', 500, 150, 'g'],
  ['Chokoleti ya kunywa', 1.5, 0.5, 'kg'],
  ['Vitoto vya chokoleti (chips)', 1, 0.3, 'kg'],
  ['Karoti', 4, 1.5, 'kg'],
  ['Ndizi', 24, 12, 'vipansi'],
  ['Rangi ya kahawia', 100, 40, 'ml'],
  ['Rangi nyekundu', 100, 40, 'ml'],
  ['Mafuko ya cupcake', 500, 200, 'vipansi'],
  ['Cream ya kupenga', 4, 1.5, 'ltr'],
];

const CATEGORIES = ['Vinywaji', 'Vyakula', 'Nyumbani'];

const PRODUCTS = [
  // jina, bei (TZS), familia, ukubwa, category
  ['Soda 500ml', 1500, 'Soda', '500ml', 'Vinywaji'],
  ['Chupa ya maji 1.5L', 1000, 'Maji', '1.5L', 'Vinywaji'],
  ['Vinywaji vya matunda', 1200, 'Juice', '300ml', 'Vinywaji'],
  ['Chips', 2000, 'Chips', '70g', 'Vyakula'],
  ['Biskuiti', 1000, 'Biscuit', '100g', 'Vyakula'],
  ['Sukari ya koo', 2500, 'Sukari', '1kg', 'Nyumbani'],
];

/**
 * Recipes. `ing` entries are [ingredient name, min, max, sehemu label].
 * The label matters: the app keys a line on (recipe, ingredient, sehemu), so
 * "chai ya kwanza" and "kwenye utaratibu" are two separate lines on purpose.
 */
const RECIPES = [
  {
    ladha: 'Keki ya Chokoleti',
    ukubwa: 'Large',
    dakika: 90,
    ing: [
      ['Unga', 0.8, 1.0, 'nafuu'],
      ['Sukari', 0.9, 1.1, 'nafuu'],
      ['Mayai', 10, 12, 'vipansi'],
      ['Siperi', 0.4, 0.5, 'kuchakata'],
      ['Maziwa', 0.3, 0.4, 'ltr'],
      ['Kakao', 0.15, 0.2, 'kuchakata'],
      ['Vanilla', 2, 3, 'ml'],
      ['Mvumilizo (baking powder)', 8, 10, 'g'],
      ['Chokoleti ya kunywa', 0.2, 0.3, 'mapambo'],
      ['Rangi ya kahawia', 5, 10, 'ml'],
    ],
  },
  {
    ladha: 'Sponge ya Vanilla',
    ukubwa: 'Medium',
    dakika: 75,
    ing: [
      ['Unga', 0.5, 0.6, 'nafuu'],
      ['Sukari', 0.5, 0.6, 'nafuu'],
      ['Mayai', 6, 8, 'vipansi'],
      ['Siperi', 0.25, 0.3, 'kuchakata'],
      ['Maziwa', 0.2, 0.25, 'ltr'],
      ['Vanilla', 2, 3, 'ml'],
      ['Mvumilizo (baking powder)', 5, 6, 'g'],
    ],
  },
  {
    ladha: 'Keki ya Karoti',
    ukubwa: 'Small',
    dakika: 80,
    ing: [
      ['Unga', 0.35, 0.4, 'nafuu'],
      ['Sukari', 0.35, 0.4, 'nafuu'],
      ['Mayai', 6, 8, 'vipansi'],
      ['Siperi', 0.2, 0.25, 'kuchakata'],
      ['Maziwa', 0.15, 0.2, 'ltr'],
      ['Karoti', 0.5, 0.6, 'kuchakata'],
      ['Kakao', 0.02, 0.03, 'kuchakata'],
      ['Mvumilizo (baking powder)', 4, 5, 'g'],
    ],
  },
  {
    ladha: 'Cupcake ya Vanilla',
    ukubwa: '12 vipansi',
    dakika: 45,
    ing: [
      ['Unga', 0.3, 0.35, 'nafuu'],
      ['Sukari', 0.25, 0.3, 'nafuu'],
      ['Mayai', 4, 5, 'vipansi'],
      ['Siperi', 0.15, 0.2, 'kuchakata'],
      ['Maziwa', 0.1, 0.15, 'ltr'],
      ['Vanilla', 1, 2, 'ml'],
      ['Mafuko ya cupcake', 12, 12, 'vipansi'],
    ],
  },
  {
    ladha: 'Biskuiti za Chokoleti',
    ukubwa: '20 vipansi',
    dakika: 35,
    ing: [
      ['Unga', 0.4, 0.45, 'nafuu'],
      ['Sukari', 0.3, 0.35, 'nafuu'],
      ['Siperi', 0.2, 0.25, 'kuchakata'],
      ['Mayai', 2, 3, 'vipansi'],
      ['Vitoto vya chokoleti (chips)', 0.25, 0.3, 'kuchakata'],
    ],
  },
  {
    ladha: 'Keki ya Red Velvet',
    ukubwa: 'Small',
    dakika: 95,
    ing: [
      ['Unga', 0.3, 0.35, 'nafuu'],
      ['Sukari', 0.3, 0.35, 'nafuu'],
      ['Mayai', 5, 6, 'vipansi'],
      ['Siperi', 0.2, 0.25, 'kuchakata'],
      ['Maziwa', 0.15, 0.2, 'ltr'],
      ['Kakao', 0.02, 0.03, 'kuchakata'],
      ['Rangi nyekundu', 10, 15, 'ml'],
      ['Mvumilizo (baking powder)', 4, 5, 'g'],
    ],
  },
  {
    ladha: 'Mkate wa Ndizi',
    ukubwa: 'Moja',
    dakika: 60,
    ing: [
      ['Unga', 0.3, 0.35, 'nafuu'],
      ['Sukari', 0.25, 0.3, 'nafuu'],
      ['Mayai', 3, 4, 'vipansi'],
      ['Siperi', 0.15, 0.2, 'kuchakata'],
      ['Ndizi', 3, 4, 'vipansi'],
      ['Mvumilizo (baking powder)', 5, 6, 'g'],
    ],
  },
  {
    ladha: 'Keki ya Siku ya Kuzaliwa',
    ukubwa: '3 Tabaka',
    dakika: 120,
    ing: [
      ['Unga', 1.2, 1.4, 'nafuu'],
      ['Sukari', 1.4, 1.6, 'nafuu'],
      ['Mayai', 16, 18, 'vipansi'],
      ['Siperi', 0.7, 0.8, 'kuchakata'],
      ['Maziwa', 0.5, 0.6, 'ltr'],
      ['Kakao', 0.1, 0.12, 'kuchakata'],
      ['Cream ya kupenga', 1.5, 2, 'ltr'],
      ['Chokoleti ya kunywa', 0.3, 0.4, 'mapambo'],
      ['Rangi ya kahawia', 15, 20, 'ml'],
      ['Mvumilizo (baking powder)', 12, 15, 'g'],
    ],
  },
];

/**
 * Slices of a parent cake. These carry no ingredient lines of their own; the
 * kitchen sheet derives them by scaling the parent by sehemu_ya_uzito.
 */
const SLICES = [
  { ladha: 'Keki ya Chokoleti', ukubwa: 'Nusu', parent: 'Keki ya Chokoleti|Large', ratio: 0.5, dakika: 90 },
  { ladha: 'Sponge ya Vanilla', ukubwa: 'Sehemu 1/4', parent: 'Sponge ya Vanilla|Medium', ratio: 0.25, dakika: 75 },
  { ladha: 'Keki ya Chokoleti', ukubwa: 'Sehemu 1/4', parent: 'Keki ya Chokoleti|Large', ratio: 0.25, dakika: 90 },
];

/** Customers. mzio is the allergy the kitchen must see. */
const CUSTOMERS = [
  { jina: 'Neema Joseph', simu: '0754102266', mzio: 'Ina alerji kwa njegere (peanut)' },
  { jina: 'Joseph Kimaro', simu: '0713004477' },
  { jina: 'Amina Said', simu: '0677018890', mzio: '' },
  { jina: 'Peter Mwakyembe', simu: '0755881120', mzio: 'Hana gluten' },
  { jina: 'Fatuma Ally', simu: '0629003311' },
  { jina: 'Grace Mushi', simu: '0712887745', mzio: 'Ina alerji kwa maziwa' },
  { jina: 'Zawadi Mwakasebe', simu: '0655442210' },
];

/**
 * The order book for the day, in the order it happened.
 *
 * `flow` is the sequence of status changes applied afterwards by the kitchen,
 * which is what makes the collected orders genuinely pass through the oven
 * rather than appearing finished.
 */
const ORDERS = [
  {
    who: 'Neema Joseph', recipe: 'Keki ya Chokoleti|Large', bei: 120000, deposit: 120000,
    pay: 'cash', design: 'Maandishi: "Happy Birthday Mama"', umbo: 'Mzunguko',
    maelezo: 'Tamba za pembe, rangi ya kahawia na rangi ya peach', flow: ['in_progress', 'ready', 'collected'],
  },
  {
    who: 'Joseph Kimaro', recipe: 'Sponge ya Vanilla|Medium', bei: 75000, deposit: 75000,
    pay: 'mpesa', maelezo: 'Iwe na matishio ya matufi', flow: ['in_progress', 'ready', 'collected'],
  },
  {
    who: 'Amina Said', recipe: 'Cupcake ya Vanilla|12 vipansi', bei: 60000, deposit: 30000,
    pay: 'cash', maelezo: 'Vipansi 6 vya buluu, vengineye pembe', flow: ['in_progress', 'ready', 'collected'],
    balance: 30000,
  },
  {
    who: 'Peter Mwakyembe', recipe: 'Keki ya Karoti|Small', bei: 55000, deposit: 55000,
    pay: 'tigopesa', maelezo: 'Gluten-free, tumia unga wa mazoezi', flow: ['in_progress', 'ready', 'collected'],
  },
  {
    who: 'Grace Mushi', recipe: 'Biskuiti za Chokoleti|20 vipansi', bei: 45000, deposit: 45000,
    pay: 'mpesa', maelezo: 'Chips nyingi', flow: ['in_progress', 'ready'],
  },
  {
    who: 'Neema Joseph', recipe: 'Keki ya Red Velvet|Small', bei: 85000, deposit: 40000,
    pay: 'cash', maelezo: 'Maandishi: "Happy Anniversary"', flow: ['in_progress'],
    usage: { used: true, verified: true },
  },
  {
    who: null, recipe: 'Mkate wa Ndizi|Moja', bei: 30000, deposit: 30000,
    pay: 'cash', mgeni: 'Mgeni wa siku', flow: ['in_progress'],
    usage: { used: true, verified: false },
  },
  {
    who: 'Fatuma Ally', recipe: 'Sponge ya Vanilla|Sehemu 1/4', bei: 22000, deposit: 22000,
    pay: 'mpesa', maelezo: 'Nusu, kwa vijana wawili', flow: [],
  },
  {
    who: 'Grace Mushi', recipe: 'Keki ya Chokoleti|Nusu', bei: 60000, deposit: 60000,
    pay: 'cash', maelezo: 'Nusu ya keki ya chokoleti, rangi ya kahawia', flow: [],
  },
  {
    who: 'Zawadi Mwakasebe', recipe: 'Keki ya Siku ya Kuzaliwa|3 Tabaka', bei: 450000, deposit: 150000,
    pay: 'mpesa', tomorrow: true,
    maelezo: 'Tabaka 3, maua kwenye kila tabaka, andika "Happy Birthday Zawadi"', flow: [],
  },
];

/** Retail counter sales through the day. */
const COUNTER_SALES = [
  { items: [['Soda 500ml', 2], ['Chupa ya maji 1.5L', 1]], pay: 'cash' },
  { items: [['Chips', 1], ['Biskuiti', 2]], pay: 'mpesa' },
  { items: [['Sukari ya koo', 1], ['Soda 500ml', 3]], pay: 'cash' },
  { items: [['Vinywaji vya matunda', 2]], pay: 'airtel_money' },
  { items: [['Biskuiti', 1], ['Soda 500ml', 1], ['Chips', 1]], pay: 'cash' },
];

/** Stock movements that are not recipe usage. */
const ADJUSTMENTS = [
  { ing: 'Unga', aina: 'restock', kiasi: 25, sababu: 'Uninguzaji wa mwezi — 50kg bag' },
  { ing: 'Sukari', aina: 'restock', kiasi: 25, sababu: 'Uninguzaji wa mwezi — 50kg bag' },
  { ing: 'Mayai', aina: 'restock', kiasi: 30, sababu: 'Tray ya mayai (30 vipansi)' },
  { ing: 'Cream ya kupenga', aina: 'waste', kiasi: 0.5, sababu: 'Imeharibika — haikuhifadhiwa baridi' },
  { ing: 'Maziwa', aina: 'waste', kiasi: 0.5, sababu: 'Imefika tarehe ya kumaliza' },
];

/** Staff requests. `closedBy` names who clears it. */
const REQUESTS = [
  { from: 'chef', to: 'inventory', ujumbe: 'Unga umeisha. Nakuhitaji kilo 10 za sasa.', closed: true, jibu: 'Nimeongeza kilo 25. Ipo sasa.' },
  { from: 'cashier', to: 'chef', ujumbe: 'Mteja ameuliza keki ya tabaka tatu kwa kesho. Utaweza?', closed: false },
  { from: 'inventory', to: 'owner', ujumbe: 'Cream ya kupenga iko chini ya kiwango. Tunaweza kununua?', closed: false },
  { from: 'chef', to: 'inventory', ujumbe: 'Sukari iko karibu kukoseka. Naomba kuongezwa.', closed: true, jibu: 'Ongeza kilo 25. Asante.' },
];

module.exports = {
  INGREDIENTS,
  CATEGORIES,
  PRODUCTS,
  RECIPES,
  SLICES,
  CUSTOMERS,
  ORDERS,
  COUNTER_SALES,
  ADJUSTMENTS,
  REQUESTS,
};
