// Simulação do jogo: unidades, construções, economia, combate e visão.

import {
  AIR_ALT,
  availableTo,
  BUILDINGS,
  canHitLayer,
  DAMAGE_TABLE,
  DIFFICULTY,
  FACTIONS,
  HARVEST_CAPACITY,
  HARVEST_SCOOP,
  OTHER_FACTION,
  PLACE_RADIUS,
  PRODUCER_BUILDING,
  START_CREDITS,
  UNITS,
  type BuildingKind,
  type Difficulty,
  type Faction,
  type Producer,
  type TargetLayer,
  type Team,
  type UnitKind,
  type Weapon,
  type WeaponKind,
} from "./defs";
import { generateMap, isPassableTerrain, Terrain, type GameMap, type MapId } from "./map";
import { PathFinder, type Pt } from "./path";

export type Order = "idle" | "move" | "attack" | "attackMove";
export type HarvestState = "idle" | "toOre" | "harvest" | "toRef" | "unload";

export interface Unit {
  id: number;
  type: "unit";
  kind: UnitKind;
  team: Team;
  x: number;
  z: number;
  angle: number;
  turret: number;
  hp: number;
  maxHp: number;
  path: Pt[];
  goal: { x: number; z: number } | null;
  order: Order;
  targetId: number | null;
  guardX: number;
  guardZ: number;
  returning: boolean;
  cooldown: number;
  burstLeft: number;
  burstTimer: number;
  repathTimer: number;
  scanTimer: number;
  stuckTimer: number;
  lastX: number;
  lastZ: number;
  moving: boolean;
  recoil: number;
  bornAt: number;
  // coletor
  cargo: number;
  hState: HarvestState;
  hTimer: number;
  oreTile: number;
  refId: number | null;
  idleTime: number;
}

export interface Building {
  id: number;
  type: "building";
  kind: BuildingKind;
  team: Team;
  tx: number;
  tz: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  bornAt: number;
  cooldown: number;
  turret: number;
  targetId: number | null;
  scanTimer: number;
  rally: { x: number; z: number } | null;
  repairing: boolean;
  recoil: number;
}

export type Entity = Unit | Building;

export interface Projectile {
  id: number;
  kind: WeaponKind;
  team: Team;
  sx: number;
  sz: number;
  sy: number;
  x: number;
  z: number;
  y: number;
  tx: number;
  tz: number;
  targetId: number | null;
  t: number;
  dur: number;
  damage: number;
  splash: number;
  arc: number;
  ty: number;
  targets: TargetLayer;
  sourceId: number;
}

export interface QueueItem {
  kind: UnitKind | BuildingKind;
  progress: number; // 0..1
  paid: number;
}

export interface TeamState {
  credits: number;
  powerProd: number;
  powerUse: number;
  lowPower: boolean;
  queues: Record<Producer, QueueItem[]>;
  ready: BuildingKind | null;
  visible: Uint8Array;
  explored: Uint8Array;
  lastAttackAlert: number;
  lastAttackPos: { x: number; z: number; t: number } | null;
  stats: { built: number; lost: number; kills: number; harvested: number; structures: number };
}

export type GameEvent =
  | { type: "fire"; weapon: WeaponKind; x: number; z: number; y: number; tx: number; tz: number; ty: number; team: Team; sourceId: number }
  | { type: "impact"; weapon: WeaponKind; x: number; z: number; y: number; big: boolean }
  | { type: "death"; x: number; z: number; y: number; infantry: boolean; air: boolean; size: number }
  | { type: "buildingDeath"; x: number; z: number; w: number; h: number }
  | { type: "placed"; x: number; z: number; w: number; h: number; team: Team }
  | { type: "sold"; x: number; z: number; w: number; h: number }
  | { type: "unitReady"; team: Team }
  | { type: "structureReady"; team: Team }
  | { type: "msg"; text: string; tone: "info" | "warn" | "good"; team: Team }
  | { type: "click" };

export type Phase = "playing" | "victory" | "defeat";

let idCounter = 1;

export function rectDist(px: number, pz: number, b: { tx: number; tz: number; w: number; h: number }) {
  const dx = Math.max(b.tx - px, 0, px - (b.tx + b.w));
  const dz = Math.max(b.tz - pz, 0, pz - (b.tz + b.h));
  return Math.hypot(dx, dz);
}

export function isAir(e: Entity | undefined): boolean {
  return !!e && e.type === "unit" && !!UNITS[e.kind].air;
}

function layerHits(t: TargetLayer, air: boolean) {
  return t === "both" || (t === "air") === air;
}

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(cur: number, target: number, maxStep: number) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

export class Game {
  map: GameMap;
  units = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  projectiles: Projectile[] = [];
  teams: [TeamState, TeamState];
  bOcc: Int32Array; // id da construção em cada tile
  path: PathFinder;
  events: GameEvent[] = [];
  time = 0;
  phase: Phase = "playing";
  difficulty: Difficulty;
  selected = new Set<number>();
  oreVersion = 0;
  visVersion = 0;
  speed = 1;
  paused = false;
  primary: [Partial<Record<Producer, number>>, Partial<Record<Producer, number>>] = [{}, {}];
  // times comandados por pessoas (recebem avisos); em rede os dois são humanos
  human: [boolean, boolean] = [true, false];
  private visTimer = 0;
  private powerTimer = 0;
  private oreTimer = 0;
  private endTimer = 0;
  private airAlerted: [boolean, boolean] = [false, false];

  factions: [Faction, Faction];

  constructor(difficulty: Difficulty, playerFaction: Faction = "aurora", mapId: MapId = "vale", seed = 7) {
    this.difficulty = difficulty;
    this.factions = [playerFaction, OTHER_FACTION[playerFaction]];
    this.map = generateMap(mapId, seed);
    const n = this.map.w * this.map.h;
    this.bOcc = new Int32Array(n);
    const mkTeam = (): TeamState => ({
      credits: START_CREDITS,
      powerProd: 0,
      powerUse: 0,
      lowPower: false,
      queues: { structure: [], infantry: [], vehicle: [], air: [] },
      ready: null,
      visible: new Uint8Array(n),
      explored: new Uint8Array(n),
      lastAttackAlert: -99,
      lastAttackPos: null,
      stats: { built: 0, lost: 0, kills: 0, harvested: 0, structures: 0 },
    });
    this.teams = [mkTeam(), mkTeam()];
    this.path = new PathFinder(this.map.w, this.map.h, (i) => this.isBlocked(i));

    // Bases iniciais.
    for (const team of [0, 1] as Team[]) {
      const s = this.map.starts[team];
      this.addBuilding(team, "hq", s.x, s.z, true);
      const cx = s.x + 1.5;
      const cz = s.z + 1.5;
      const dir = team === 0 ? 1 : -1;
      // tropas iniciais de cada facção (custos parecidos)
      const spawn: [UnitKind, number, number][] =
        this.factions[team] === "aurora"
          ? [
              ["tank", 3.2, -2.5],
              ["tank", 3.6, -1.2],
              ["rifle", 2.4, 2.6],
              ["rifle", 3.0, 2.9],
              ["rifle", 3.6, 2.6],
              ["rocket", 3.3, 3.5],
              ["scout", 4.5, 0.6],
            ]
          : [
              ["heavy", 3.4, -1.9],
              ["javali", 4.5, 0.6],
              ["rifle", 2.4, 2.6],
              ["rifle", 3.0, 2.9],
              ["flamer", 3.6, 2.6],
              ["rocket", 3.3, 3.5],
            ];
      for (const [k, ox, oz] of spawn) {
        const u = this.addUnit(team, k, cx + ox * dir, cz + oz * -dir);
        u.angle = team === 0 ? -Math.PI / 4 : (Math.PI * 3) / 4;
        u.turret = u.angle;
      }
    }
    this.updatePower();
    this.updateVision();
  }

