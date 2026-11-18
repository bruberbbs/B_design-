// Dados para a interface (instantâneo imutável) e desenho do minimapa.

import {
  BUILD_ORDER_INFANTRY,
  BUILD_ORDER_STRUCTURES,
  BUILD_ORDER_AIR,
  BUILD_ORDER_VEHICLES,
  BUILDINGS,
  isRallyKind,
  UNITS,
  type BuildingKind,
  type Producer,
  type UnitKind,
} from "./defs";
import type { Game, Phase } from "./game";
import { BIOMES } from "./biomes";
import { generateMap, MAPS, Terrain, type GameMap, type MapId } from "./map";

export type ItemKind = UnitKind | BuildingKind;

export interface ItemState {
  kind: ItemKind;
  name: string;
  cost: number;
  available: boolean;
  requires: string;
  queued: number;
  progress: number | null;
  ready: boolean;
  waiting: boolean; // sem créditos
}

export type SelectionInfo =
  | { type: "none" }
  | {
      type: "single";
      id: number;
      entity: "unit" | "building";
      kind: ItemKind;
      name: string;
      own: boolean;
      hp: number;
      maxHp: number;
      cargo: number | null;
      repairing: boolean;
      canSell: boolean;
      canPrimary: boolean;
      isPrimary: boolean;
      canRally: boolean; // quartel, fábrica ou heliporto próprio
      hasRally: boolean;
      rallyOf: string; // quem desembarca: "a infantaria", "os veículos"...
      status: string;
    }
  | { type: "multi"; total: number; groups: { kind: UnitKind; count: number }[] };

export interface HudSnapshot {
  credits: number;
  powerProd: number;
  powerUse: number;
  lowPower: boolean;
  radar: boolean;
  time: number;
  phase: Phase;
  paused: boolean;
  speed: number;
  ready: BuildingKind | null;
  items: Record<Producer, ItemState[]>;
  selection: SelectionInfo;
  hasCommandable: boolean;
  infantryOnly: boolean; // seleção só de infantaria própria: "Mover" vira "Proteger"
  stats: { built: number; lost: number; kills: number; harvested: number; structures: number };
  enemyStats: { lost: number };
  playerName: string;
  enemyName: string;
}

const HARVEST_LABEL: Record<string, string> = {
  idle: "Parado",
  toOre: "Indo coletar",
  harvest: "Coletando",
  toRef: "Voltando à refinaria",
  unload: "Descarregando",
};

