// IA da Legião Escarlate: constrói a base, mantém a economia, treina tropas e ataca em ondas.

import { BUILDINGS, DIFFICULTY, UNITS, type BuildingKind, type Team, type UnitKind } from "./defs";
import type { Game, Unit } from "./game";

const PLAN: BuildingKind[] = [
  "power",
  "refinery",
  "barracks",
  "power",
  "factory",
  "turret",
  "radar",
  "power",
  "turret",
  "refinery",
  "power",
  "helipad",
  "aa",
  "barracks",
  "turret",
  "factory",
  "power",
  "aa",
  "turret",
];

export class AIController {
  private thinkTimer = 1;
  private nextAttack: number;
  private wave = 0;
  private defending = 0;

  constructor(
    private game: Game,
    private team: Team = 1,
  ) {
    this.nextAttack = DIFFICULTY[game.difficulty].firstAttack;
  }

  update(dt: number) {
    const g = this.game;
    if (g.phase !== "playing" || g.paused) return;
    this.thinkTimer -= dt * g.speed;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 0.8;
    this.think();
  }

  private hq() {
    for (const b of this.game.buildings.values()) if (b.team === this.team && b.kind === "hq") return b;
    return null;
  }

  private baseCenter() {
    const hq = this.hq();
    if (hq) return { x: hq.tx + 1.5, z: hq.tz + 1.5 };
    for (const b of this.game.buildings.values()) if (b.team === this.team) return { x: b.tx + b.w / 2, z: b.tz + b.h / 2 };
    const s = this.game.map.starts[this.team];
    return { x: s.x + 1.5, z: s.z + 1.5 };
  }

  private think() {
    const g = this.game;
    const ts = g.teams[this.team];

    // 1) posicionar construção pronta
    if (ts.ready) this.placeReady(ts.ready);

    // 2) próxima construção do plano
    if (ts.queues.structure.length === 0 && !ts.ready && this.hq()) {
      const next = this.nextStructure();
      if (next) g.queueProduction(this.team, next);
    }

    // 3) economia
    const refineries = g.countBuildings(this.team, "refinery");
    let harvesters = 0;
    for (const u of g.units.values()) if (u.team === this.team && u.kind === "harvester") harvesters++;
    const queuedH = ts.queues.vehicle.filter((q) => q.kind === "harvester").length;
    if (refineries > 0 && harvesters + queuedH < Math.min(refineries * 2, 4) && g.canProduce(this.team, "harvester")) {
      if (harvesters + queuedH < refineries || ts.credits > 900) g.queueProduction(this.team, "harvester");
    }

    // 4) exército
    const reserve = ts.queues.structure.length > 0 ? 400 : 0;
    if (ts.credits > reserve + 150) {
      const enemyAir = this.enemyAirCount();
      if (ts.queues.infantry.length < 2 && g.canProduce(this.team, "rifle")) {
        g.queueProduction(this.team, Math.random() < (enemyAir > 0 ? 0.3 : 0.55) ? "rifle" : "rocket");
      }
      if (ts.queues.air.length < 1 && g.canProduce(this.team, "heli")) {
        g.queueProduction(this.team, Math.random() < 0.65 ? "heli" : "drone");
      }
      if (ts.queues.vehicle.length < 2 && g.canProduce(this.team, "tank")) {
        const opts: [UnitKind, number][] = [
          ["tank", 5],
          ["scout", 1.5],
        ];
        if (g.canProduce(this.team, "heavy")) opts.push(["heavy", 3]);
        if (g.canProduce(this.team, "artillery")) opts.push(["artillery", 2]);
        const tot = opts.reduce((s, o) => s + o[1], 0);
        let r = Math.random() * tot;
        for (const [k, wgt] of opts) {
          r -= wgt;
          if (r <= 0) {
            g.queueProduction(this.team, k);
            break;
          }
        }
      }
    }

    // 5) reparos
    for (const b of g.buildings.values()) {
      if (b.team === this.team && !b.repairing && b.hp < b.maxHp * 0.6 && ts.credits > 600) b.repairing = true;
    }

    this.defend();
    this.attack();
  }

  private enemyAirCount() {
    let n = 0;
    for (const u of this.game.units.values()) if (u.team !== this.team && UNITS[u.kind].air) n++;
    return n;
  }

  private nextStructure(): BuildingKind | null {
    const g = this.game;
    const ts = g.teams[this.team];
    if (ts.powerUse + 30 > ts.powerProd && g.canProduce(this.team, "power")) return "power";
    // reage a aeronaves inimigas com antiaéreas
    const aa = g.countBuildings(this.team, "aa");
    if (g.canProduce(this.team, "aa") && aa < Math.min(4, Math.ceil(this.enemyAirCount() / 2) + 1) && this.enemyAirCount() > 0) return "aa";
    const have: Partial<Record<BuildingKind, number>> = {};
    for (const b of g.buildings.values()) if (b.team === this.team) have[b.kind] = (have[b.kind] ?? 0) + 1;
    const need: Partial<Record<BuildingKind, number>> = {};
    for (const k of PLAN) {
      need[k] = (need[k] ?? 0) + 1;
      if ((have[k] ?? 0) < need[k]!) {
        if (!g.canProduce(this.team, k)) return null;
        if (ts.credits < BUILDINGS[k].cost * 0.4 && k !== "power" && k !== "refinery") return null;
        return k;
      }
    }
    return null;
  }