  // ---------------------------------------------------------------- consultas

  isBlocked(i: number) {
    return !isPassableTerrain(this.map.terrain[i]) || this.bOcc[i] !== 0;
  }

  tileIndex(x: number, z: number) {
    return Math.floor(z) * this.map.w + Math.floor(x);
  }

  inBounds(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.map.w && z < this.map.h;
  }

  get(id: number | null | undefined): Entity | undefined {
    if (id == null) return undefined;
    return this.units.get(id) ?? this.buildings.get(id);
  }

  center(e: Entity) {
    if (e.type === "unit") return { x: e.x, z: e.z };
    return { x: e.tx + e.w / 2, z: e.tz + e.h / 2 };
  }

  distTo(fromX: number, fromZ: number, e: Entity) {
    if (e.type === "unit") return Math.hypot(e.x - fromX, e.z - fromZ);
    return rectDist(fromX, fromZ, e);
  }

  isVisible(team: Team, x: number, z: number) {
    if (!this.inBounds(x, z)) return false;
    return this.teams[team].visible[this.tileIndex(x, z)] > 0;
  }

  entityVisibleTo(team: Team, e: Entity) {
    if (e.team === team) return true;
    if (e.type === "unit") return this.isVisible(team, e.x, e.z);
    const ex = this.teams[team].explored;
    for (let z = e.tz; z < e.tz + e.h; z++) for (let x = e.tx; x < e.tx + e.w; x++) if (ex[z * this.map.w + x]) return true;
    return false;
  }

  countBuildings(team: Team, kind?: BuildingKind) {
    let n = 0;
    for (const b of this.buildings.values()) if (b.team === team && (!kind || b.kind === kind)) n++;
    return n;
  }

  hasBuilding(team: Team, kind: BuildingKind) {
    for (const b of this.buildings.values()) if (b.team === team && b.kind === kind) return true;
    return false;
  }

  radarActive(team: Team) {
    return this.hasBuilding(team, "radar") && !this.teams[team].lowPower;
  }

  colors(team: Team) {
    return FACTIONS[this.factions[team]];
  }

  // Se a facção do time tem acesso a esta unidade/construção.
  inRoster(team: Team, kind: UnitKind | BuildingKind) {
    const d = kind in UNITS ? UNITS[kind as UnitKind] : BUILDINGS[kind as BuildingKind];
    return availableTo(d, this.factions[team]);
  }

  canProduce(team: Team, kind: UnitKind | BuildingKind) {
    if (!this.inRoster(team, kind)) return false;
    if (kind in UNITS) {
      const d = UNITS[kind as UnitKind];
      return d.requires.every((r) => this.hasBuilding(team, r));
    }
    const d = BUILDINGS[kind as BuildingKind];
    if (!d.buildable || !this.hasBuilding(team, "hq")) return false;
    return d.requires.every((r) => this.hasBuilding(team, r));
  }

  producerOf(kind: UnitKind | BuildingKind): Producer {
    if (kind in UNITS) return UNITS[kind as UnitKind].producer;
    return "structure";
  }

  costOf(kind: UnitKind | BuildingKind) {
    return kind in UNITS ? UNITS[kind as UnitKind].cost : BUILDINGS[kind as BuildingKind].cost;
  }

  timeOf(kind: UnitKind | BuildingKind) {
    return kind in UNITS ? UNITS[kind as UnitKind].buildTime : BUILDINGS[kind as BuildingKind].buildTime;
  }

  // Tile de saída (frente, lado +z) de uma construção.
  exitTile(b: { tx: number; tz: number; w: number; h: number }) {
    return { x: b.tx + Math.floor(b.w / 2), z: b.tz + b.h };
  }

  // ---------------------------------------------------------------- criação

  addUnit(team: Team, kind: UnitKind, x: number, z: number): Unit {
    const d = UNITS[kind];
    const u: Unit = {
      id: idCounter++,
      type: "unit",
      kind,
      team,
      x,
      z,
      angle: Math.PI / 2,
      turret: Math.PI / 2,
      hp: d.hp,
      maxHp: d.hp,
      path: [],
      goal: null,
      order: "idle",
      targetId: null,
      guardX: x,
      guardZ: z,
      returning: false,
      cooldown: 0,
      burstLeft: 0,
      burstTimer: 0,
      repathTimer: 0,
      scanTimer: Math.random() * 0.3,
      stuckTimer: 0,
      lastX: x,
      lastZ: z,
      moving: false,
      recoil: 0,
      bornAt: this.time,
      cargo: 0,
      hState: kind === "harvester" ? "toOre" : "idle",
      hTimer: 0,
      oreTile: -1,
      refId: null,
      idleTime: 0,
    };
    this.units.set(u.id, u);
    return u;
  }

  addBuilding(team: Team, kind: BuildingKind, tx: number, tz: number, instant = false): Building {
    const d = BUILDINGS[kind];
    const b: Building = {
      id: idCounter++,
      type: "building",
      kind,
      team,
      tx,
      tz,
      w: d.w,
      h: d.h,
      hp: d.hp,
      maxHp: d.hp,
      bornAt: instant ? -10 : this.time,
      cooldown: 0,
      turret: team === 0 ? -Math.PI / 4 : (Math.PI * 3) / 4,
      targetId: null,
      scanTimer: 0,
      rally: null,
      repairing: false,
      recoil: 0,
    };
    this.buildings.set(b.id, b);
    for (let z = tz; z < tz + d.h; z++) for (let x = tx; x < tx + d.w; x++) this.bOcc[z * this.map.w + x] = b.id;
    return b;
  }

  // ---------------------------------------------------------------- produção

  queueProduction(team: Team, kind: UnitKind | BuildingKind): boolean {
    if (!this.canProduce(team, kind)) return false;
    const ts = this.teams[team];
    const p = this.producerOf(kind);
    const q = ts.queues[p];
    if (p === "structure") {
      if (q.length > 0 || ts.ready) return false;
    } else if (q.length >= 10) return false;
    q.push({ kind, progress: 0, paid: 0 });
    return true;
  }