export function snapshot(g: Game): HudSnapshot {
  const ts = g.teams[0];
  const items = {} as Record<Producer, ItemState[]>;
  const lists: [Producer, ItemKind[]][] = [
    ["structure", BUILD_ORDER_STRUCTURES],
    ["infantry", BUILD_ORDER_INFANTRY],
    ["vehicle", BUILD_ORDER_VEHICLES],
    ["air", BUILD_ORDER_AIR],
  ];
  for (const [p, kinds] of lists) {
    const q = ts.queues[p];
    items[p] = kinds.filter((kind) => g.inRoster(0, kind)).map((kind) => {
      const isUnit = kind in UNITS;
      const def = isUnit ? UNITS[kind as UnitKind] : BUILDINGS[kind as BuildingKind];
      const reqs = def.requires.filter((r) => !g.reqMet(0, r));
      if (!isUnit && !g.hasBuilding(0, "hq")) reqs.unshift("hq");
      const front = q[0];
      const progress = front && front.kind === kind ? front.progress : null;
      const cost = def.cost;
      return {
        kind,
        name: def.name,
        cost,
        available: g.canProduce(0, kind),
        requires: reqs.map((r) => g.reqName(0, r)).join(", "),
        queued: q.filter((i) => i.kind === kind).length,
        progress,
        ready: ts.ready === kind,
        waiting: progress !== null && ts.credits < 1 && progress < 1,
      };
    });
  }

  let selection: SelectionInfo = { type: "none" };
  const sel = [...g.selected].map((id) => g.get(id)).filter((e) => !!e);
  if (sel.length === 1) {
    const e = sel[0];
    if (e.type === "unit") {
      selection = {
        type: "single",
        id: e.id,
        entity: "unit",
        kind: e.kind,
        name: UNITS[e.kind].name,
        own: e.team === 0,
        hp: Math.ceil(e.hp),
        maxHp: e.maxHp,
        cargo: e.kind === "harvester" ? e.cargo : null,
        repairing: false,
        canSell: false,
        canPrimary: false,
        isPrimary: false,
        canRally: false,
        hasRally: false,
        rallyOf: "",
        status:
          e.team !== 0
            ? g.colors(e.team).name
            : e.kind === "harvester"
              ? HARVEST_LABEL[e.hState]
              : e.protect
                ? e.targetId !== null
                  ? "Protegendo a área · em combate"
                  : e.order === "idle"
                    ? "Protegendo a área"
                    : "Indo proteger a área"
                : e.order === "idle"
                ? "Aguardando ordens"
                : e.order === "attack"
                  ? "Atacando"
                  : e.order === "attackMove"
                    ? "Avançando em combate"
                    : "Em movimento",
      };
    } else {
      const multiple = (e.kind === "barracks" || e.kind === "factory" || e.kind === "helipad") && g.countBuildings(0, e.kind) > 1;
      const p: Producer = e.kind === "barracks" ? "infantry" : e.kind === "helipad" ? "air" : "vehicle";
      selection = {
        type: "single",
        id: e.id,
        entity: "building",
        kind: e.kind,
        name: BUILDINGS[e.kind].name,
        own: e.team === 0,
        hp: Math.ceil(e.hp),
        maxHp: e.maxHp,
        cargo: null,
        repairing: e.repairing,
        canSell: e.team === 0 && e.kind !== "hq",
        canPrimary: e.team === 0 && multiple,
        isPrimary: g.primary[0][p] === e.id,
        canRally: e.team === 0 && isRallyKind(e.kind),
        hasRally: !!e.rally,
        rallyOf: e.kind === "barracks" ? "a infantaria" : e.kind === "helipad" ? "as aeronaves" : "os veículos",
        status: e.team !== 0 ? g.colors(e.team).name : BUILDINGS[e.kind].desc,
      };
    }
  } else if (sel.length > 1) {
    const counts = new Map<UnitKind, number>();
    for (const e of sel) if (e.type === "unit") counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    selection = { type: "multi", total: sel.length, groups: [...counts].map(([kind, count]) => ({ kind, count })) };
  }
  const hasCommandable = sel.some((e) => e.team === 0 && (e.type === "unit" || e.kind === "barracks" || e.kind === "factory" || e.kind === "helipad"));

  return {
    credits: Math.floor(ts.credits),
    powerProd: ts.powerProd,
    powerUse: ts.powerUse,
    lowPower: ts.lowPower,
    radar: g.radarActive(0),
    time: g.time,
    phase: g.phase,
    paused: g.paused,
    speed: g.speed,
    ready: ts.ready,
    items,
    selection,
    hasCommandable,
    infantryOnly: (() => {
      const own = sel.filter((e) => e.team === 0);
      return own.length > 0 && own.every((e) => e.type === "unit" && !!UNITS[e.kind].infantry);
    })(),
    stats: { ...ts.stats },
    enemyStats: { lost: g.teams[1].stats.lost },
    playerName: g.colors(0).name,
    enemyName: g.colors(1).name,
  };
}

// ------------------------------------------------------------ minimapa

function miniColor(map: GameMap, i: number): [number, number, number] {
  if (map.ore[i] > 0) return [240, 200, 80];
  const c = BIOMES[map.biome].mini;
  switch (map.terrain[i]) {
    case Terrain.Sand:
      return c.secondary;
    case Terrain.Water:
      return c.liquid;
    case Terrain.Rock:
      return c.rock;
    case Terrain.Tree:
      return c.tree;
    case Terrain.Spire:
      return [95, 240, 208];
    default:
      return c.ground;
  }
}

