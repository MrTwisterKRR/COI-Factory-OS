import translations from './raw/translations_ru.json';

interface TranslationsFile {
  products: Record<string, string>;
  machines: Record<string, string>;
  machinesDesc: Record<string, string>;
  categories: Record<string, string>;
  recipes: Record<string, string>;
}

const T = translations as TranslationsFile;

export const PRODUCT_RU: Record<string, string> = T.products;
export const MACHINE_RU: Record<string, string> = T.machines;
export const MACHINE_DESC_RU: Record<string, string> = T.machinesDesc;
export const CATEGORY_RU: Record<string, string> = T.categories;
export const RECIPE_RU: Record<string, string> = T.recipes;

export function getProductRu(id: string): string | undefined {
  return PRODUCT_RU[id];
}

export function getMachineRu(id: string): string | undefined {
  return MACHINE_RU[id];
}

export function getMachineDescRu(id: string): string | undefined {
  return MACHINE_DESC_RU[id];
}

export function getRecipeRu(id: string): string | undefined {
  return RECIPE_RU[id];
}

export function getCategoryRu(id: string, fallback: string): string {
  return CATEGORY_RU[id] ?? fallback;
}