  cancelProduction(team: Team, kind: UnitKind | BuildingKind): boolean {
    const ts = this.teams[team];
    const p = this.producerOf(kind);
    if (p === "structure" && ts.ready === kind) {
      ts.ready = null;
      ts.credits += this.costOf(kind);
      return true;
    }
    const q = ts.queues[p];
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].kind === kind) {
        ts.credits += q[i].paid;
        q.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  private updateProduction(dt: number) {
    for (const team of [0, 1] as Team[]) {
      const ts = this.teams[team];
      const powerMul = ts.lowPower ? 0.45 : 1;
      const aiMul = team === 1 ? DIFFICULTY[this.difficulty].buildSpeed : 1;
      for (const p of ["structure", "infantry", "vehicle", "air"] as Producer[]) {
        const q = ts.queues[p];
        if (q.length === 0) continue;
        const item = q[0];
        if (!this.canProduce(team, item.kind)) {
          // perdeu o pré-requisito: devolve e limpa
          ts.credits += item.paid;
          q.shift();
          continue;
        }
        const factoryKind = PRODUCER_BUILDING[p];
        const count = this.countBuildings(team, factoryKind);
        const mul = powerMul * aiMul * (1 + 0.35 * Math.max(0, count - 1));
        const cost = this.costOf(item.kind);
        const dp = (dt * mul) / this.timeOf(item.kind);
        const spend = Math.min(cost - item.paid, cost * dp);
        if (ts.credits < spend) continue;
        ts.credits -= spend;
        item.paid += spend;
        item.progress = Math.min(1, item.progress + dp);
        if (item.progress >= 1) {
          ts.credits -= cost - item.paid;
          item.paid = cost;
          if (p === "structure") {
            ts.ready = item.kind as BuildingKind;
            q.shift();
            if (this.human[team]) {
              this.events.push({ type: "structureReady", team });
              this.msg("Construção pronta — escolha onde posicionar", "good", team);
            }
          } else {
            if (this.spawnProduced(team, item.kind as UnitKind)) {
              q.shift();
              ts.stats.built++;
              if (this.human[team]) this.events.push({ type: "unitReady", team });
            }
          }
        }
      }
    }
  }

  private spawnProduced(team: Team, kind: UnitKind) {
    const d = UNITS[kind];
    const fk = PRODUCER_BUILDING[d.producer];
    let src: Building | undefined;
    const prim = this.primary[team][d.producer];
    if (prim) {
      const b = this.buildings.get(prim);
      if (b && b.team === team && b.kind === fk) src = b;
    }
    if (!src) for (const b of this.buildings.values()) if (b.team === team && b.kind === fk) { src = b; break; }
    if (!src) return false;
    if (d.air) {
      // decola do heliporto
      const cx = src.tx + src.w / 2;
      const cz = src.tz + src.h / 2;
      const u = this.addUnit(team, kind, cx, cz);
      u.angle = Math.PI / 2;
      u.turret = u.angle;
      const dest = src.rally ?? { x: cx + (Math.random() - 0.5) * 2, z: cz + 2 + Math.random() };
      this.issueMove([u.id], dest.x, dest.z, false, true);
      return true;
    }
    const ex = this.exitTile(src);
    const free = this.path.nearestFree(ex.x, ex.z, 6);
    if (!free) return false;
    const u = this.addUnit(team, kind, src.tx + src.w / 2, src.tz + src.h - 0.4);
    u.angle = Math.PI / 2;
    u.turret = u.angle;
    if (kind === "harvester") {
      u.hState = "toOre";
      return true;
    }
    const dest = src.rally ?? { x: free.x + 0.5 + (Math.random() - 0.5) * 0.6, z: free.z + 1.5 + Math.random() };
    this.issueMove([u.id], dest.x, dest.z, false, true);
    return true;
  }

  canPlace(team: Team, kind: BuildingKind, tx: number, tz: number) {
    const d = BUILDINGS[kind];
    const w = this.map.w;
    const reserved = new Set<number>();
    for (const b of this.buildings.values()) {
      if (b.kind === "refinery" || b.kind === "factory" || b.kind === "barracks") {
        const e = this.exitTile(b);
        reserved.add(e.z * w + e.x);
      }
    }
    for (let z = tz; z < tz + d.h; z++) {
      for (let x = tx; x < tx + d.w; x++) {
        if (!this.inBounds(x, z)) return false;
        const i = z * w + x;
        const t = this.map.terrain[i];
        if (t !== Terrain.Grass && t !== Terrain.Sand) return false;
        if (this.bOcc[i] !== 0 || this.map.ore[i] > 0 || reserved.has(i)) return false;
      }
    }
    // a saída da nova construção também precisa estar livre
    if (kind === "refinery" || kind === "factory" || kind === "barracks") {
      const e = this.exitTile({ tx, tz, w: d.w, h: d.h });
      if (!this.inBounds(e.x, e.z) || this.isBlocked(e.z * w + e.x)) return false;
    }
    for (const u of this.units.values()) {
      if (UNITS[u.kind].air) continue;
      if (u.x > tx - 0.2 && u.x < tx + d.w + 0.2 && u.z > tz - 0.2 && u.z < tz + d.h + 0.2) return false;
    }
    let near = false;
    for (const b of this.buildings.values()) {
      if (b.team !== team) continue;
      const gx = Math.max(b.tx - (tx + d.w), tx - (b.tx + b.w), 0);
      const gz = Math.max(b.tz - (tz + d.h), tz - (b.tz + b.h), 0);
      if (Math.max(gx, gz) <= PLACE_RADIUS) {
        near = true;
        break;
      }
    }
    return near;
  }

  placeStructure(team: Team, tx: number, tz: number): boolean {
    const ts = this.teams[team];
    const kind = ts.ready;
    if (!kind) return false;
    if (!this.canPlace(team, kind, tx, tz)) return false;
    const b = this.addBuilding(team, kind, tx, tz);
    ts.ready = null;
    ts.stats.structures++;
    const d = BUILDINGS[kind];
    this.events.push({ type: "placed", x: tx + d.w / 2, z: tz + d.h / 2, w: d.w, h: d.h, team });
    if (kind === "refinery") {
      const ex = this.exitTile(b);
      const u = this.addUnit(team, "harvester", ex.x + 0.5, ex.z + 0.3);
      u.hState = "toOre";
      u.refId = b.id;
    }
    this.invalidatePaths();
    this.updatePower();
    return true;
  }

  sell(id: number) {
    const b = this.buildings.get(id);
    if (!b || b.kind === "hq") return;
    const d = BUILDINGS[b.kind];
    this.teams[b.team].credits += Math.round((d.cost * 0.5 * b.hp) / b.maxHp);
    this.events.push({ type: "sold", x: b.tx + b.w / 2, z: b.tz + b.h / 2, w: b.w, h: b.h });
    this.removeBuilding(b);
    if (b.w * b.h >= 4) {
      const ex = this.exitTile(b);
      const f = this.path.nearestFree(ex.x, ex.z, 4);
      if (f) this.addUnit(b.team, "rifle", f.x + 0.5, f.z + 0.5);
    }
    this.updatePower();
  }

  toggleRepair(id: number) {
    const b = this.buildings.get(id);
    if (b) b.repairing = !b.repairing;
  }

  private removeBuilding(b: Building) {
    this.buildings.delete(b.id);
    for (let z = b.tz; z < b.tz + b.h; z++) for (let x = b.tx; x < b.tx + b.w; x++) this.bOcc[z * this.map.w + x] = 0;
    this.selected.delete(b.id);
  }

  private invalidatePaths() {
    for (const u of this.units.values()) {
      if (u.path.length && u.path.some((p) => this.bOcc[p.z * this.map.w + p.x] !== 0)) {
        u.repathTimer = 0;
        const g = u.path[u.path.length - 1];
        this.setPath(u, g.x + 0.5, g.z + 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- ordens

  private slotsAround(cx: number, cz: number, units: Unit[]) {
    const tx = Math.floor(cx);
    const tz = Math.floor(cz);
    const air = units.filter((u) => UNITS[u.kind].air);
    const inf = units.filter((u) => UNITS[u.kind].infantry);
    const veh = units.filter((u) => !UNITS[u.kind].infantry && !UNITS[u.kind].air);
    const slots = new Map<number, { x: number; z: number }>();
    // aeronaves: espiral em volta do ponto, ignorando o terreno
    air.forEach((u, i) => {
      const a = i * 2.4;
      const r = i === 0 ? 0 : 0.55 * Math.sqrt(i) + 0.3;
      const x = Math.max(0.5, Math.min(this.map.w - 0.5, cx + Math.cos(a) * r));
      const z = Math.max(0.5, Math.min(this.map.h - 0.5, cz + Math.sin(a) * r));
      slots.set(u.id, { x, z });
    });
    const used = new Set<number>();
    const tiles: Pt[] = [];
    for (let r = 0; r < 10 && tiles.length < units.length + 4; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = tx + dx;
          const z = tz + dz;
          if (!this.path.passable(x, z)) continue;
          tiles.push({ x, z });
        }
    }
    tiles.sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz));
    let ti = 0;
    const next = () => {
      while (ti < tiles.length && used.has(tiles[ti].z * this.map.w + tiles[ti].x)) ti++;
      const t = tiles[ti] ?? { x: tx, z: tz };
      used.add(t.z * this.map.w + t.x);
      return t;
    };
    for (const v of veh) {
      const t = next();
      slots.set(v.id, { x: t.x + 0.5, z: t.z + 0.5 });
    }
    const offs = [
      [-0.22, -0.2],
      [0.22, -0.2],
      [0, 0.22],
    ];
    for (let i = 0; i < inf.length; i++) {
      if (i % 3 === 0) next();
      const t = tiles[Math.max(0, ti)] ?? { x: tx, z: tz };
      const o = offs[i % 3];
      slots.set(inf[i].id, { x: t.x + 0.5 + o[0], z: t.z + 0.5 + o[1] });
    }
    return slots;
  }

  setPath(u: Unit, x: number, z: number, adjustGoal = false) {
    if (UNITS[u.kind].air) {
      // voo em linha reta
      const tx = Math.max(0, Math.min(this.map.w - 1, Math.floor(x)));
      const tz = Math.max(0, Math.min(this.map.h - 1, Math.floor(z)));
      u.path = [{ x: tx, z: tz }];
      u.stuckTimer = 0;
      return;
    }
    const p = this.path.find(Math.floor(u.x), Math.floor(u.z), Math.floor(x), Math.floor(z));
    u.path = p ?? [];
    u.stuckTimer = 0;
    if (adjustGoal && u.goal) {
      // destino inalcançável: para no ponto alcançável mais próximo
      const last = u.path[u.path.length - 1];
      if (!last) {
        if (this.tileIndex(u.x, u.z) !== this.tileIndex(u.goal.x, u.goal.z)) u.goal = null;
      } else if (last.x !== Math.floor(u.goal.x) || last.z !== Math.floor(u.goal.z)) {
        u.goal = { x: last.x + 0.5, z: last.z + 0.5 };
      }
    }
  }

  issueMove(ids: number[], x: number, z: number, attackMove: boolean, quiet = false) {
    const units = ids.map((id) => this.units.get(id)).filter((u): u is Unit => !!u);
    if (!units.length) return;
    const slots = this.slotsAround(x, z, units);
    for (const u of units) {
      const s = slots.get(u.id) ?? { x, z };
      u.goal = s;
      u.order = attackMove ? "attackMove" : "move";
      u.targetId = null;
      u.returning = false;
      u.idleTime = 0;
      if (u.kind === "harvester") u.hState = "idle";
      this.setPath(u, s.x, s.z, true);
    }
    if (!quiet && units[0].team === 0) this.events.push({ type: "click" });
  }

  issueAttack(ids: number[], targetId: number) {
    const t = this.get(targetId);
    if (!t) return;
    for (const id of ids) {
      const u = this.units.get(id);
      const w = u ? UNITS[u.kind].weapon : undefined;
      if (!u || !w || !canHitLayer(w, isAir(t))) continue;
      u.order = "attack";
      u.targetId = targetId;
      u.goal = null;
      u.returning = false;
      const c = this.center(t);
      this.setPath(u, c.x, c.z);
      u.repathTimer = 0.8;
    }
    this.events.push({ type: "click" });
  }

  issueStop(ids: number[]) {
    for (const id of ids) {
      const u = this.units.get(id);
      if (!u) continue;
      u.order = "idle";
      u.path = [];
      u.goal = null;
      u.targetId = null;
      u.guardX = u.x;
      u.guardZ = u.z;
      if (u.kind === "harvester") u.hState = "idle";
    }
  }

  issueHarvest(ids: number[], tile: number) {
    for (const id of ids) {
      const u = this.units.get(id);
      if (!u || u.kind !== "harvester") continue;
      u.order = "idle";
      u.hState = "toOre";
      u.oreTile = tile;
      u.goal = null;
      this.setPath(u, (tile % this.map.w) + 0.5, Math.floor(tile / this.map.w) + 0.5);
    }
    this.events.push({ type: "click" });
  }

  issueReturn(ids: number[], refId: number) {
    for (const id of ids) {
      const u = this.units.get(id);
      if (!u || u.kind !== "harvester") continue;
      u.order = "idle";
      u.refId = refId;
      u.hState = "toRef";
      u.path = [];
      u.goal = null;
    }
    this.events.push({ type: "click" });
  }

  // Comando "inteligente" do jogador: decide entre mover, atacar, coletar ou definir ponto de reunião.
  smartCommand(team: Team, ids: number[], x: number, z: number, targetId: number | null, attackMove = false) {
    const sel = ids.map((id) => this.get(id)).filter((e): e is Entity => !!e && e.team === team);
    if (!sel.length) return;
    x = Math.max(0.5, Math.min(this.map.w - 0.5, x));
    z = Math.max(0.5, Math.min(this.map.h - 0.5, z));
    const units = sel.filter((e): e is Unit => e.type === "unit");
    const target = this.get(targetId);
    if (!units.length) {
      for (const e of sel) {
        if (e.type === "building" && (e.kind === "barracks" || e.kind === "factory" || e.kind === "helipad")) {
          e.rally = { x, z };
          this.events.push({ type: "click" });
        }
      }
      return;
    }
    const unitIds = units.map((u) => u.id);
    if (target && target.team !== team) {
      this.issueAttack(unitIds, target.id);
      return;
    }
    const harvesters = units.filter((u) => u.kind === "harvester");
    const others = units.filter((u) => u.kind !== "harvester");
    if (harvesters.length) {
      if (target && target.type === "building" && target.kind === "refinery") {
        this.issueReturn(
          harvesters.map((u) => u.id),
          target.id,
        );
      } else if (this.inBounds(x, z) && this.map.ore[this.tileIndex(x, z)] > 0) {
        this.issueHarvest(
          harvesters.map((u) => u.id),
          this.tileIndex(x, z),
        );
      } else {
        this.issueMove(
          harvesters.map((u) => u.id),
          x,
          z,
          false,
        );
      }
    }
    if (others.length) this.issueMove(others.map((u) => u.id), x, z, attackMove);
  }

  // ---------------------------------------------------------------- dano

  private damage(target: Entity, amount: number, weapon: WeaponKind, attacker: Entity | undefined) {
    if (this.phase !== "playing") return;
    const armor = target.type === "unit" ? UNITS[target.kind].armor : "building";
    const dmg = amount * DAMAGE_TABLE[weapon][armor];
    target.hp -= dmg;
    const ts = this.teams[target.team];
    const c = this.center(target);
    ts.lastAttackPos = { x: c.x, z: c.z, t: this.time };
    if (this.human[target.team] && this.time - ts.lastAttackAlert > 20) {
      const base = target.type === "building" || target.kind === "harvester";
      if (base) {
        ts.lastAttackAlert = this.time;
        this.msg(target.kind === "harvester" ? "Coletor sob ataque!" : "Nossa base está sob ataque!", "warn", target.team);
      }
    }
    // retaliação
    const tw = target.type === "unit" ? UNITS[target.kind].weapon : undefined;
    if (target.type === "unit" && attacker && tw && canHitLayer(tw, isAir(attacker)) && target.order !== "move") {
      const cur = this.get(target.targetId);
      if (!cur) {
        target.targetId = attacker.id;
      }
    }
    if (target.hp <= 0) this.kill(target, attacker);
  }

  private kill(e: Entity, attacker: Entity | undefined) {
    if (attacker) this.teams[attacker.team].stats.kills++;
    if (e.type === "unit") {
      if (!this.units.has(e.id)) return;
      this.units.delete(e.id);
      this.selected.delete(e.id);
      this.teams[e.team].stats.lost++;
      const d = UNITS[e.kind];
      this.events.push({ type: "death", x: e.x, z: e.z, y: d.air ? AIR_ALT : 0, infantry: d.infantry, air: !!d.air, size: d.radius });
    } else {
      if (!this.buildings.has(e.id)) return;
      this.removeBuilding(e);
      this.events.push({ type: "buildingDeath", x: e.tx + e.w / 2, z: e.tz + e.h / 2, w: e.w, h: e.h });
      this.updatePower();
      this.msg(`${BUILDINGS[e.kind].name} destruído`, "warn", e.team);
      this.msg(`Estrutura inimiga destruída: ${BUILDINGS[e.kind].name}`, "good", e.team === 0 ? 1 : 0);
    }
  }

  msg(text: string, tone: "info" | "warn" | "good" = "info", team: Team = 0) {
    if (!this.human[team]) return;
    this.events.push({ type: "msg", text, tone, team });
  }

  // ---------------------------------------------------------------- armas

  private fire(src: Entity, target: Entity, w: Weapon, sx: number, sz: number, sy: number) {
    const tc = target.type === "unit" ? { x: target.x, z: target.z } : this.aimPoint(target, sx, sz);
    const ty = isAir(target) ? AIR_ALT : target.type === "building" ? 0.45 : 0.25;
    this.events.push({ type: "fire", weapon: w.kind, x: sx, z: sz, y: sy, tx: tc.x, tz: tc.z, ty, team: src.team, sourceId: src.id });
    if (!w.projectileSpeed) {
      this.damage(target, w.damage * (0.85 + Math.random() * 0.3), w.kind, src);
      return;
    }
    const dist = Math.hypot(tc.x - sx, tc.z - sz);
    const spread = w.kind === "shell" ? 0.35 : w.arc ? 0.7 : 0;
    this.projectiles.push({
      id: idCounter++,
      kind: w.kind,
      team: src.team,
      sx,
      sz,
      sy,
      x: sx,
      z: sz,
      y: sy,
      tx: tc.x + (Math.random() - 0.5) * spread,
      tz: tc.z + (Math.random() - 0.5) * spread,
      targetId: w.kind === "shell" || w.arc ? null : target.id,
      t: 0,
      dur: Math.max(0.12, dist / w.projectileSpeed),
      damage: w.damage,
      splash: w.splash ?? 0,
      arc:
        w.arc !== undefined
          ? w.arc + dist * 0.12
          : w.kind === "shell"
            ? 1.2 + dist * 0.25
            : w.kind === "rocket" && !isAir(target) && !isAir(src)
              ? 0.35
              : 0,
      ty,
      targets: w.targets ?? "ground",
      sourceId: src.id,
    });
  }

  private aimPoint(b: Building, fromX: number, fromZ: number) {
    const x = Math.max(b.tx + 0.4, Math.min(b.tx + b.w - 0.4, fromX));
    const z = Math.max(b.tz + 0.4, Math.min(b.tz + b.h - 0.4, fromZ));
    return { x, z };
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.t += dt;
      const tgt = this.get(p.targetId);
      if (tgt) {
        const c = tgt.type === "unit" ? { x: tgt.x, z: tgt.z } : this.aimPoint(tgt, p.sx, p.sz);
        p.tx = c.x;
        p.tz = c.z;
      }
      const k = Math.min(1, p.t / p.dur);
      p.x = p.sx + (p.tx - p.sx) * k;
      p.z = p.sz + (p.tz - p.sz) * k;
      p.y = p.sy * (1 - k) + p.ty * k + Math.sin(Math.PI * k) * p.arc;
      if (k < 1) {
        keep.push(p);
        continue;
      }
      const src = this.get(p.sourceId);
      if (p.splash > 0) {
        this.events.push({ type: "impact", weapon: p.kind, x: p.tx, z: p.tz, y: p.ty, big: p.kind === "shell" });
        for (const e of [...this.units.values(), ...this.buildings.values()]) {
          if (e.team === p.team) continue;
          if (!layerHits(p.targets, isAir(e))) continue;
          const d = this.distTo(p.tx, p.tz, e);
          if (d <= p.splash) {
            const direct = e.id === p.targetId;
            const fall = direct ? 1 : 1 - (d / p.splash) * 0.6;
            this.damage(e, p.damage * fall, p.kind, src);
          }
        }
      } else {
        this.events.push({ type: "impact", weapon: p.kind, x: p.tx, z: p.tz, y: p.ty, big: false });
        if (tgt) this.damage(tgt, p.damage * (0.9 + Math.random() * 0.2), p.kind, src);
      }
    }
    this.projectiles = keep;
  }

  // Procura inimigo visível mais próximo.
  private findTarget(team: Team, x: number, z: number, radius: number, w: Weapon | undefined): Entity | null {
    let best: Entity | null = null;
    let bestScore = Infinity;
    const vis = this.teams[team].visible;
    for (const e of this.units.values()) {
      if (e.team === team) continue;
      if (w && !canHitLayer(w, !!UNITS[e.kind].air)) continue;
      if (!vis[this.tileIndex(e.x, e.z)]) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d > radius) continue;
      if (w?.minRange && d < w.minRange) continue;
      // prefere alvos que a arma fere bem
      const mult = w ? DAMAGE_TABLE[w.kind][UNITS[e.kind].armor] : 1;
      const score = d / (0.4 + mult);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) return best;
    if (w && !canHitLayer(w, false)) return null;
    for (const b of this.buildings.values()) {
      if (b.team === team) continue;
      const d = rectDist(x, z, b);
      if (d > radius) continue;
      const score = d + 2;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- unidades

  private moveAlong(u: Unit, dt: number): boolean {
    const d = UNITS[u.kind];
    let wx: number;
    let wz: number;
    let final = false;
    if (u.path.length > 0) {
      const p = u.path[0];
      wx = p.x + 0.5;
      wz = p.z + 0.5;
      if (u.path.length === 1 && u.goal && Math.floor(u.goal.x) === p.x && Math.floor(u.goal.z) === p.z) {
        wx = u.goal.x;
        wz = u.goal.z;
        final = true;
      }
    } else if (u.goal) {
      wx = u.goal.x;
      wz = u.goal.z;
      final = true;
    } else {
      u.moving = false;
      return true;
    }
    const dx = wx - u.x;
    const dz = wz - u.z;
    const dist = Math.hypot(dx, dz);
    const reach = final ? 0.06 : 0.25;
    if (dist < reach) {
      if (u.path.length > 0) u.path.shift();
      else u.goal = null;
      if (u.path.length === 0 && (!u.goal || final)) {
        u.goal = null;
        u.moving = false;
        return true;
      }
      return false;
    }
    const heading = Math.atan2(dz, dx);
    if (d.air) {
      // aeronaves voam em linha reta e não colidem com o terreno
      u.angle = turnToward(u.angle, heading, 5 * dt);
      u.turret = u.angle;
      const st = Math.min(dist, d.speed * dt);
      u.x = Math.max(0.2, Math.min(this.map.w - 0.2, u.x + (dx / dist) * st));
      u.z = Math.max(0.2, Math.min(this.map.h - 0.2, u.z + (dz / dist) * st));
      u.moving = true;
      return false;
    }
    const turnRate = d.infantry ? 10 : d.kind === "scout" ? 5 : 3.2;
    u.angle = turnToward(u.angle, heading, turnRate * dt);
    if (!d.turret) u.turret = u.angle;
    const diff = Math.abs(angleDiff(u.angle, heading));
    if (diff > (d.infantry ? 0.9 : 0.6)) {
      u.moving = false;
      return false;
    }
    const step = Math.min(dist, d.speed * dt * (d.infantry ? 1 : Math.cos(diff)));
    const nx = u.x + (dx / dist) * step;
    const nz = u.z + (dz / dist) * step;
    // pode sair de dentro de uma construção (unidade recém-produzida)
    if (this.inBounds(nx, nz) && (!this.isBlocked(this.tileIndex(nx, nz)) || this.isBlocked(this.tileIndex(u.x, u.z)))) {
      u.x = nx;
      u.z = nz;
      u.moving = true;
    } else {
      u.moving = false;
      u.repathTimer -= dt;
      if (u.repathTimer <= 0) {
        u.repathTimer = 1;
        const g = u.goal ?? (u.path.length ? { x: u.path[u.path.length - 1].x + 0.5, z: u.path[u.path.length - 1].z + 0.5 } : null);
        if (g) this.setPath(u, g.x, g.z);
      }
    }
    return false;
  }

  private updateUnit(u: Unit, dt: number) {
    const d = UNITS[u.kind];
    u.cooldown -= dt;
    u.recoil = Math.max(0, u.recoil - dt * 3);
    if (u.kind === "harvester") {
      this.updateHarvester(u, dt);
      this.checkStuck(u, dt);
      return;
    }
    const w = d.weapon;
    let target = this.get(u.targetId);
    if (target && (target.hp <= 0 || (target.type === "unit" && !this.isVisible(u.team, target.x, target.z) && u.order !== "attack"))) {
      target = undefined;
      u.targetId = null;
    }
    if (target && (target.team === u.team || (w && !canHitLayer(w, isAir(target))))) {
      target = undefined;
      u.targetId = null;
    }

    // aquisição automática
    u.scanTimer -= dt;
    if (!target && w && u.scanTimer <= 0) {
      u.scanTimer = 0.35;
      let radius = 0;
      if (u.order === "idle") radius = u.returning ? w.range : Math.max(w.range + 1.2, Math.min(d.sight, w.range + 2.5));
      else if (u.order === "attackMove") radius = Math.max(d.sight, w.range);
      else if (u.order === "move" && d.turret) radius = w.range;
      if (radius > 0) {
        const t = this.findTarget(u.team, u.x, u.z, radius, w);
        if (t) {
          target = t;
          u.targetId = t.id;
        }
      }
    }

    let wantsMove = true;
    if (target && w) {
      const c = this.center(target);
      const dist = this.distTo(u.x, u.z, target);
      const inRange = dist <= w.range && (!w.minRange || dist >= w.minRange);
      const aim = Math.atan2(c.z - u.z, c.x - u.x);
      if (inRange) {
        if (u.order !== "move") {
          wantsMove = false;
          u.moving = false;
          if (u.order !== "attackMove") u.path = [];
        }
        if (d.turret) {
          u.turret = turnToward(u.turret, aim, 4 * dt);
        } else if (!wantsMove) {
          u.angle = turnToward(u.angle, aim, 10 * dt);
          u.turret = u.angle;
        }
        const facing = d.turret ? u.turret : u.angle;
        if (Math.abs(angleDiff(facing, aim)) < 0.18) this.tryFire(u, target, w, dt, facing);
      } else if (u.order === "move") {
        u.targetId = null;
      } else {
        // persegue
        const leashOk =
          u.order === "attack" || u.order === "attackMove" || Math.hypot(u.x - u.guardX, u.z - u.guardZ) < 6;
        if (!leashOk) {
          u.targetId = null;
          u.returning = true;
          u.goal = { x: u.guardX, z: u.guardZ };
          this.setPath(u, u.guardX, u.guardZ);
        } else {
          u.repathTimer -= dt;
          if (u.repathTimer <= 0 || u.path.length === 0) {
            u.repathTimer = 0.9;
            if (w.minRange && dist < w.minRange) {
              // muito perto: recua
              const ax = u.x - (c.x - u.x) * 0.8;
              const az = u.z - (c.z - u.z) * 0.8;
              this.setPath(u, ax, az);
            } else {
              this.setPath(u, c.x, c.z);
            }
          }
        }
        if (d.turret) u.turret = turnToward(u.turret, aim, 4 * dt);
      }
    } else if (d.turret && !u.moving) {
      u.turret = turnToward(u.turret, u.angle, 1.5 * dt);
    }

    if (u.order === "idle" && !target && !u.returning && u.path.length === 0 && Math.hypot(u.x - u.guardX, u.z - u.guardZ) > 1.5) {
      u.returning = true;
      u.goal = { x: u.guardX, z: u.guardZ };
      this.setPath(u, u.guardX, u.guardZ, true);
    }

    if (u.order === "attack" && !target) {
      u.order = "idle";
      u.path = [];
      u.guardX = u.x;
      u.guardZ = u.z;
    }

    if (wantsMove) {
      if (u.order === "attackMove" && !target && u.goal && u.path.length === 0) {
        this.setPath(u, u.goal.x, u.goal.z, true);
      }
      const arrived = this.moveAlong(u, dt);
      if (arrived && (u.order === "move" || u.order === "attackMove")) {
        u.order = "idle";
        u.guardX = u.x;
        u.guardZ = u.z;
      }
      if (arrived && u.returning) {
        u.returning = false;
      }
    }
    this.checkStuck(u, dt);
  }

  private tryFire(u: Unit, target: Entity, w: Weapon, dt: number, facing: number) {
    const d = UNITS[u.kind];
    const muzzle = d.infantry ? 0.25 : d.radius + 0.25;
    const sx = u.x + Math.cos(facing) * muzzle;
    const sz = u.z + Math.sin(facing) * muzzle;
    const sy = d.air ? AIR_ALT - 0.15 : d.infantry ? 0.32 : u.kind === "heavy" ? 0.6 : 0.5;
    if (u.burstLeft > 0) {
      u.burstTimer -= dt;
      if (u.burstTimer <= 0) {
        u.burstLeft--;
        u.burstTimer = 0.18;
        this.fire(u, target, w, sx + Math.cos(facing + 1.57) * 0.12, sz + Math.sin(facing + 1.57) * 0.12, sy);
        u.recoil = 1;
      }
      return;
    }
    if (u.cooldown > 0) return;
    u.cooldown = w.reload * (0.9 + Math.random() * 0.2);
    this.fire(u, target, w, sx, sz, sy);
    u.recoil = 1;
    if (w.shots && w.shots > 1) {
      u.burstLeft = w.shots - 1;
      u.burstTimer = 0.18;
    }
  }

  private checkStuck(u: Unit, dt: number) {
    if (u.path.length === 0 && !u.goal) {
      u.stuckTimer = 0;
      u.lastX = u.x;
      u.lastZ = u.z;
      return;
    }
    u.stuckTimer += dt;
    if (u.stuckTimer > 2) {
      const moved = Math.hypot(u.x - u.lastX, u.z - u.lastZ);
      u.stuckTimer = 0;
      u.lastX = u.x;
      u.lastZ = u.z;
      if (moved < 0.3) {
        // desiste se já está perto o bastante
        const g = u.goal ?? (u.path.length ? { x: u.path[u.path.length - 1].x + 0.5, z: u.path[u.path.length - 1].z + 0.5 } : null);
        if (!g || Math.hypot(g.x - u.x, g.z - u.z) < 1.6) {
          u.path = [];
          u.goal = null;
          if (u.order === "move" || u.order === "attackMove") {
            u.order = "idle";
            u.guardX = u.x;
            u.guardZ = u.z;
          }
        } else {
          this.setPath(u, g.x, g.z);
        }
      }
    }
  }

  // ---------------------------------------------------------------- coleta

  private findOre(u: Unit): number {
    const w = this.map.w;
    const taken = new Set<number>();
    for (const o of this.units.values()) if (o !== u && o.kind === "harvester" && o.team === u.team && o.oreTile >= 0) taken.add(o.oreTile);
    let best = -1;
    let bestD = Infinity;
    const ore = this.map.ore;
    for (let i = 0; i < ore.length; i++) {
      if (ore[i] <= 0) continue;
      const x = i % w;
      const z = Math.floor(i / w);
      let dd = Math.hypot(x + 0.5 - u.x, z + 0.5 - u.z);
      if (taken.has(i)) dd += 6;
      if (this.isBlocked(i)) continue;
      // evita campos perto de inimigos conhecidos (só a IA se importa)
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best;
  }

  private nearestRefinery(u: Unit): Building | null {
    const pref = u.refId ? this.buildings.get(u.refId) : undefined;
    if (pref && pref.team === u.team) return pref;
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.buildings.values()) {
      if (b.team !== u.team || b.kind !== "refinery") continue;
      const d = rectDist(u.x, u.z, b);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private updateHarvester(u: Unit, dt: number) {
    const w = this.map.w;
    u.hTimer -= dt;
    switch (u.hState) {
      case "idle": {
        u.idleTime += dt;
        const arrived = this.moveAlong(u, dt);
        if (arrived && u.idleTime > 5 && u.order !== "move") {
          u.hState = u.cargo >= HARVEST_CAPACITY ? "toRef" : "toOre";
          u.oreTile = -1;
        } else if (arrived && u.order === "move") {
          u.order = "idle";
          u.idleTime = 0;
        }
        break;
      }
      case "toOre": {
        if (u.oreTile < 0 || this.map.ore[u.oreTile] <= 0) {
          u.oreTile = this.findOre(u);
          if (u.oreTile < 0) {
            u.hState = u.cargo > 0 ? "toRef" : "idle";
            u.idleTime = 0;
            break;
          }
          this.setPath(u, (u.oreTile % w) + 0.5, Math.floor(u.oreTile / w) + 0.5);
          u.goal = null;
        }
        if (u.path.length === 0 && !u.goal && this.tileIndex(u.x, u.z) !== u.oreTile) {
          this.setPath(u, (u.oreTile % w) + 0.5, Math.floor(u.oreTile / w) + 0.5);
          if (u.path.length === 0) {
            u.oreTile = -1;
            break;
          }
        }
        this.moveAlong(u, dt);
        if (this.tileIndex(u.x, u.z) === u.oreTile) {
          u.path = [];
          u.hState = "harvest";
          u.hTimer = 0.7;
        }
        break;
      }
      case "harvest": {
        u.moving = false;
        if (u.hTimer > 0) break;
        u.hTimer = 0.38;
        const i = u.oreTile;
        const take = Math.min(HARVEST_SCOOP, this.map.ore[i] ?? 0, HARVEST_CAPACITY - u.cargo);
        if (take > 0) {
          this.map.ore[i] -= take;
          u.cargo += take;
          this.oreVersion++;
        }
        if (u.cargo >= HARVEST_CAPACITY) {
          u.hState = "toRef";
          u.path = [];
        } else if (this.map.ore[i] <= 0) {
          u.oreTile = -1;
          u.hState = "toOre";
        }
        break;
      }
      case "toRef": {
        const ref = this.nearestRefinery(u);
        if (!ref) {
          u.hState = "idle";
          u.idleTime = -5;
          break;
        }
        u.refId = ref.id;
        if (rectDist(u.x, u.z, ref) < 0.75) {
          u.path = [];
          u.hState = "unload";
          u.hTimer = 0.4;
          break;
        }
        if (u.path.length === 0) {
          const ex = this.exitTile(ref);
          this.setPath(u, ex.x + 0.5, ex.z + 0.5);
          if (u.path.length === 0) {
            // já na saída ou bloqueado
            const f = this.path.nearestFree(ex.x, ex.z, 3);
            if (f) u.goal = { x: f.x + 0.5, z: f.z + 0.2 };
          }
        }
        this.moveAlong(u, dt);
        break;
      }
      case "unload": {
        u.moving = false;
        const ref = u.refId ? this.buildings.get(u.refId) : undefined;
        if (!ref) {
          u.hState = "toRef";
          break;
        }
        u.angle = turnToward(u.angle, -Math.PI / 2, 3 * dt);
        if (u.hTimer > 0) break;
        u.hTimer = 0.12;
        const amt = Math.min(50, u.cargo);
        u.cargo -= amt;
        const mul = u.team === 1 ? DIFFICULTY[this.difficulty].income : 1;
        this.teams[u.team].credits += amt * mul;
        this.teams[u.team].stats.harvested += amt * mul;
        if (u.cargo <= 0) {
          u.cargo = 0;
          u.hState = "toOre";
          u.oreTile = -1;
        }
        break;
      }
    }
    u.turret = u.angle;
  }

  // ---------------------------------------------------------------- construções

  private updateBuilding(b: Building, dt: number) {
    b.recoil = Math.max(0, b.recoil - dt * 3);
    const ts = this.teams[b.team];
    if (b.repairing) {
      if (b.hp >= b.maxHp) b.repairing = false;
      else {
        const rate = b.maxHp * 0.012 * dt;
        const cost = (rate / b.maxHp) * BUILDINGS[b.kind].cost * 0.4;
        if (ts.credits >= cost) {
          ts.credits -= cost;
          b.hp = Math.min(b.maxHp, b.hp + rate);
        }
      }
    }
    const w = BUILDINGS[b.kind].weapon;
    if (!w) return;
    if (this.time - b.bornAt < 1.5) return;
    if (ts.lowPower) return;
    b.cooldown -= dt;
    const cx = b.tx + 0.5;
    const cz = b.tz + 0.5;
    let target = this.get(b.targetId);
    if (target && (target.hp <= 0 || this.distTo(cx, cz, target) > w.range || target.team === b.team)) {
      target = undefined;
      b.targetId = null;
    }
    b.scanTimer -= dt;
    if (!target && b.scanTimer <= 0) {
      b.scanTimer = 0.3;
      const t = this.findTarget(b.team, cx, cz, w.range, w);
      if (t) {
        target = t;
        b.targetId = t.id;
      }
    }
    if (!target) return;
    const c = this.center(target);
    const aim = Math.atan2(c.z - cz, c.x - cx);
    b.turret = turnToward(b.turret, aim, 3 * dt);
    if (Math.abs(angleDiff(b.turret, aim)) < 0.15 && b.cooldown <= 0) {
      b.cooldown = w.reload;
      b.recoil = 1;
      this.fire(b, target, w, cx + Math.cos(b.turret) * 0.55, cz + Math.sin(b.turret) * 0.55, b.kind === "aa" ? 1.0 : 0.75);
    }
  }

  updatePower() {
    for (const team of [0, 1] as Team[]) {
      let prod = 0;
      let use = 0;
      for (const b of this.buildings.values()) {
        if (b.team !== team) continue;
        const p = BUILDINGS[b.kind].power;
        if (p > 0) prod += p * (0.5 + 0.5 * (b.hp / b.maxHp));
        else use -= p;
      }
      const ts = this.teams[team];
      const was = ts.lowPower;
      ts.powerProd = Math.round(prod);
      ts.powerUse = use;
      ts.lowPower = use > prod;
      if (ts.lowPower && !was) this.msg("Energia baixa! Construa mais usinas.", "warn", team);
    }
  }

  // ---------------------------------------------------------------- visão

  updateVision() {
    const w = this.map.w;
    const h = this.map.h;
    for (const team of [0, 1] as Team[]) {
      const ts = this.teams[team];
      ts.visible.fill(0);
      const mark = (cx: number, cz: number, r: number) => {
        const r2 = r * r;
        for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(h - 1, Math.ceil(cz + r)); z++) {
          for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
            const dx = x + 0.5 - cx;
            const dz = z + 0.5 - cz;
            if (dx * dx + dz * dz <= r2) {
              ts.visible[z * w + x] = 1;
              ts.explored[z * w + x] = 1;
            }
          }
        }
      };
      for (const u of this.units.values()) if (u.team === team) mark(u.x, u.z, UNITS[u.kind].sight);
      for (const b of this.buildings.values())
        if (b.team === team) mark(b.tx + b.w / 2, b.tz + b.h / 2, BUILDINGS[b.kind].sight + Math.max(b.w, b.h) / 2);
    }
    this.visVersion++;
    for (const viewer of [0, 1] as Team[]) {
      if (this.airAlerted[viewer] || !this.human[viewer]) continue;
      for (const u of this.units.values()) {
        if (u.team !== viewer && UNITS[u.kind].air && this.teams[viewer].visible[this.tileIndex(u.x, u.z)]) {
          this.airAlerted[viewer] = true;
          this.msg("Aeronaves inimigas avistadas! Torres Antiaéreas e Lança-mísseis as derrubam.", "warn", viewer);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- separação

  private separate() {
    const arr = [...this.units.values()];
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      const ra = UNITS[a.kind].radius;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        const airA = !!UNITS[a.kind].air;
        if (airA !== !!UNITS[b.kind].air) continue;
        const rb = UNITS[b.kind].radius;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const minD = (ra + rb) * 0.9;
        if (Math.abs(dx) > minD || Math.abs(dz) > minD) continue;
        const d = Math.hypot(dx, dz);
        if (d >= minD) continue;
        const push = (minD - d) * 0.5;
        const nx = d > 0.0001 ? dx / d : Math.random() - 0.5;
        const nz = d > 0.0001 ? dz / d : Math.random() - 0.5;
        // quem está parado cede mais espaço
        const am = a.moving ? 0.35 : 1;
        const bm = b.moving ? 0.35 : 1;
        const tot = am + bm;
        const ax = a.x - nx * push * (am / tot) * 2;
        const az = a.z - nz * push * (am / tot) * 2;
        const bx = b.x + nx * push * (bm / tot) * 2;
        const bz = b.z + nz * push * (bm / tot) * 2;
        if (this.inBounds(ax, az) && (airA || !this.isBlocked(this.tileIndex(ax, az)))) {
          a.x = ax;
          a.z = az;
        }
        if (this.inBounds(bx, bz) && (airA || !this.isBlocked(this.tileIndex(bx, bz)))) {
          b.x = bx;
          b.z = bz;
        }
      }
    }
  }

  private regrowOre() {
    const { ore, oreMax, w } = this.map;
    let changed = false;
    for (let i = 0; i < ore.length; i++) {
      if (oreMax[i] <= 0 || ore[i] >= oreMax[i]) continue;
      if (ore[i] > 0) {
        ore[i] = Math.min(oreMax[i], ore[i] + 4);
        changed = true;
      } else if (Math.random() < 0.06) {
        const x = i % w;
        const z = Math.floor(i / w);
        let seed = false;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const j = (z + dz) * w + x + dx;
          if (j >= 0 && j < ore.length && (ore[j] > 0 || this.map.terrain[j] === Terrain.Spire)) seed = true;
        }
        if (seed) {
          ore[i] = 10;
          changed = true;
        }
      }
    }
    if (changed) this.oreVersion++;
  }

  // ---------------------------------------------------------------- laço

  step(rawDt: number) {
    if (this.paused || this.phase !== "playing") return;
    const total = Math.min(rawDt, 0.1) * this.speed;
    const sub = Math.ceil(total / 0.034);
    const dt = total / sub;
    for (let s = 0; s < sub; s++) this.tick(dt);
  }

  private tick(dt: number) {
    this.time += dt;
    this.updateProduction(dt);
    for (const u of [...this.units.values()]) if (this.units.has(u.id)) this.updateUnit(u, dt);
    for (const b of [...this.buildings.values()]) if (this.buildings.has(b.id)) this.updateBuilding(b, dt);
    this.updateProjectiles(dt);
    this.separate();
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.2;
      this.updateVision();
    }
    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      this.powerTimer = 0.5;
      this.updatePower();
    }
    this.oreTimer -= dt;
    if (this.oreTimer <= 0) {
      this.oreTimer = 2;
      this.regrowOre();
    }
    this.endTimer -= dt;
    if (this.endTimer <= 0) {
      this.endTimer = 1;
      if (this.countBuildings(0) === 0) {
        this.phase = "defeat";
      } else if (this.countBuildings(1) === 0) {
        this.phase = "victory";
      }
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
