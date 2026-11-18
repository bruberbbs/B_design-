// Regras do jogo "Maré de Aço": estatísticas de unidades, construções e armas.

export type Team = 0 | 1; // 0 = jogador, 1 = IA

export type Armor = "none" | "light" | "heavy" | "building";
export type WeaponKind = "bullet" | "cannon" | "rocket" | "shell";

export type UnitKind = "rifle" | "rocket" | "scout" | "tank" | "heavy" | "artillery" | "harvester";
export type BuildingKind = "hq" | "power" | "refinery" | "barracks" | "factory" | "radar" | "turret";

export type Producer = "structure" | "infantry" | "vehicle";

export interface Weapon {
  kind: WeaponKind;
  damage: number;
  range: number;
  minRange?: number;
  reload: number; // segundos
  splash?: number; // raio em tiles
  shots?: number; // tiros por rajada
  projectileSpeed?: number; // tiles/s (0 = instantâneo)
}

export interface UnitDef {
  kind: UnitKind;
  name: string;
  short: string;
  desc: string;
  cost: number;
  buildTime: number;
  hp: number;
  speed: number;
  armor: Armor;
  sight: number;
  radius: number;
  infantry: boolean;
  producer: Producer;
  requires: BuildingKind[];
  weapon?: Weapon;
  turret: boolean;
}

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  desc: string;
  cost: number;
  buildTime: number;
  hp: number;
  w: number;
  h: number;
  power: number; // positivo gera, negativo consome
  sight: number;
  requires: BuildingKind[];
  weapon?: Weapon;
  buildable: boolean;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  rifle: {
    kind: "rifle",
    name: "Fuzileiro",
    short: "Fuzileiro",
    desc: "Infantaria barata. Forte contra infantaria.",
    cost: 100,
    buildTime: 4,
    hp: 70,
    speed: 1.35,
    armor: "none",
    sight: 5,
    radius: 0.18,
    infantry: true,
    producer: "infantry",
    requires: ["barracks"],
    weapon: { kind: "bullet", damage: 9, range: 3.6, reload: 0.85 },
    turret: false,
  },
  rocket: {
    kind: "rocket",
    name: "Lança-mísseis",
    short: "Mísseis",
    desc: "Infantaria antiblindagem de longo alcance.",
    cost: 300,
    buildTime: 7,
    hp: 60,
    speed: 1.15,
    armor: "none",
    sight: 6,
    radius: 0.18,
    infantry: true,
    producer: "infantry",
    requires: ["barracks"],
    weapon: { kind: "rocket", damage: 34, range: 5, reload: 2.4, projectileSpeed: 9, splash: 0.4 },
    turret: false,
  },
  scout: {
    kind: "scout",
    name: "Batedor",
    short: "Batedor",
    desc: "Veículo rápido de reconhecimento com metralhadora.",
    cost: 500,
    buildTime: 8,
    hp: 150,
    speed: 3.4,
    armor: "light",
    sight: 7.5,
    radius: 0.35,
    infantry: false,
    producer: "vehicle",
    requires: ["factory"],
    weapon: { kind: "bullet", damage: 11, range: 4, reload: 0.5 },
    turret: true,
  },
  tank: {
    kind: "tank",
    name: "Tanque Vespa",
    short: "Vespa",
    desc: "Tanque leve versátil. Bom contra veículos.",
    cost: 700,
    buildTime: 10,
    hp: 320,
    speed: 2.1,
    armor: "heavy",
    sight: 6,
    radius: 0.42,
    infantry: false,
    producer: "vehicle",
    requires: ["factory"],
    weapon: { kind: "cannon", damage: 30, range: 4.6, reload: 1.6, projectileSpeed: 14 },
    turret: true,
  },
  heavy: {
    kind: "heavy",
    name: "Tanque Titã",
    short: "Titã",
    desc: "Tanque pesado de canhão duplo. Lento e resistente.",
    cost: 1300,
    buildTime: 16,
    hp: 650,
    speed: 1.45,
    armor: "heavy",
    sight: 6,
    radius: 0.52,
    infantry: false,
    producer: "vehicle",
    requires: ["factory", "radar"],
    weapon: { kind: "cannon", damage: 38, range: 5, reload: 2.1, shots: 2, projectileSpeed: 13 },
    turret: true,
  },
  artillery: {
    kind: "artillery",
    name: "Morteiro Móvel",
    short: "Morteiro",
    desc: "Artilharia de longo alcance com dano em área.",
    cost: 900,
    buildTime: 12,
    hp: 170,
    speed: 1.6,
    armor: "light",
    sight: 6,
    radius: 0.42,
    infantry: false,
    producer: "vehicle",
    requires: ["factory", "radar"],
    weapon: { kind: "shell", damage: 70, range: 9, minRange: 2.2, reload: 4.2, splash: 1.3, projectileSpeed: 7 },
    turret: true,
  },
  harvester: {
    kind: "harvester",
    name: "Coletor",
    short: "Coletor",
    desc: "Coleta cristais e leva até a refinaria.",
    cost: 1400,
    buildTime: 14,
    hp: 600,
    speed: 1.9,
    armor: "heavy",
    sight: 4,
    radius: 0.5,
    infantry: false,
    producer: "vehicle",
    requires: ["factory", "refinery"],
    turret: false,
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hq: {
    kind: "hq",
    name: "Centro de Comando",
    desc: "Coração da base. Constrói todas as estruturas.",
    cost: 3000,
    buildTime: 30,
    hp: 1600,
    w: 3,
    h: 3,
    power: 20,
    sight: 7,
    requires: [],
    buildable: false,
  },
  power: {
    kind: "power",
    name: "Usina",
    desc: "Gera energia para a base.",
    cost: 300,
    buildTime: 6,
    hp: 450,
    w: 2,
    h: 2,
    power: 100,
    sight: 4,
    requires: [],
    buildable: true,
  },
  refinery: {
    kind: "refinery",
    name: "Refinaria",
    desc: "Processa cristais em créditos. Vem com um Coletor.",
    cost: 1400,
    buildTime: 14,
    hp: 950,
    w: 3,
    h: 3,
    power: -30,
    sight: 5,
    requires: ["power"],
    buildable: true,
  },
  barracks: {
    kind: "barracks",
    name: "Quartel",
    desc: "Treina infantaria.",
    cost: 400,
    buildTime: 7,
    hp: 550,
    w: 2,
    h: 2,
    power: -20,
    sight: 5,
    requires: ["power"],
    buildable: true,
  },
  factory: {
    kind: "factory",
    name: "Fábrica de Blindados",
    desc: "Produz veículos e tanques.",
    cost: 1600,
    buildTime: 15,
    hp: 1100,
    w: 3,
    h: 3,
    power: -30,
    sight: 5,
    requires: ["refinery"],
    buildable: true,
  },
  radar: {
    kind: "radar",
    name: "Radar",
    desc: "Ativa o minimapa e libera unidades avançadas.",
    cost: 1000,
    buildTime: 10,
    hp: 650,
    w: 2,
    h: 2,
    power: -40,
    sight: 9,
    requires: ["refinery"],
    buildable: true,
  },
  turret: {
    kind: "turret",
    name: "Torre de Defesa",
    desc: "Canhão fixo que defende a base. Precisa de energia.",
    cost: 600,
    buildTime: 8,
    hp: 500,
    w: 1,
    h: 1,
    power: -20,
    sight: 7,
    requires: ["barracks"],
    weapon: { kind: "cannon", damage: 28, range: 6.2, reload: 1.3, projectileSpeed: 15 },
    buildable: true,
  },
};