  private placeReady(kind: BuildingKind) {
    const g = this.game;
    const d = BUILDINGS[kind];
    const c = this.baseCenter();
    const enemy = g.map.starts[this.team === 1 ? 0 : 1];
    const towardEnemy = { x: enemy.x - c.x, z: enemy.z - c.z };
    const len = Math.hypot(towardEnemy.x, towardEnemy.z) || 1;
    const found: { best: { x: number; z: number } | null } = { best: null };
    let bestScore = Infinity;
    for (let r = 2; r < 14; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const tx = Math.floor(c.x + dx - d.w / 2);
          const tz = Math.floor(c.z + dz - d.h / 2);
          if (!g.canPlace(this.team, kind, tx, tz)) continue;
          if (!this.hasClearRing(tx, tz, d.w, d.h)) continue;
          const px = tx + d.w / 2 - c.x;
          const pz = tz + d.h / 2 - c.z;
          const forward = (px * towardEnemy.x + pz * towardEnemy.z) / len;
          let score = Math.hypot(px, pz);
          if (kind === "turret" || kind === "aa") score = Math.abs(Math.hypot(px, pz) - 7) - forward * 0.8 + Math.random() * 2;
          else score -= forward * 0.15;
          if (score < bestScore) {
            bestScore = score;
            found.best = { x: tx, z: tz };
          }
        }
      }
      if (found.best && r > 4) break;
    }
    const best = found.best;
    if (best) g.placeStructure(this.team, best.x, best.z);
    else g.cancelProduction(this.team, kind);
  }

  // Mantém um anel livre de 1 tile para não fechar caminhos.
  private hasClearRing(tx: number, tz: number, w: number, h: number) {
    const g = this.game;
    for (let z = tz - 1; z <= tz + h; z++) {
      for (let x = tx - 1; x <= tx + w; x++) {
        if (x >= tx && x < tx + w && z >= tz && z < tz + h) continue;
        if (!g.inBounds(x, z)) return false;
        if (g.bOcc[z * g.map.w + x] !== 0) return false;
      }
    }
    return true;
  }

  private army(): Unit[] {
    const out: Unit[] = [];
    for (const u of this.game.units.values()) if (u.team === this.team && u.kind !== "harvester") out.push(u);
    return out;
  }

  private defend() {
    const g = this.game;
    const ts = g.teams[this.team];
    const atk = ts.lastAttackPos;
    if (!atk || g.time - atk.t > 4) return;
    const c = this.baseCenter();
    if (Math.hypot(atk.x - c.x, atk.z - c.z) > 16) return;
    if (g.time - this.defending < 5) return;
    this.defending = g.time;
    const ids = this.army()
      .filter((u) => u.order === "idle" && Math.hypot(u.x - c.x, u.z - c.z) < 20)
      .map((u) => u.id);
    if (ids.length) g.issueMove(ids, atk.x, atk.z, true, true);
  }

  private attack() {
    const g = this.game;
    if (g.time < this.nextAttack) return;
    const diff = DIFFICULTY[g.difficulty];
    const idle = this.army().filter((u) => u.order === "idle");
    const size = diff.waveSize + this.wave * 2;
    if (idle.length < size) return;
    // alvo: construção do jogador mais próxima
    let target: { x: number; z: number } | null = null;
    let bd = Infinity;
    const c = this.baseCenter();
    for (const b of g.buildings.values()) {
      if (b.team === this.team) continue;
      const bx = b.tx + b.w / 2;
      const bz = b.tz + b.h / 2;
      // ondas alternam entre o alvo mais próximo e a economia do jogador
      const prefer = this.wave % 2 === 1 && b.kind === "refinery" ? -15 : 0;
      const d = Math.hypot(bx - c.x, bz - c.z) + prefer;
      if (d < bd) {
        bd = d;
        target = { x: bx, z: bz };
      }
    }
    if (!target) return;
    // deixa alguns defensores em casa
    const keep = Math.min(3, Math.floor(idle.length * 0.25));
    const sendUnits = idle.slice(keep);
    const inf = sendUnits.filter((u) => UNITS[u.kind].infantry).map((u) => u.id);
    const veh = sendUnits.filter((u) => !UNITS[u.kind].infantry).map((u) => u.id);
    if (veh.length) g.issueMove(veh, target.x, target.z, true, true);
    if (inf.length) g.issueMove(inf, target.x, target.z, true, true);
    this.wave++;
    this.nextAttack = g.time + diff.waveEvery;
    if (this.wave === 1) g.msg("Forças inimigas estão se movendo!", "warn");
  }
}
