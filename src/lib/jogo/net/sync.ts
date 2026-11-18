// Sincronização em rede com anfitrião autoritativo.
// O anfitrião simula a partida e envia o estado ~10x por segundo; o convidado mantém uma réplica e manda ordens.
// O convidado vê o mundo espelhado (x ↔ z) e com os times trocados, para que a base dele também fique embaixo.

import { BUILDINGS, UNITS, type BuildingKind, type Faction, type Producer, type Team, type UnitKind, type WeaponKind } from "../defs";
import { angleDiff, type Game, type GameEvent, type HarvestState, type Order, type Phase, type Projectile } from "../game";
import type { MapId } from "../map";
import { LocalOrders, type ItemKind, type Orders } from "../orders";
import type { Room } from "./room";

const UNIT_KINDS = Object.keys(UNITS) as UnitKind[];
const BUILD_KINDS = Object.keys(BUILDINGS) as BuildingKind[];
const ITEM_KINDS: ItemKind[] = [...UNIT_KINDS, ...BUILD_KINDS];
const WEAPONS: WeaponKind[] = ["bullet", "cannon", "rocket", "shell", "flak", "laser", "flame"];
const ORDERS: Order[] = ["idle", "move", "attack", "attackMove"];
const HSTATES: HarvestState[] = ["idle", "toOre", "harvest", "toRef", "unload"];
const PRODUCERS: Producer[] = ["structure", "infantry", "vehicle", "air"];

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const flipTeam = (t: Team): Team => (t === 0 ? 1 : 0);
const flipAngle = (a: number) => Math.PI / 2 - a;
const flipPhase = (p: Phase): Phase => (p === "victory" ? "defeat" : p === "defeat" ? "victory" : p);

// ------------------------------------------------------------ mensagens

export interface Hello {
  t: "hello";
  v: 1;
  mapId: MapId;
  hostFaction: Faction;
}

type Cmd =
  | { c: "smart"; ids: number[]; x: number; z: number; target: number | null; am: boolean; fm?: boolean }
  | { c: "stop"; ids: number[] }
  | { c: "queue"; k: ItemKind }
  | { c: "cancel"; k: ItemKind }
  | { c: "place"; tx: number; tz: number }
  | { c: "sell"; id: number }
  | { c: "repair"; id: number }
  | { c: "primary"; id: number }
  | { c: "rally"; ids: number[]; x: number; z: number } // x < 0 remove
  | { c: "guard"; ids: number[]; x: number; z: number };

