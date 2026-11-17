import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const rawDir = path.join(rootDir, 'src', 'data', 'raw');

const machines = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'machines.json'), 'utf8'),
);
const recipes = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'recipes.json'), 'utf8'),
);
const products = JSON.parse(
  fs.readFileSync(path.join(rawDir, 'products.json'), 'utf8'),
);

const gameTranslationsEnPath =
  'D:\\SteamLibrary\\steamapps\\common\\Captain of Industry\\Translations\\en.json';

function cleanStr(s) {
  return typeof s === 'string' ? s.replace(/\\u00AD|\u00AD/g, '').trim() : '';
}

async function main() {
  const res = await fetch(
    'https://raw.githubusercontent.com/David-Melo/captain-of-data/main/data/machines_and_buildings.json',
    { headers: { 'User-Agent': 'coi-factory-calculator' } },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch machines_and_buildings.json: ${res.status}`);
  }
  const mbData = await res.json();
  const mbByGameId = new Map(
    mbData.machines_and_buildings.map((m) => [m.id, m]),
  );

  // Map Products from game Translations/en.json
  const enArr = JSON.parse(fs.readFileSync(gameTranslationsEnPath, 'utf8'));
  const gameProdByEnName = new Map();
  for (const [k, v] of enArr) {
    if (typeof k === 'string' && k.startsWith('Product_') && k.endsWith('__name')) {
      const gameId = k.slice(0, -6); // strip "__name"
      const low = cleanStr(v).toLowerCase();
      if (!gameProdByEnName.has(low)) {
        gameProdByEnName.set(low, gameId);
      }
    }
  }

  const productToGameId = {};
  const gameIdToProduct = {};
  let prodMatched = 0;
  const prodTotal = Object.keys(products).length;
  for (const [pid, p] of Object.entries(products)) {
    const gameId = gameProdByEnName.get(cleanStr(p.name).toLowerCase());
    if (gameId) {
      productToGameId[pid] = gameId;
      if (!gameIdToProduct[gameId]) {
        gameIdToProduct[gameId] = pid;
      }
      prodMatched++;
    } else {
      console.warn(`Unmatched product: ${pid} (${p.name})`);
    }
  }

  const recipeToGameId = {};
  const gameIdToRecipe = {};
  let matched = 0;
  let total = 0;

  for (const m of Object.values(machines)) {
    if (m.isStorage || m.isMine) continue;
    const rawM = mbByGameId.get(m.game_id);
    if (!rawM) continue;

    for (const rid of m.recipes) {
      total++;
      const r = recipes[rid];
      if (!r) continue;
      const found = rawM.recipes.find((rr) => {
        if (
          rr.inputs.length !== r.inputs.length ||
          rr.outputs.length !== r.outputs.length
        ) {
          return false;
        }
        const factor = rr.duration > 0 ? 60 / rr.duration : 1;
        const inOk = r.inputs.every((ri) =>
          rr.inputs.some(
            (x) =>
              x.name.toLowerCase() === ri.name.toLowerCase() &&
              Math.abs(x.quantity * factor - ri.quantity) < 0.25,
          ),
        );
        const outOk = r.outputs.every((ro) =>
          rr.outputs.some(
            (x) =>
              x.name.toLowerCase() === ro.name.toLowerCase() &&
              Math.abs(x.quantity * factor - ro.quantity) < 0.25,
          ),
        );
        return inOk && outOk;
      });

      if (found) {
        recipeToGameId[rid] = found.id;
        if (!gameIdToRecipe[found.id]) {
          gameIdToRecipe[found.id] = rid;
        }
        matched++;
      }
    }
  }

  const outPath = path.join(rawDir, 'recipe_game_ids.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        recipeToGameId,
        gameIdToRecipe,
        productToGameId,
        gameIdToProduct,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(
    `Mapped ${matched}/${total} recipes and ${prodMatched}/${prodTotal} products -> ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
