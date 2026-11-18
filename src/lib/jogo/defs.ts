// Regras do jogo "Force One": estatísticas de unidades, construções e armas.

export type Team = 0 | 1; // 0 = jogador, 1 = IA

export type Armor = "none" | "light" | "heavy" | "building" | "aircraft";
export type WeaponKind = "bullet" | "cannon" | "rocket" | "shell" | "flak" | "laser" | "flame";

export type UnitKind =
  | "rifle"
  | "rocket"
  | "flamer"
  | "scout"
  | "javali"
  | "tank"
  | "lumen"
  | "heavy"
  | "artillery"
  | "tempest"
  | "harvester"
  | "drone"
  | "heli"
  | "tufao";
export type BuildingKind = "hq" | "power" | "refinery" | "barracks" | "factory" | "radar" | "turret" | "inferno" | "helipad" | "aa";

export type Faction = "aurora" | "escarlate";

export type Producer = "structure" | "infantry" | "vehicle" | "air";

// Alvos que uma arma consegue atingir.
export type TargetLayer = "ground" | "air" | "both";

// Altitude de voo das aeronaves (em tiles).
export const AIR_ALT = 1.55;

export interface Weapon {
  kind: WeaponKind;
  damage: number;
  range: number;
  minRange?: number;
  reload: number; // segundos
  splash?: number; // raio em tiles
  shots?: number; // tiros por rajada
  projectileSpeed?: number; // tiles/s (0 = instantâneo)
  targets?: TargetLayer; // padrão: "ground"
  arc?: number; // altura extra da trajetória (foguetes de artilharia)
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
  air?: boolean;
  faction?: Faction; // ausente = disponível para as duas facções
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
  faction?: Faction;
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
    radius: 0.2,
    infantry: true,
    producer: "infantry",
    requires: ["barracks"],
    weapon: { kind: "bullet", damage: 9, range: 3.6, reload: 0.85, targets: "both" },
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
    radius: 0.2,
    infantry: true,
    producer: "infantry",
    requires: ["barracks"],
    weapon: { kind: "rocket", damage: 34, range: 5, reload: 2.4, projectileSpeed: 9, splash: 0.4, targets: "both" },
    turret: false,
  },
  scout: {
    kind: "scout",
    faction: "aurora",
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
    weapon: { kind: "bullet", damage: 11, range: 4, reload: 0.5, targets: "both" },
    turret: true,
  },
  tank: {
    kind: "tank",
    faction: "aurora",
    name: "Tanque Vespa",
    short: "Vespa",
    desc: "Tanque leve versátil. Bom contra veículos.",
    cost: 700,
    buildTime: 10,
    hp: 340,
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
    faction: "escarlate",
    name: "Tanque Titã",
    short: "Titã",
    desc: "Tanque principal da Legião: canhão duplo, lento e muito resistente.",
    cost: 1350,
    buildTime: 17,
    hp: 650,
    speed: 1.45,
    armor: "heavy",
    sight: 6,
    radius: 0.52,
    infantry: false,
    producer: "vehicle",
    requires: ["factory"],
    weapon: { kind: "cannon", damage: 38, range: 5, reload: 2.1, shots: 2, projectileSpeed: 13 },
    turret: true,
  },
  artillery: {
    kind: "artillery",
    faction: "aurora",
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
  flamer: {
    kind: "flamer",
    faction: "escarlate",
    name: "Lança-chamas",
    short: "Chamas",
    desc: "Infantaria de curto alcance. Queima infantaria e construções.",
    cost: 250,
    buildTime: 6,
    hp: 85,
    speed: 1.25,
    armor: "none",
    sight: 5,
    radius: 0.2,
    infantry: true,
    producer: "infantry",
    requires: ["barracks"],
    weapon: { kind: "flame", damage: 19, range: 2.3, reload: 1.1, projectileSpeed: 7, splash: 0.6 },
    turret: false,
  },
  javali: {
    kind: "javali",
    faction: "escarlate",
    name: "Blindado Javali",
    short: "Javali",
    desc: "Blindado de 6 rodas com metralhadora dupla. Atinge aeronaves.",
    cost: 550,
    buildTime: 8,
    hp: 240,
    speed: 2.7,
    armor: "light",
    sight: 6.5,
    radius: 0.4,
    infantry: false,
    producer: "vehicle",
    requires: ["factory"],
    weapon: { kind: "bullet", damage: 9, range: 4.2, reload: 0.3, targets: "both" },
    turret: true,
  },
  lumen: {
    kind: "lumen",
    faction: "aurora",
    name: "Tanque Lumen",
    short: "Lumen",
    desc: "Dispara um feixe de laser de longo alcance. Perfura blindagem.",
    cost: 1200,
    buildTime: 14,
    hp: 380,
    speed: 1.9,
    armor: "heavy",
    sight: 6.5,
    radius: 0.45,
    infantry: false,
    producer: "vehicle",
    requires: ["factory", "radar"],
    weapon: { kind: "laser", damage: 62, range: 5.6, reload: 2.6 },
    turret: true,
  },
  tempest: {
    kind: "tempest",
    faction: "escarlate",
    name: "Lança-foguetes Tempestade",
    short: "Tempestade",
    desc: "Caminhão que dispara salvas de 4 foguetes a longa distância.",
    cost: 1000,
    buildTime: 13,
    hp: 180,
    speed: 1.7,
    armor: "light",
    sight: 6,
    radius: 0.45,
    infantry: false,
    producer: "vehicle",
    requires: ["factory", "radar"],
    weapon: { kind: "rocket", damage: 30, range: 8.5, minRange: 2.2, reload: 5.5, shots: 4, splash: 0.75, projectileSpeed: 8, arc: 1.6 },
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
  drone: {
    kind: "drone",
    name: "Drone Vigia",
    short: "Drone",
    desc: "Aeronave rápida de reconhecimento. Enxerga longe e atira em tudo.",
    cost: 600,
    buildTime: 8,
    hp: 110,
    speed: 4.4,
    armor: "aircraft",
    sight: 9,
    radius: 0.32,
    infantry: false,
    air: true,
    producer: "air",
    requires: ["helipad"],
    weapon: { kind: "bullet", damage: 8, range: 3.6, reload: 0.45, targets: "both" },
    turret: false,
  },
  heli: {
    kind: "heli",
    faction: "aurora",
    name: "Helicóptero Colibri",
    short: "Colibri",
    desc: "Helicóptero de ataque com mísseis. Arrasa blindados, mas teme antiaéreas.",
    cost: 1200,
    buildTime: 14,
    hp: 260,
    speed: 3.1,
    armor: "aircraft",
    sight: 7,
    radius: 0.5,
    infantry: false,
    air: true,
    producer: "air",
    requires: ["helipad"],
    weapon: { kind: "rocket", damage: 30, range: 4.8, reload: 1.5, shots: 2, projectileSpeed: 11, splash: 0.35 },
    turret: false,
  },
  tufao: {
    kind: "tufao",
    faction: "escarlate",
    name: "Helicóptero Tufão",
    short: "Tufão",
    desc: "Canhoneira pesada com metralhadora rotativa. Varre infantaria.",
    cost: 1100,
    buildTime: 14,
    hp: 340,
    speed: 2.6,
    armor: "aircraft",
    sight: 7,
    radius: 0.55,
    infantry: false,
    air: true,
    producer: "air",
    requires: ["helipad"],
    weapon: { kind: "bullet", damage: 14, range: 4.3, reload: 0.28 },
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
    faction: "aurora",
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
  inferno: {
    kind: "inferno",
    faction: "escarlate",
    name: "Torre Inferno",
    desc: "Lança-chamas fixo de curto alcance. Devasta infantaria. Precisa de energia.",
    cost: 550,
    buildTime: 8,
    hp: 550,
    w: 1,
    h: 1,
    power: -20,
    sight: 6,
    requires: ["barracks"],
    weapon: { kind: "flame", damage: 30, range: 4.3, reload: 0.9, projectileSpeed: 8, splash: 0.8 },
    buildable: true,
  },
  helipad: {
    kind: "helipad",
    name: "Heliporto",
    desc: "Produz aeronaves: drones e helicópteros.",
    cost: 1200,
    buildTime: 12,
    hp: 600,
    w: 2,
    h: 2,
    power: -25,
    sight: 5,
    requires: ["radar"],
    buildable: true,
  },
  aa: {
    kind: "aa",
    name: "Torre Antiaérea",
    desc: "Canhão duplo que só atira em aeronaves. Precisa de energia.",
    cost: 700,
    buildTime: 8,
    hp: 450,
    w: 1,
    h: 1,
    power: -20,
    sight: 8,
    requires: ["radar"],
    weapon: { kind: "flak", damage: 26, range: 7.5, reload: 0.7, projectileSpeed: 22, splash: 0.5, targets: "air" },
    buildable: true,
  },
};

export const BUILD_ORDER_STRUCTURES: BuildingKind[] = ["power", "refinery", "barracks", "factory", "radar", "turret", "inferno", "helipad", "aa"];
export const BUILD_ORDER_INFANTRY: UnitKind[] = ["rifle", "rocket", "flamer"];
export const BUILD_ORDER_VEHICLES: UnitKind[] = ["harvester", "scout", "javali", "tank", "heavy", "artillery", "tempest", "lumen"];
export const BUILD_ORDER_AIR: UnitKind[] = ["drone", "heli", "tufao"];

// Construção que produz cada categoria.
export const PRODUCER_BUILDING: Record<Producer, BuildingKind> = {
  structure: "hq",
  infantry: "barracks",
  vehicle: "factory",
  air: "helipad",
};

// Prédios que produzem tropas e aceitam ponto de desembarque.
export function isRallyKind(kind: BuildingKind) {
  return kind === "barracks" || kind === "factory" || kind === "helipad";
}

export function canHitLayer(w: Weapon, air: boolean) {
  const t = w.targets ?? "ground";
  return t === "both" || (t === "air") === air;
}

// Multiplicador de dano: arma x blindagem.
export const DAMAGE_TABLE: Record<WeaponKind, Record<Armor, number>> = {
  bullet: { none: 1, light: 0.6, heavy: 0.22, building: 0.25, aircraft: 0.55 },
  cannon: { none: 0.35, light: 0.9, heavy: 1, building: 0.75, aircraft: 0 },
  rocket: { none: 0.3, light: 1, heavy: 1.15, building: 0.6, aircraft: 1.1 },
  shell: { none: 0.9, light: 1, heavy: 0.65, building: 1, aircraft: 0 },
  flak: { none: 0, light: 0, heavy: 0, building: 0, aircraft: 1 },
  laser: { none: 0.45, light: 0.9, heavy: 1.1, building: 0.85, aircraft: 0 },
  flame: { none: 1.25, light: 0.7, heavy: 0.25, building: 0.8, aircraft: 0 },
};

export interface FactionInfo {
  name: string;
  main: string;
  dark: string;
  light: string;
  motto: string;
  traits: string[];
  camo: string[]; // pintura dos veículos (base + manchas)
  uniform: string[]; // farda dos soldados
  structure: string; // cor da pintura das construções
}

export const FACTIONS: Record<Faction, FactionInfo> = {
  aurora: {
    name: "Coalizão Aurora",
    main: "#2f6fe0",
    dark: "#1c4294",
    light: "#8fb6ff",
    camo: ["#76805c", "#56603f", "#948e6a", "#3f4532"],
    uniform: ["#6e7552", "#50573d", "#8c8866", "#383d2e"],
    structure: "#a3a48e",
    motto: "Precisão, mobilidade e tecnologia.",
    traits: ["Tanque Vespa ágil e Batedor rápido", "Tanque Lumen com feixe de laser", "Morteiro de longo alcance", "Helicóptero Colibri antiblindagem"],
  },
  escarlate: {
    name: "Legião Escarlate",
    main: "#d23a30",
    dark: "#8e1f19",
    light: "#ff9d8c",
    camo: ["#b29a6c", "#8c7449", "#d0bd92", "#5e4c33"],
    uniform: ["#a8916a", "#806a47", "#c9b48b", "#5a4932"],
    structure: "#c4b08c",
    motto: "Força bruta, fogo e blindagem pesada.",
    traits: ["Tanque Titã já de início", "Lança-chamas e Torre Inferno", "Salvas do Lança-foguetes Tempestade", "Helicóptero Tufão anti-infantaria"],
  },
};

export const OTHER_FACTION: Record<Faction, Faction> = { aurora: "escarlate", escarlate: "aurora" };

export function availableTo(def: { faction?: Faction }, faction: Faction) {
  return !def.faction || def.faction === faction;
}

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