// Prévia de cada mapa (mesma rotação do minimapa), com as bases marcadas.
export function mapPreviews(size = 160): Record<MapId, string> {
  const out = {} as Record<MapId, string>;
  for (const m of MAPS) {
    const map = generateMap(m.id);
    const src = document.createElement("canvas");
    src.width = map.w;
    src.height = map.h;
    const sctx = src.getContext("2d")!;
    const img = sctx.createImageData(map.w, map.h);
    for (let i = 0; i < map.w * map.h; i++) img.data.set([...miniColor(map, i), 255], i * 4);
    sctx.putImageData(img, 0, 0);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const s = size / (map.w * Math.SQRT2);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.scale(s, s);
    ctx.translate(-map.w / 2, -map.h / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    map.starts.forEach((st, team) => {
      ctx.fillStyle = team === 0 ? "#ffffff" : "#0a0e18";
      ctx.strokeStyle = team === 0 ? "#0a0e18" : "#ffffff";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(st.x + 1.5, st.z + 1.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    out[m.id] = c.toDataURL("image/png");
  }
  return out;
}

let miniCache: { key: Game; canvas: HTMLCanvasElement; img: ImageData } | null = null;

// Terreno + cristais + névoa, 1 pixel por tile.
function miniImage(g: Game) {
  const { w, h } = g.map;
  if (!miniCache || miniCache.key !== g) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    miniCache = { key: g, canvas, img: canvas.getContext("2d")!.createImageData(w, h) };
  }
  const { img, canvas } = miniCache;
  const ts = g.teams[0];
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    let [r, gg, b] = miniColor(g.map, i);
    if (!ts.explored[i]) [r, gg, b] = [10, 14, 24];
    else if (!ts.visible[i]) {
      r = r * 0.55 + 4;
      gg = gg * 0.55 + 6;
      b = b * 0.55 + 11;
    }
    d[i * 4] = r;
    d[i * 4 + 1] = gg;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  canvas.getContext("2d")!.putImageData(img, 0, 0);
  return canvas;
}

// Desenha em coordenadas do mapa giradas para combinar com a câmera (jogador embaixo).
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  size: number,
  g: Game,
  corners: ({ x: number; z: number } | null)[],
) {
  const { w, h } = g.map;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  // rotação de 45°: o eixo (x - z) vira vertical, igual à câmera
  const s = size / (w * Math.SQRT2);
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.scale(s, s);
  ctx.translate(-w / 2, -h / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(miniImage(g), 0, 0);
  for (const b of g.buildings.values()) {
    if (!g.entityVisibleTo(0, b)) continue;
    ctx.fillStyle = g.colors(b.team).main;
    ctx.fillRect(b.tx, b.tz, b.w, b.h);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 0.25;
    ctx.strokeRect(b.tx, b.tz, b.w, b.h);
  }
  for (const u of g.units.values()) {
    if (u.team !== 0 && !g.isVisible(0, u.x, u.z)) continue;
    ctx.fillStyle = g.colors(u.team).light;
    ctx.beginPath();
    ctx.arc(u.x, u.z, 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
  if (corners.every((c) => c)) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c!.x, c!.z) : ctx.lineTo(c!.x, c!.z)));
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

// Converte um clique no minimapa em coordenadas do mapa (inverso de drawMinimap).
export function minimapToWorld(px: number, py: number, size: number, g: Game) {
  const { w, h } = g.map;
  const s = size / (w * Math.SQRT2);
  let x = (px - size / 2) / s;
  let y = (py - size / 2) / s;
  const a = Math.PI / 4;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  x = rx + w / 2;
  y = ry + h / 2;
  return { x, z: y };
}