export const BUILD_ORDER_STRUCTURES: BuildingKind[] = ["power", "refinery", "barracks", "factory", "radar", "turret"];
export const BUILD_ORDER_INFANTRY: UnitKind[] = ["rifle", "rocket"];
export const BUILD_ORDER_VEHICLES: UnitKind[] = ["harvester", "scout", "tank", "artillery", "heavy"];

// Multiplicador de dano: arma x blindagem.
export const DAMAGE_TABLE: Record<WeaponKind, Record<Armor, number>> = {
  bullet: { none: 1, light: 0.6, heavy: 0.22, building: 0.25 },
  cannon: { none: 0.35, light: 0.9, heavy: 1, building: 0.75 },
  rocket: { none: 0.3, light: 1, heavy: 1.15, building: 0.6 },
  shell: { none: 0.9, light: 1, heavy: 0.65, building: 1 },
};

export const TEAM_COLORS: Record<Team, { main: string; dark: string; light: string; name: string }> = {
  0: { main: "#2f7cf6", dark: "#1d4fa8", light: "#8fc0ff", name: "Coalizão Aurora" },
  1: { main: "#e2453c", dark: "#9c2420", light: "#ff9d8c", name: "Legião Escarlate" },
};

export const HARVEST_CAPACITY = 1000;
export const HARVEST_SCOOP = 50;
export const ORE_TILE_MAX = 300;
export const START_CREDITS = 5000;
export const PLACE_RADIUS = 3; // distância máxima (tiles) de uma construção existente

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY: Record<Difficulty, { label: string; income: number; firstAttack: number; waveEvery: number; waveSize: number; buildSpeed: number }> = {
  easy: { label: "Fácil", income: 0.75, firstAttack: 330, waveEvery: 170, waveSize: 4, buildSpeed: 0.8 },
  normal: { label: "Normal", income: 1, firstAttack: 240, waveEvery: 130, waveSize: 6, buildSpeed: 1 },
  hard: { label: "Difícil", income: 1.4, firstAttack: 170, waveEvery: 95, waveSize: 8, buildSpeed: 1.25 },
};