type UnitRow = [number, number, Team, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type BuildingRow = [number, number, Team, number, number, number, number, number, number, number, number, number];
type ProjRow = [number, number, number, number, number, number, number, number, number, number, number];

interface Snap {
  t: number;
  ph: Phase;
  u: UnitRow[];
  b: BuildingRow[];
  p: ProjRow[];
  me: {
    cr: number;
    pp: number;
    pu: number;
    lp: boolean;
    q: [number, number, number][]; // [produtor, item, progresso]
    rd: number; // item pronto (-1 = nenhum)
    st: { built: number; lost: number; kills: number; harvested: number; structures: number };
    prim: [number, number][];
  };
  foe: { lp: boolean; lost: number };
  ore?: [number, number][];
  ev: GameEvent[];
}

type NetMsg = Hello | { t: "snap"; s: Snap } | { t: "cmd"; cmd: Cmd } | { t: "ping"; at: number } | { t: "pong"; at: number } | { t: "bye" };

// Latência medida com ping/pong, comum aos dois lados.
class Pinger {
  rtt = 0;
  private timer: number;
  constructor(private room: Room) {
    this.timer = window.setInterval(() => room.send({ t: "ping", at: performance.now() }), 2000);
  }
  handle(m: NetMsg) {
    if (m.t === "ping") this.room.send({ t: "pong", at: m.at });
    else if (m.t === "pong") this.rtt = Math.round(performance.now() - m.at);
  }
  dispose() {
    window.clearInterval(this.timer);
  }
}

// ------------------------------------------------------------ anfitrião

export class HostLink {
  private out: GameEvent[] = [];
  private lastSnap = 0;
  private oreSent = -1;
  private lastOre = 0;
  private remote: LocalOrders;
  private off: () => void;
  private pinger: Pinger;

  constructor(
    private game: Game,
    private room: Room,
  ) {
    game.human = [true, true];
    this.remote = new LocalOrders(game, 1);
    this.pinger = new Pinger(room);
    this.off = room.onMessage((raw) => {
      const m = raw as NetMsg;
      this.pinger.handle(m);
      if (m.t === "cmd") this.apply(m.cmd);
    });
  }

  get rtt() {
    return this.pinger.rtt;
  }

  // Ordens do convidado chegam espelhadas: desfaz o espelho antes de aplicar ao time 1.
  private apply(c: Cmd) {
    const o = this.remote;
    switch (c.c) {
      case "smart":
        o.smart(c.ids, c.z, c.x, c.target, c.am, !!c.fm);
        break;
      case "stop":
        o.stop(c.ids);
        break;
      case "queue":
        o.queue(c.k);
        break;
      case "cancel":
        o.cancel(c.k);
        break;
      case "place":
        o.place(c.tz, c.tx);
        break;
      case "sell":
        o.sell(c.id);
        break;
      case "repair":
        o.repair(c.id);
        break;
      case "primary":
        o.primary(c.id);
        break;
      case "rally":
        o.rally(c.ids, c.x < 0 ? null : { x: c.z, z: c.x });
        break;
      case "guard":
        o.guard(c.ids, c.z, c.x);
        break;
    }
  }

  // Recebe os eventos do quadro e guarda os que interessam ao convidado, já espelhados.
  collect(events: GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "fire":
          this.out.push({ ...e, x: r2(e.z), z: r2(e.x), tx: r2(e.tz), tz: r2(e.tx), team: flipTeam(e.team) });
          break;
        case "impact":
        case "death":
        case "buildingDeath":
        case "sold":
          this.out.push({ ...e, x: r2(e.z), z: r2(e.x) });
          break;
        case "placed":
          this.out.push({ ...e, x: e.z, z: e.x, team: flipTeam(e.team) });
          break;
        case "unitReady":
        case "structureReady":
          if (e.team === 1) this.out.push({ ...e, team: 0 });
          break;
        case "msg":
          if (e.team === 1) this.out.push({ ...e, team: 0 });
          break;
      }
    }
    if (this.out.length > 400) this.out.splice(0, this.out.length - 400);
  }

  tick(now: number) {
    if (now - this.lastSnap < 100 || !this.room.isOpen) return;
    this.lastSnap = now;
    const g = this.game;
    const ts = g.teams[1];
    const snap: Snap = {
      t: r2(g.time),
      ph: flipPhase(g.phase),
      u: [...g.units.values()].map((u) => [
        u.id,
        UNIT_KINDS.indexOf(u.kind),
        flipTeam(u.team),
        r2(u.z),
        r2(u.x),
        r3(flipAngle(u.angle)),
        r3(flipAngle(u.turret)),
        Math.ceil(u.hp),
        u.moving ? 1 : 0,
        u.cargo,
        r2(u.recoil),
        r2(u.bornAt),
        ORDERS.indexOf(u.order),
        HSTATES.indexOf(u.hState),
        u.goal ? r2(u.goal.z) : -1,
        u.goal ? r2(u.goal.x) : -1,
        u.targetId ?? -1,
        u.protect ? r2(u.protect.z) : -1,
        u.protect ? r2(u.protect.x) : -1,
      ]),
      b: [...g.buildings.values()].map((b) => [
        b.id,
        BUILD_KINDS.indexOf(b.kind),
        flipTeam(b.team),
        b.tz,
        b.tx,
        Math.ceil(b.hp),
        r3(flipAngle(b.turret)),
        r2(b.recoil),
        b.repairing ? 1 : 0,
        b.rally ? r2(b.rally.z) : -1,
        b.rally ? r2(b.rally.x) : -1,
        r2(b.bornAt),
      ]),
      p: g.projectiles.map((p) => [p.id, WEAPONS.indexOf(p.kind), r2(p.sz), r2(p.sx), r2(p.sy), r2(p.tz), r2(p.tx), r2(p.ty), r3(p.t), r3(p.dur), r2(p.arc)]),
      me: {
        cr: Math.floor(ts.credits),
        pp: ts.powerProd,
        pu: ts.powerUse,
        lp: ts.lowPower,
        q: PRODUCERS.flatMap((pr, pi) => ts.queues[pr].map((it): [number, number, number] => [pi, ITEM_KINDS.indexOf(it.kind), r3(it.progress)])),
        rd: ts.ready ? ITEM_KINDS.indexOf(ts.ready) : -1,
        st: { ...ts.stats },
        prim: Object.entries(g.primary[1]).map(([p, id]) => [PRODUCERS.indexOf(p as Producer), id as number]),
      },
      foe: { lp: g.teams[0].lowPower, lost: g.teams[0].stats.lost },
      ev: this.out,
    };
    this.out = [];
    if (g.oreVersion !== this.oreSent && now - this.lastOre > 1000) {
      this.oreSent = g.oreVersion;
      this.lastOre = now;
      const { ore, oreMax, w } = g.map;
      const list: [number, number][] = [];
      for (let i = 0; i < ore.length; i++) if (oreMax[i] > 0) list.push([(i % w) * w + Math.floor(i / w), Math.round(ore[i])]);
      snap.ore = list;
    }
    this.room.send({ t: "snap", s: snap });
  }

  dispose() {
    this.off();
    this.pinger.dispose();
  }
}

