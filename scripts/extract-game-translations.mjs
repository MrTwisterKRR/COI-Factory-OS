import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const rawDir = path.join(rootDir, 'src', 'data', 'raw');

const gameTranslationsDir =
  'D:\\SteamLibrary\\steamapps\\common\\Captain of Industry\\Translations';

const enArr = JSON.parse(
  fs.readFileSync(path.join(gameTranslationsDir, 'en.json'), 'utf8'),
);
const ruArr = JSON.parse(
  fs.readFileSync(path.join(gameTranslationsDir, 'ru.json'), 'utf8'),
);

const clean = (s) =>
  typeof s === 'string'
    ? s.replace(/\\u00AD|\u00AD/g, '').trim()
    : '';

const keyToRu = new Map();
for (const [k, v] of ruArr) {
  keyToRu.set(k, clean(v));
}

const enLowerToRu = new Map();
for (const [k, enVal] of enArr) {
  const ruVal = keyToRu.get(k);
  if (ruVal && typeof enVal === 'string') {
    const low = clean(enVal).toLowerCase();
    if (!enLowerToRu.has(low)) {
      enLowerToRu.set(low, ruVal);
    }
  }
}

const productsRaw = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'products.json'), 'utf8'),
);
const machinesRaw = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'machines.json'), 'utf8'),
);
const recipesRaw = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'recipes.json'), 'utf8'),
);
const categoriesRaw = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'categories.json'), 'utf8'),
);

// 1. Products (222/222)
const productsRu = {};
for (const [id, p] of Object.entries(productsRaw)) {
  const ru = enLowerToRu.get(p.name.toLowerCase());
  productsRu[id] = ru || p.name;
}

// 2. Machines (179/179)
const SPECIAL_MACHINE_RU = {
  assembly_i: 'Сборочная линия I (ручная)',
  assembly_ii: 'Сборочная линия II (электрическая)',
  assembly_iii: 'Сборочная линия III',
  assembly_iv: 'Сборочная линия IV (роботизированная)',
  assembly_v: 'Сборочная линия V (роботизированная)',
  research_lab_basic: 'Полевая лаборатория',
  research_lab_i: 'Лаборатория I',
  research_lab_ii: 'Лаборатория II',
  research_lab_iii: 'Лаборатория III',
  research_lab_iv: 'Лаборатория IV',
};

const MINE_PRODUCT_BY_MACHINE = {
  coal_mine: 'coal',
  copper_mine: 'copper_ore',
  dirt_mine: 'dirt',
  gold_mine: 'gold_ore',
  gravel_mine: 'gravel',
  iron_mine: 'iron_ore',
  limestone_mine: 'limestone',
  rock_mine: 'rock',
  sand_mine: 'sand',
  slag_crushed_mine: 'slag_crushed',
  slag_mine: 'slag',
  waste_mine: 'waste',
};

const machinesRu = {};
const machinesDescRu = {};
for (const [id, m] of Object.entries(machinesRaw)) {
  if (SPECIAL_MACHINE_RU[id]) {
    machinesRu[id] = SPECIAL_MACHINE_RU[id];
  } else if (MINE_PRODUCT_BY_MACHINE[id]) {
    const prodId = MINE_PRODUCT_BY_MACHINE[id];
    machinesRu[id] = `Карьер: ${productsRu[prodId] ?? m.name}`;
  } else {
    const exact =
      enLowerToRu.get(m.name.toLowerCase()) ||
      (m.game_id ? keyToRu.get(`${m.game_id}__name`) : undefined);
    machinesRu[id] = exact || m.name;
  }
  const desc = m.game_id ? keyToRu.get(`${m.game_id}__desc`) : undefined;
  if (desc) {
    machinesDescRu[id] = desc;
  }
}

// 3. Categories
const CATEGORY_OVERRIDES_RU = {
  mines: 'Шахты и Карьеры',
};
const categoriesRu = {};
for (const [id, c] of Object.entries(categoriesRaw)) {
  categoriesRu[id] =
    CATEGORY_OVERRIDES_RU[id] || enLowerToRu.get(c.name.toLowerCase()) || c.name;
}

// 4. Recipes (1587/1587)
// Sort product EN names longest-first for clean substring replacement
const prodNameEntries = Object.values(productsRaw)
  .map((p) => ({ en: p.name, ru: productsRu[p.id] }))
  .sort((a, b) => b.en.length - a.en.length);

