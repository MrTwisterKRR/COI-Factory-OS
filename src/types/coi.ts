export interface RecipeIO {
  id: string;
  name: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  icon: string;
  recipes: {
    input: string[];
    output: string[];
  };
  machines: {
    input: string[];
    output: string[];
  };
}

export interface Recipe {
  id: string;
  name: string;
  machine: string;
  duration: number;
  inputs: RecipeIO[];
  outputs: RecipeIO[];
}

export interface Machine {
  id: string;
  game_id?: string;
  icon: string;
  name: string;
  category_id: string;
  category_name: string;
  isMine?: boolean;
  isStorage?: boolean;
  isFarm?: boolean;
  workers: number;
  maintenance_cost_units: string | null;
  maintenance_cost_quantity: number;
  electricity_consumed: number;
  electricity_generated: number;
  computing_consumed: number;
  computing_generated: number;
  storage_capacity: number;
  unity_cost: number;
  research_speed: number;
  build_costs: RecipeIO[];
  recipes: string[];
  products: {
    input: string[];
    output: string[];
  };
}

export interface Category {
  id: string;
  name: string;
  machines: string[];
  recipes: string[];
}

export interface RawContract {
  id: string;
  product_to_buy_name: string;
  product_to_buy_quantity: number;
  product_to_pay_with_name: string;
  product_to_pay_with_quantity: number;
  unity_per_month: number;
  unity_per_100_bought: number;
  unity_to_establish: number;
  min_reputation_required: number;
}

export interface Contract extends RawContract {
  buyProductId: string | null;
  payProductId: string | null;
}

export interface TransportRaw {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  next_tier: string;
  maintenance_cost_units: string;
  maintenance_cost_quantity: number;
  electricity_consumed: number;
  throughput_per_second: number;
  icon_path: string;
  build_costs: { product: string; quantity: number }[];
}

export interface TransportTier {
  id: string;
  name: string;
  ruName: string;
  kind: 'flat' | 'loose' | 'fluid' | 'molten' | 'shaft';
  throughputPer60: number;
  throughputPerSec: number;
  electricityKw: number;
  icon: string;
}

export type RateUnit = '60s' | '1s' | '1m';

export interface ProductionTarget {
  id: string;
  productId: string;
  ratePer60: number;
  mode: 'rate' | 'machines';
  fixedMachines: number;
  recipeId?: string;
}

export interface FactoryPlanConfig {
  id: string;
  name: string;
  description?: string;
  targets: ProductionTarget[];
  recipeOverrides: Record<string, string>;
  rawResources: string[];
  contractOverrides: Record<string, string>;
  productionBoost: number;
  roundMachinesUp: boolean;
  onlyUnlockedInGame?: boolean;
}

export type TechStageMode =
  | 'game_sync'
  | 'stage_1'
  | 'stage_2'
  | 'stage_3'
  | 'stage_4'
  | 'all';

export interface UnlockedGameFilter {
  enabled: boolean;
  stageMode: TechStageMode;
  stagePreferredRecipes: Record<string, string>;
  unlockedRecipeIds: Set<string>;
  activeRecipeIds: Set<string>;
  unlockedProductIds: Set<string>;
  unlockedMachineIds: Set<string>;
  builtMachineIds: Set<string>;
}

export interface SolvedStepIO {
  productId: string;
  name: string;
  icon: string;
  ratePer60: number;
  ratePerMachine60: number;
  sourceType: 'step' | 'raw' | 'contract' | 'cycle' | 'target';
  isCycle?: boolean;
  beltInfo: LogisticsSummary | null;
}

export interface SolvedStep {
  stepId: string;
  kind: 'recipe' | 'contract';
  primaryProductId: string;
  recipeId?: string;
  contractId?: string;
  recipeName: string;
  machineId: string;
  machineName: string;
  machineIcon: string;
  categoryId: string;
  categoryName: string;
  duration: number;
  exactMachines: number;
  ceilMachines: number;
  effectiveMachines: number;
  isTarget: boolean;
  hasCycleInput: boolean;
  depth: number;
  inputs: SolvedStepIO[];
  outputs: SolvedStepIO[];
  surplusOutputs: { productId: string; ratePer60: number }[];
  workers: number;
  electricityConsumedKw: number;
  electricityGeneratedKw: number;
  computingTFlops: number;
  unityCost: number;
  maintenanceUnit: string;
  maintenanceQuantity: number;
  alternativeRecipeIds: string[];
  alternativeContractIds: string[];
}

export interface SolvedEdge {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  productId: string;
  ratePer60: number;
  isCycle: boolean;
}

export interface LogisticsSummary {
  kind: 'flat' | 'loose' | 'fluid' | 'molten' | 'virtual';
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  tier4Count?: number;
  recommendedLabel: string;
}

export interface FactorySummary {
  totalWorkers: number;
  electricityConsumedKw: number;
  electricityGeneratedKw: number;
  netElectricityKw: number;
  maintenance: {
    maintenance_i: number;
    maintenance_ii: number;
    maintenance_iii: number;
  };
  computingTFlops: number;
  unityConsumed: number;
  totalMachinesExact: number;
  totalMachinesCeil: number;
  buildCosts: {
    productId: string;
    name: string;
    icon: string;
    quantity: number;
  }[];
  rawInputs: {
    productId: string;
    name: string;
    icon: string;
    ratePer60: number;
    beltInfo: LogisticsSummary | null;
  }[];
  netOutputs: {
    productId: string;
    name: string;
    icon: string;
    ratePer60: number;
    isTarget: boolean;
    isPollution: boolean;
    isSurplus: boolean;
  }[];
}

export interface SolveResult {
  steps: SolvedStep[];
  edges: SolvedEdge[];
  summary: FactorySummary;
  targetDiagnostics: {
    targetId: string;
    productId: string;
    actualRatePer60: number;
    recipeId: string | null;
    machinesUsed: number;
  }[];
  cyclesDetected: { fromProductId: string; toProductId: string }[];
}