// ------------------------------------------------------------ convidado

// Prepara uma partida-réplica: mapa espelhado e sem entidades (tudo vem do anfitrião).
export function prepareReplica(game: Game) {
  const m = game.map;
  const w = m.w;
  const tr = <T extends Uint8Array | Float32Array>(a: T) => {
    const c = a.slice() as T;
    for (let z = 0; z < m.h; z++) for (let x = 0; x < w; x++) a[x * w + z] = c[z * w + x];
  };
  tr(m.terrain);
  tr(m.ore);
  tr(m.oreMax);
  tr(m.shade);
  m.spires = m.spires.map((s) => ({ x: s.z, z: s.x }));
  game.units.clear();
  game.buildings.clear();
  game.projectiles = [];
  game.bOcc.fill(0);
  game.human = [false, false];
  game.events = [];
}

interface Target {
  x: number;
  z: number;
  a: number;
  tu: number;
}

export class GuestLink {
  readonly orders: Orders;
  private targets = new Map<number, Target>();
  private turrets = new Map<number, number>();
  private off: () => void;
  private pinger: Pinger;
  private visTimer = 0;
  private gotFirst = false;

  constructor(
    private game: Game,
    private room: Room,
  ) {
    this.pinger = new Pinger(room);
    this.off = room.onMessage((raw) => {
      const m = raw as NetMsg;
      this.pinger.handle(m);
      if (m.t === "snap") this.apply(m.s);
    });
    const send = (cmd: Cmd) => room.send({ t: "cmd", cmd });
    const g = game;
    this.orders = {
      smart: (ids, x, z, target, am, fm) => send({ c: "smart", ids: ids.filter((id) => g.get(id)?.team === 0), x: r2(x), z: r2(z), target, am, fm: !!fm }),
      stop: (ids) => send({ c: "stop", ids }),
      queue: (k) => {
        if (!g.canProduce(0, k)) return false;
        send({ c: "queue", k });
        return true;
      },
      cancel: (k) => {
        send({ c: "cancel", k });
        return true;
      },
      place: (tx, tz) => {
        send({ c: "place", tx, tz });
        // mostra na hora; o próximo estado do anfitrião confirma
        g.teams[0].ready = null;
        return true;
      },
      sell: (id) => send({ c: "sell", id }),
      repair: (id) => send({ c: "repair", id }),
      primary: (id) => send({ c: "primary", id }),
      guard: (ids, x, z) => send({ c: "guard", ids: ids.filter((id) => g.get(id)?.team === 0), x: r2(x), z: r2(z) }),
      rally: (ids, p) => send({ c: "rally", ids: ids.filter((id) => g.get(id)?.team === 0), x: p ? r2(p.x) : -1, z: p ? r2(p.z) : -1 }),
    };
  }

  get rtt() {
    return this.pinger.rtt;
  }

  get ready() {
    return this.gotFirst;
  }