const PROCESS_TERMS = [
  [/\bCP4 Assembly\b/gi, 'Сборка стройдеталей IV'],
  [/\bCP3 Assembly\b/gi, 'Сборка стройдеталей III'],
  [/\bCP2 Assembly\b/gi, 'Сборка стройдеталей II'],
  [/\bCP Assembly\b/gi, 'Сборка стройдеталей I'],
  [/\bMech\. Parts Assembly\b/gi, 'Сборка мех. деталей'],
  [/\bMicrochip Manufacturing\b/gi, 'Производство микрочипов'],
  [/\bFast Breeder Reactor\b/gi, 'Реактор на быстрых нейтронах'],
  [/\bNuclear Reactor\b/gi, 'Ядерный реактор'],
  [/\bCrude Oil Refining\b/gi, 'Перегонка нефти'],
  [/\bHeavy Oil Cracking\b/gi, 'Крекинг тяжёлой нефти'],
  [/\bHeavy Distillate Refining\b/gi, 'Перегонка лёгкой нефти'],
  [/\bSour Water Stripping\b/gi, 'Очистка кислой воды'],
  [/\bSteam Generation\b/gi, 'Генерация пара'],
  [/\bAir Separation\b/gi, 'Разделение воздуха'],
  [/\bWater Desalination\b/gi, 'Опреснение воды'],
  [/\bThermal Desalination\b/gi, 'Термоопреснение'],
  [/\bWater Pumping\b/gi, 'Добыча воды'],
  [/\bOcean Water Pumping\b/gi, 'Забор морской воды'],
  [/\bOil Pumping\b/gi, 'Добыча нефти'],
  [/\bExhaust Filtering\b/gi, 'Фильтрация выхлопа'],
  [/\bExhaust Scrubbing\b/gi, 'Очистка выхлопа'],
  [/\bDepleted Steam Condensation\b/gi, 'Конденсация отработанного пара'],
  [/\bHi-Press Steam Condensation\b/gi, 'Конденсация пара выс. давл.'],
  [/\bLo-Press Steam Condensation\b/gi, 'Конденсация пара низк. давл.'],
  [/\bSuper-Press Steam Condensation\b/gi, 'Конденсация сверхкрит. пара'],
  [/\bFinal Stage\b/gi, 'Финальный этап'],
  [/\bStage\b/gi, 'Этап'],
  [/\bSmelting\b/gi, 'Выплавка'],
  [/\bCasting Cooled\b/gi, 'Охлаждаемое литьё'],
  [/\bCasting\b/gi, 'Литьё'],
  [/\bMixing\b/gi, 'Смешивание'],
  [/\bAssembly\b/gi, 'Сборка'],
  [/\bManufacturing\b/gi, 'Производство'],
  [/\bProduction\b/gi, 'Производство'],
  [/\bMaking\b/gi, 'Производство'],
  [/\bSynthesis\b/gi, 'Синтез'],
  [/\bCracking\b/gi, 'Крекинг'],
  [/\bReforming\b/gi, 'Риформинг'],
  [/\bDistillation\b/gi, 'Дистилляция'],
  [/\bRefining\b/gi, 'Перегонка'],
  [/\bElectrolysis\b/gi, 'Электролиз'],
  [/\bPurification\b/gi, 'Очистка'],
  [/\bLeaching\b/gi, 'Выщелачивание'],
  [/\bTreatment\b/gi, 'Обработка'],
  [/\bCooling\b/gi, 'Охлаждение'],
  [/\bCrushing\b/gi, 'Дробление'],
  [/\bMilling\b/gi, 'Помол'],
  [/\bShredding\b/gi, 'Измельчение'],
  [/\bCompacting\b/gi, 'Прессование'],
  [/\bPressing\b/gi, 'Прессование'],
  [/\bSettling\b/gi, 'Осаждение'],
  [/\bCrystallization\b/gi, 'Кристаллизация'],
  [/\bCalcification\b/gi, 'Кальцинация'],
  [/\bEnrichment\b/gi, 'Обогащение'],
  [/\bReprocessing\b/gi, 'Переработка'],
  [/\bDigestion\b/gi, 'Анаэроб. сбраживание'],
  [/\bFermentation\b/gi, 'Ферментация'],
  [/\bBaking\b/gi, 'Выпечка'],
  [/\bIncineration\b/gi, 'Сжигание'],
  [/\bBurning\b/gi, 'Сжигание'],
  [/\bDumping\b/gi, 'Сброс'],
  [/\bDisposal\b/gi, 'Утилизация'],
  [/\bStorage\b/gi, 'Хранение'],
  [/\bMining\b/gi, 'Добыча'],
  [/\bSorting\b/gi, 'Сортировка'],
  [/\bTransesterification\b/gi, 'Переэтерификация'],
  [/\bResearch Lab\b/gi, 'Лаборатория'],
  [/\bFertilizer\b/gi, 'Удобрение'],
  [/\bConcrete\b/gi, 'Бетон'],
  [/\bSoybeans\b/gi, 'Соя'],
  [/\bUranium\b/gi, 'Уран'],
  [/\bComposing\b/gi, 'Компостирование'],
  [/\bFruits\b/gi, 'Фрукты'],
  [/\bPumping\b/gi, 'Насос'],
  [/\bThermal\b/gi, 'Термо'],
  [/\bRods\b/gi, 'Стержни'],
  [/\bOcean\b/gi, 'Морской'],
  [/\bSilicon\b/gi, 'Кремний'],
  [/\bTitanium\b/gi, 'Титан'],
  [/\bProcessing\b/gi, 'Обработка'],
  [/\bFiltering\b/gi, 'Фильтрация'],
  [/\bFuelGas\b/gi, 'Топливный газ'],
  [/\bHeavyOil\b/gi, 'Тяжёлая нефть'],
  [/\bBlanket\b/gi, 'Бланкет'],
  [/\bNeutralization\b/gi, 'Нейтрализация'],
  [/\bCharcoal\b/gi, 'Древесный уголь'],
  [/\bIlmenite\b/gi, 'Ильменит'],
  [/\bFluoride\b/gi, 'Фторид'],
  [/\bSteam\b/gi, 'Пар'],
  [/\bStripping\b/gi, 'Отгонка'],
  [/\bRecovery\b/gi, 'Регенерация'],
  [/\bProduct\b/gi, 'Продукт'],
  [/\bInto\b/gi, 'в'],
  [/\bSimple\b/gi, 'Прост.'],
  [/\bWet\b/gi, 'Мокр.'],
  [/\bInjection\b/gi, 'Закачка'],
  [/\bCooled\b/gi, 'охл.'],
  [/\bLime\b/gi, 'известняк'],
  [/\bArc\b/gi, 'дуг.'],
  [/\bScrap\b/gi, 'лом'],
  [/\bBroken\b/gi, 'бой'],
  [/\bPressed\b/gi, 'прессованный'],
  [/\bConcentrate\b/gi, 'концентрат'],
  [/\bPowder\b/gi, 'порошок'],
  [/\bCrushed\b/gi, 'дробл.'],
  [/\bRaw\b/gi, 'сырой'],
  [/\bHeated\b/gi, 'подогрев'],
  [/\bElectric\b/gi, 'электро'],
  [/\bExhaust\b/gi, 'выхлоп'],
  [/\bGas\b/gi, 'газ'],
  [/\bFuel\b/gi, 'топливо'],
  [/\bOrganic\b/gi, 'органика'],
  [/\bSapling\b/gi, 'саженец'],
  [/\bTree\b/gi, 'дерево'],
  [/\bPowerLevel\b/gi, 'мощность'],
  [/\bBasic\b/gi, 'Баз.'],
  [/\bAdvanced\b/gi, 'Продв.'],
  [/\bAlt\b/gi, 'Альт.'],
  [/\bFrom\b/gi, 'из'],
  [/\bWith\b/gi, 'с'],
  [/\bAnd\b/gi, 'и'],
  [/\bTo\b/gi, 'в'],
  [/\bIn\b/gi, 'в'],
];

