import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'src', 'data', 'raw');
const publicAssetsDir = path.join(rootDir, 'public', 'assets');
const tmpDir = path.join(rootDir, '.tmp-fetch');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(publicAssetsDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const DATA_FILES = [
  {
    name: 'products.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captains-calculator/main/src/data/products.json',
  },
  {
    name: 'recipes.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captains-calculator/main/src/data/recipes.json',
  },
  {
    name: 'machines.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captains-calculator/main/src/data/machines.json',
  },
  {
    name: 'categories.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captains-calculator/main/src/data/categories.json',
  },
  {
    name: 'mines.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captains-calculator/main/src/data/mines.json',
  },
  {
    name: 'storages.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captains-calculator/main/src/data/storages.json',
  },
  {
    name: 'contracts.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captain-of-data/main/data/contracts.json',
  },
  {
    name: 'transports.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captain-of-data/main/data/transports.json',
  },
  {
    name: 'vehicles.json',
    url: 'https://raw.githubusercontent.com/David-Melo/captain-of-data/main/data/vehicles.json',
  },
];

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'coi-factory-calculator-setup' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

async function main() {
  console.log('1. Downloading JSON game data...');
  for (const file of DATA_FILES) {
    const dest = path.join(dataDir, file.name);
    const bytes = await downloadFile(file.url, dest);
    // Validate JSON
    JSON.parse(fs.readFileSync(dest, 'utf8'));
    console.log(`   ✓ ${file.name} (${(bytes / 1024).toFixed(1)} KB)`);
  }

  console.log('2. Downloading icons tarball from David-Melo/captains-calculator...');
  const tarballPath = path.join(tmpDir, 'captains-calculator.tar.gz');
  const tarBytes = await downloadFile(
    'https://codeload.github.com/David-Melo/captains-calculator/tar.gz/refs/heads/main',
    tarballPath,
  );
  console.log(`   ✓ Tarball downloaded (${(tarBytes / 1024 / 1024).toFixed(2)} MB)`);

  console.log('3. Extracting public/assets...');
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarballPath, '-C', extractDir], { stdio: 'inherit' });

  const extractedRoots = fs.readdirSync(extractDir);
  if (extractedRoots.length === 0) {
    throw new Error('Tarball extraction produced empty directory');
  }
  const repoRoot = path.join(extractDir, extractedRoots[0]);
  const srcAssets = path.join(repoRoot, 'public', 'assets');
  if (!fs.existsSync(srcAssets)) {
    throw new Error(`Expected public/assets at ${srcAssets}`);
  }
  copyDirRecursive(srcAssets, publicAssetsDir);

  // Also grab transport icons from David-Melo/captain-of-data if any missing
  const categories = fs.readdirSync(publicAssetsDir);
  console.log(`   ✓ Extracted asset folders: ${categories.join(', ')}`);
  for (const folder of categories) {
    const count = fs.readdirSync(path.join(publicAssetsDir, folder)).length;
    console.log(`     - ${folder}: ${count} files`);
  }

  // Verify key assets
  const verifyFiles = [
    path.join(publicAssetsDir, 'products', 'Acid.png'),
    path.join(publicAssetsDir, 'buildings', 'AirSeparator.png'),
  ];
  for (const vf of verifyFiles) {
    if (!fs.existsSync(vf)) {
      throw new Error(`Verification failed: missing ${vf}`);
    }
  }
  console.log('   ✓ Verified Acid.png and AirSeparator.png exist.');

  // Clean up tmp
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('Done!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