  private apply(s: Snap) {
    const g = this.game;
    g.time = s.t;
    g.phase = s.ph;
    // unidades
    const seenU = new Set<number>();
    for (const r of s.u) {
      const [id, k, team, x, z, ang, tur, hp, fl, cargo, rec, born, ord, hs, gx, gz, tid, px, pz] = r;
      let u = g.units.get(id);
      if (!u) {
        u = g.addUnit(team, UNIT_KINDS[k], x, z);
        g.units.delete(u.id);
        u.id = id;
        g.units.set(id, u);
        u.angle = ang;
        u.turret = tur;
      }
      this.targets.set(id, { x, z, a: ang, tu: tur });
      u.hp = hp;
      u.moving = fl === 1;
      u.cargo = cargo;
      u.recoil = rec;
      u.bornAt = born;
      u.order = ORDERS[ord] ?? "idle";
      u.hState = HSTATES[hs] ?? "idle";
      u.goal = gx >= 0 ? { x: gx, z: gz } : null;
      u.targetId = tid >= 0 ? tid : null;
      u.protect = px >= 0 ? { x: px, z: pz } : null;
      seenU.add(id);
    }
    for (const id of [...g.units.keys()]) {
      if (!seenU.has(id)) {
        g.units.delete(id);
        g.selected.delete(id);
        this.targets.delete(id);
      }
    }
    // construções
    const seenB = new Set<number>();
    let changed = false;
    for (const r of s.b) {
      const [id, k, team, tx, tz, hp, tur, rec, rep, rx, rz, born] = r;
      let b = g.buildings.get(id);
      if (!b) {
        b = g.addBuilding(team, BUILD_KINDS[k], tx, tz);
        g.buildings.delete(b.id);
        b.id = id;
        g.buildings.set(id, b);
        b.turret = tur;
        changed = true;
      }
      b.hp = hp;
      this.turrets.set(id, tur);
      b.recoil = rec;
      b.repairing = rep === 1;
      b.rally = rx >= 0 ? { x: rx, z: rz } : null;
      b.bornAt = born;
      seenB.add(id);
    }
    for (const id of [...g.buildings.keys()]) {
      if (!seenB.has(id)) {
        g.buildings.delete(id);
        g.selected.delete(id);
        this.turrets.delete(id);
        changed = true;
      }
    }
    if (changed) {
      g.bOcc.fill(0);
      for (const b of g.buildings.values())
        for (let z = b.tz; z < b.tz + b.h; z++) for (let x = b.tx; x < b.tx + b.w; x++) g.bOcc[z * g.map.w + x] = b.id;
    }
    // projéteis: a réplica continua o voo entre um estado e outro
    g.projectiles = s.p.map(([id, wk, sx, sz, sy, tx, tz, ty, t, dur, arc]): Projectile => ({
      id,
      kind: WEAPONS[wk],
      team: 0,
      sx,
      sz,
      sy,
      x: sx,
      z: sz,
      y: sy,
      tx,
      tz,
      ty,
      targetId: null,
      t,
      dur,
      damage: 0,
      splash: 0,
      arc,
      targets: "ground",
      sourceId: 0,
    }));
    // economia e produção do convidado
    const me = g.teams[0];
    me.credits = s.me.cr;
    me.powerProd = s.me.pp;
    me.powerUse = s.me.pu;
    me.lowPower = s.me.lp;
    me.queues = { structure: [], infantry: [], vehicle: [], air: [] };
    for (const [pi, ki, prog] of s.me.q) me.queues[PRODUCERS[pi]].push({ kind: ITEM_KINDS[ki], progress: prog, paid: 0 });
    me.ready = s.me.rd >= 0 ? (ITEM_KINDS[s.me.rd] as BuildingKind) : null;
    me.stats = s.me.st;
    g.primary[0] = {};
    for (const [pi, id] of s.me.prim) g.primary[0][PRODUCERS[pi]] = id;
    g.teams[1].lowPower = s.foe.lp;
    g.teams[1].stats.lost = s.foe.lost;
    if (s.ore) {
      for (const [i, amt] of s.ore) g.map.ore[i] = amt;
      g.oreVersion++;
    }
    for (const e of s.ev) g.events.push(e);
    if (!this.gotFirst) {
      this.gotFirst = true;
      // posiciona tudo de imediato na primeira vez
      for (const [id, t] of this.targets) {
        const u = g.units.get(id);
        if (u) {
          u.x = t.x;
          u.z = t.z;
        }
      }
      g.updateVision();
    }
  }

  // Suaviza o movimento entre estados e avança o que é só visual.
  frame(dt: number) {
    const g = this.game;
    if (g.phase === "playing") g.time += dt;
    const k = 1 - Math.exp(-dt * 12);
    for (const [id, t] of this.targets) {
      const u = g.units.get(id);
      if (!u) continue;
      if (Math.hypot(t.x - u.x, t.z - u.z) > 3) {
        u.x = t.x;
        u.z = t.z;
      } else {
        u.x += (t.x - u.x) * k;
        u.z += (t.z - u.z) * k;
      }
      u.angle += angleDiff(u.angle, t.a) * k;
      u.turret += angleDiff(u.turret, t.tu) * k;
    }
    for (const [id, tu] of this.turrets) {
      const b = g.buildings.get(id);
      if (b) b.turret += angleDiff(b.turret, tu) * k;
    }
    for (const p of g.projectiles) {
      p.t += dt;
      const f = Math.min(1, p.t / p.dur);
      p.x = p.sx + (p.tx - p.sx) * f;
      p.z = p.sz + (p.tz - p.sz) * f;
      p.y = p.sy * (1 - f) + p.ty * f + Math.sin(Math.PI * f) * p.arc;
    }
    g.projectiles = g.projectiles.filter((p) => p.t < p.dur);
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.2;
      g.updateVision();
    }
  }

  dispose() {
    this.off();
    this.pinger.dispose();
  }
}

export function sendHello(room: Room, mapId: MapId, hostFaction: Faction) {
  const h: Hello = { t: "hello", v: 1, mapId, hostFaction };
  room.send(h);
}

// Espera a mensagem de boas-vindas do anfitrião (mapa e facção dele).
export function waitHello(room: Room): Promise<Hello> {
  return new Promise((resolve) => {
    const off = room.onMessage((raw) => {
      const m = raw as NetMsg;
      if (m.t === "hello") {
        off();
        resolve(m);
      }
    });
  });
}