function translateRecipeName(r) {
  const exact = enLowerToRu.get(r.name.toLowerCase());
  if (exact && !/^(Нефтехимия|Смешивание|Перегонка)$/i.test(exact)) return exact;

  // Handle storage recipes cleanly
  if (/ Storage$/i.test(r.name) && r.outputs[0]) {
    const pName = productsRu[r.outputs[0].id] ?? r.outputs[0].name;
    return `Хранение: ${pName}`;
  }

  let text = r.name;
  // Replace product names first so multi-word product names aren't fragmented
  for (const { en, ru } of prodNameEntries) {
    if (en.length >= 3 && ru) {
      const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ru);
    }
  }
  for (const [regex, replacement] of PROCESS_TERMS) {
    text = text.replace(regex, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

const recipesRu = {};
for (const [id, r] of Object.entries(recipesRaw)) {
  recipesRu[id] = translateRecipeName(r);
}

const output = {
  generatedAt: new Date().toISOString(),
  source: gameTranslationsDir,
  products: productsRu,
  machines: machinesRu,
  machinesDesc: machinesDescRu,
  categories: categoriesRu,
  recipes: recipesRu,
};

const outPath = path.join(rawDir, 'translations_ru.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

console.log('Generated:', outPath);
console.log('Products:', Object.keys(productsRu).length);
console.log('Machines:', Object.keys(machinesRu).length);
console.log('Machines with desc:', Object.keys(machinesDescRu).length);
console.log('Recipes:', Object.keys(recipesRu).length);

console.log('\nSample Machines:');
for (const id of [
  'assembly_i',
  'assembly_iii',
  'blast_furnace_ii',
  'arc_furnace_ii',
  'distillation_stage_ii',
  'cracking_unit',
  'copper_electrolysis',
  'iron_mine',
  'air_separator',
  'data_center',
]) {
  console.log(`  ${id}: ${machinesRaw[id]?.name} => ${machinesRu[id]}`);
}

console.log('\nSample Recipes:');
for (const id of [
  'cp3_assembly_t2',
  'iron_smelting_lime',
  'steel_casting_cooled',
  'crude_oil_refining_2',
  'acid_mixing',
  'microchip_manufacturing_final_stage',
  'copper_purification_acid',
]) {
  console.log(`  ${id}: ${recipesRaw[id]?.name} => ${recipesRu[id]}`);
}
