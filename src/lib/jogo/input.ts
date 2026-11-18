// Entrada: mouse (clique esquerdo seleciona, direito comanda), toque (toque comanda, arrastar move a câmera,
// pinça dá zoom) e teclado.

import type { Sfx } from "./audio";
import { BUILDINGS, isRallyKind, type BuildingKind } from "./defs";
import type { Entity, Game } from "./game";
import type { Orders } from "./orders";
import type { GameRenderer } from "./render/scene";

export interface InputMode {
  placing: BuildingKind | null;
  attackMove: boolean;
  forceMove: boolean; // "Mover": vai até o destino sem parar para lutar
  boxMode: boolean;
  rally: boolean; // próximo clique/toque no mapa define o ponto de desembarque
  guard: boolean; // "Proteger": próximo clique/toque escolhe a área a proteger
}

export interface InputHooks {
  getMode(): InputMode;
  setMode(patch: Partial<InputMode>): void;
  setBox(r: { x0: number; y0: number; x1: number; y1: number } | null): void;
  togglePause(): void;
  sfx: Sfx;
}

interface PointerInfo {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  type: string;
  moved: boolean;
  box: boolean;
  pan: boolean;
  drag: boolean; // arrastando uma tropa até o destino
  grab: number | null; // unidade própria sob o dedo/cursor ao apertar
}

export class InputController {
  private pointers = new Map<number, PointerInfo>();
  private pinch: { dist: number; zoom: number; mx: number; my: number } | null = null;
  private keys = new Set<string>();
  private groups = new Map<number, number[]>();
  private lastGroupKey = { n: -1, t: 0 };
  private lastTap = { t: 0, id: -1 };
  private hover: { x: number; y: number } | null = null;
  private touchGhost: { tx: number; tz: number } | null = null;
  private lastGhost: { tx: number; tz: number } | null = null;
  private disposers: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
    private r: GameRenderer,
    private hooks: InputHooks,
    private orders: Orders,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(canvas, "pointerdown", (e) => this.down(e));
    on(canvas, "pointermove", (e) => this.move(e));
    on(canvas, "pointerup", (e) => this.up(e));
    on(canvas, "pointercancel", (e) => this.cancel(e));
    on(canvas, "pointerleave", () => (this.hover = null));
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on(canvas, "wheel", (e) => this.wheel(e), { passive: false });
    on(window, "keydown", (e) => this.keyDown(e as KeyboardEvent));
    on(window, "keyup", (e) => this.keys.delete((e as KeyboardEvent).key));
    on(window, "blur", () => this.keys.clear());
  }

  dispose() {
    for (const d of this.disposers) d();
  }

  private local(e: PointerEvent | WheelEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ------------------------------------------------------------ ponteiro

  private down(e: PointerEvent) {
    this.hooks.sfx.unlock();
    const p = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    // apertar sobre uma unidade própria permite arrastá-la até o destino
    let grab: number | null = null;
    if (e.button === 0 && !this.hooks.getMode().placing && !this.hooks.getMode().rally) {
      const id = this.r.pick(p.x, p.y, e.pointerType === "mouse" ? 12 : 24);
      const u = id !== null ? this.game.units.get(id) : undefined;
      if (u && u.team === 0) grab = id;
    }
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, button: e.button, type: e.pointerType, moved: false, box: false, pan: false, drag: false, grab });
    if (e.pointerType === "touch" && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.r.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      for (const q of this.pointers.values()) {
        q.moved = true;
        q.box = false;
        q.drag = false;
      }
      this.hooks.setBox(null);
      this.r.setDragArrow(null);
    }
  }

  private move(e: PointerEvent) {
    const p = this.local(e);
    if (e.pointerType === "mouse") this.hover = p;
    const info = this.pointers.get(e.pointerId);
    if (!info) return;
    const dx = p.x - info.x;
    const dy = p.y - info.y;
    info.x = p.x;
    info.y = p.y;
    const total = Math.hypot(p.x - info.sx, p.y - info.sy);
    const touch = info.type !== "mouse";

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.r.setZoom((this.pinch.zoom * dist) / Math.max(1, this.pinch.dist), { x: mx, y: my });
      this.r.panPixels(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch.mx = mx;
      this.pinch.my = my;
      return;
    }

    if (!info.moved && total > (touch ? 10 : 5)) {
      info.moved = true;
      const mode = this.hooks.getMode();
      if (info.grab !== null && !mode.placing && !mode.boxMode) {
        info.drag = true;
        // arrastar uma unidade fora da seleção passa a comandar só ela
        if (!this.game.selected.has(info.grab)) this.selectOnly(info.grab);
      } else if (touch) {
        if (mode.placing) {
          info.pan = false; // arrastar o fantasma
        } else if (mode.boxMode) info.box = true;
        else info.pan = true;
      } else if (info.button === 0 && !mode.placing) info.box = true;
      else if (info.button === 1 || info.button === 2) info.pan = true;
    }
    if (info.pan) this.r.panPixels(dx, dy);
    if (info.drag) this.updateDragArrow(p.x, p.y);
    if (info.box) this.hooks.setBox({ x0: info.sx, y0: info.sy, x1: p.x, y1: p.y });
    if (touch && info.moved && this.hooks.getMode().placing) {
      const t = this.ghostTile(p.x, p.y);
      if (t) this.touchGhost = t;
    }
  }

  private up(e: PointerEvent) {
    const info = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!info) return;
    const p = this.local(e);
    if (info.drag) {
      this.r.setDragArrow(null);
      // ao soltar, mira tolerante: perto de um inimigo já conta como ataque
      if (this.canCommand()) this.command(p.x, p.y, this.r.pick(p.x, p.y, info.type === "mouse" ? 24 : 34));
      return;
    }
    if (info.box) {
      this.hooks.setBox(null);
      const ids = this.r.unitsInRect(info.sx, info.sy, p.x, p.y, 0);
      if (ids.length) {
        if (!e.shiftKey) this.game.selected.clear();
        for (const id of ids) this.game.selected.add(id);
        this.hooks.sfx.ui();
        if (info.type !== "mouse") this.hooks.setMode({ boxMode: false });
      }
      return;
    }
    if (info.moved) return;
    if (info.type === "mouse") {
      if (info.button === 0) this.mouseClick(p.x, p.y, e.shiftKey);
      else if (info.button === 2) this.rightClick(p.x, p.y);
    } else {
      this.tap(p.x, p.y);
    }
  }

  private cancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    this.hooks.setBox(null);
    this.r.setDragArrow(null);
  }

  // Seta do arrasto: do centro das tropas selecionadas até o dedo; vermelha sobre inimigo.
  private updateDragArrow(px: number, py: number) {
    const to = this.r.screenToWorld(px, py);
    if (!to) return;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const id of this.game.selected) {
      const u = this.game.units.get(id);
      if (!u || u.team !== 0) continue;
      x += u.x;
      z += u.z;
      n++;
    }
    if (!n) return;
    const target = this.game.get(this.r.pick(px, py, 30));
    const attack = (!!target && target.team !== 0) || this.hooks.getMode().attackMove;
    this.r.setDragArrow({ x0: x / n, z0: z / n, x1: to.x, z1: to.z, attack });
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    this.r.setZoom(this.r.zoom * Math.exp(-e.deltaY * 0.0015), p);
  }

  // ------------------------------------------------------------ ações

  private ghostTile(px: number, py: number) {
    const kind = this.hooks.getMode().placing;
    const w = this.r.screenToWorld(px, py);
    if (!kind || !w) return null;
    const d = BUILDINGS[kind];
    return { tx: Math.floor(w.x - d.w / 2 + 0.5), tz: Math.floor(w.z - d.h / 2 + 0.5) };
  }

  private tryPlace(tx: number, tz: number) {
    // valida localmente (em rede o anfitrião confirma)
    const kind = this.hooks.getMode().placing;
    if (kind && this.game.canPlace(0, kind, tx, tz) && this.orders.place(tx, tz)) {
      this.hooks.setMode({ placing: null });
      this.touchGhost = null;
      return true;
    }
    this.hooks.sfx.ui();
    return false;
  }

  placeGhost() {
    const t = this.touchGhost ?? this.lastGhost;
    if (t) this.tryPlace(t.tx, t.tz);
  }

  private selectedOwn() {
    const out: Entity[] = [];
    for (const id of this.game.selected) {
      const e = this.game.get(id);
      if (e && e.team === 0) out.push(e);
    }
    return out;
  }

  // Prédios produtores selecionados (quartel, fábrica, heliporto).
  rallyBuildings() {
    return this.selectedOwn()
      .filter((e) => e.type === "building" && isRallyKind(e.kind))
      .map((e) => e.id);
  }

  private setRallyAt(px: number, py: number) {
    const w = this.r.screenToWorld(px, py);
    const ids = this.rallyBuildings();
    this.hooks.setMode({ rally: false });
    if (!w || !ids.length) return;
    this.orders.rally(ids, { x: w.x, z: w.z });
    this.r.ping(w.x, w.z, false);
    this.hooks.sfx.ui();
  }

  clearRally() {
    const ids = this.rallyBuildings();
    if (!ids.length) return;
    this.orders.rally(ids, null);
    this.hooks.setMode({ rally: false });
    this.hooks.sfx.ui();
  }

  private canCommand() {
    return this.selectedOwn().some((e) => e.type === "unit" || e.kind === "barracks" || e.kind === "factory" || e.kind === "helipad");
  }

  private command(px: number, py: number, id: number | null) {
    const w = this.r.screenToWorld(px, py);
    if (!w) return;
    const mode = this.hooks.getMode();
    if (mode.guard) {
      const ids = this.selectedOwn()
        .filter((e) => e.type === "unit")
        .map((e) => e.id);
      if (ids.length) {
        this.orders.guard(ids, w.x, w.z);
        this.r.ping(w.x, w.z, false);
      }
      this.hooks.setMode({ guard: false });
      return;
    }
    // "Mover" ignora o que estiver sob o destino; "Atacar" ataca o alvo ou avança lutando
    const tid = mode.forceMove ? null : id;
    const target = this.game.get(tid);
    const attack = !!target && target.team !== 0;
    this.orders.smart([...this.game.selected], w.x, w.z, tid, mode.attackMove, mode.forceMove);
    this.r.ping(target ? this.game.center(target).x : w.x, target ? this.game.center(target).z : w.z, attack || mode.attackMove);
    if (mode.attackMove || mode.forceMove) this.hooks.setMode({ attackMove: false, forceMove: false });
  }

  // Com tropas selecionadas, uma unidade própria só "pega" o clique se estiver exatamente
  // sob o cursor/dedo; perto dela, o clique vale como ordem de movimento.
  private resolvePick(px: number, py: number, tolerance: number) {
    const id = this.r.pick(px, py, tolerance);
    const e = this.game.get(id);
    if (e && e.team === 0 && this.hasUnitsSelected() && this.r.pickExact(px, py) !== id) return null;
    return id;
  }

  private hasUnitsSelected() {
    return this.selectedOwn().some((s) => s.type === "unit");
  }

  private selectOnly(id: number) {
    this.game.selected.clear();
    this.game.selected.add(id);
    this.hooks.sfx.ui();
  }

  private selectSameType(id: number) {
    const e = this.game.get(id);
    if (!e || e.type !== "unit") return;
    this.game.selected.clear();
    for (const uid of this.r.unitsOnScreen(0)) {
      const u = this.game.units.get(uid);
      if (u && u.kind === e.kind) this.game.selected.add(uid);
    }
    this.hooks.sfx.ui();
  }

  private mouseClick(px: number, py: number, shift: boolean) {
    const mode = this.hooks.getMode();
    if (mode.placing) {
      const t = this.ghostTile(px, py);
      if (t) this.tryPlace(t.tx, t.tz);
      return;
    }
    if (mode.rally) {
      this.setRallyAt(px, py);
      return;
    }
    const id = this.resolvePick(px, py, 14);
    if ((mode.attackMove || mode.forceMove || mode.guard) && this.canCommand()) {
      this.command(px, py, id);
      return;
    }
    const now = performance.now();
    const dbl = id !== null && this.lastTap.id === id && now - this.lastTap.t < 350;
    this.lastTap = { t: now, id: id ?? -1 };
    const enemy = this.game.get(id);
    // com tropas selecionadas: clique num inimigo ataca, clique no chão move
    if (!shift && this.hasUnitsSelected() && (!enemy || enemy.team !== 0)) {
      this.command(px, py, id);
      return;
    }
    if (id !== null) {
      const e = this.game.get(id)!;
      if (dbl && e.team === 0) this.selectSameType(id);
      else if (shift && e.team === 0) {
        if (this.game.selected.has(id)) this.game.selected.delete(id);
        else this.game.selected.add(id);
        // não mistura com seleção inimiga
        for (const s of [...this.game.selected]) if (this.game.get(s)?.team !== 0) this.game.selected.delete(s);
      } else this.selectOnly(id);
    } else if (!shift) {
      this.game.selected.clear();
    }
  }

  private rightClick(px: number, py: number) {
    const mode = this.hooks.getMode();
    if (mode.placing) {
      this.hooks.setMode({ placing: null });
      return;
    }
    if (mode.attackMove || mode.forceMove || mode.rally || mode.guard) {
      this.hooks.setMode({ attackMove: false, forceMove: false, rally: false, guard: false });
      return;
    }
    if (!this.canCommand()) return;
    this.command(px, py, this.r.pick(px, py, 14));
  }

  private tap(px: number, py: number) {
    const mode = this.hooks.getMode();
    if (mode.placing) {
      const t = this.ghostTile(px, py);
      if (!t) return;
      if (this.touchGhost && this.touchGhost.tx === t.tx && this.touchGhost.tz === t.tz) this.tryPlace(t.tx, t.tz);
      else this.touchGhost = t;
      return;
    }
    if (mode.rally) {
      this.setRallyAt(px, py);
      return;
    }
    const id = this.resolvePick(px, py, 26);
    const e = this.game.get(id);
    const now = performance.now();
    const dbl = id !== null && this.lastTap.id === id && now - this.lastTap.t < 400;
    this.lastTap = { t: now, id: id ?? -1 };
    const can = this.canCommand();
    if ((mode.attackMove || mode.forceMove || mode.guard) && can) {
      this.command(px, py, id);
      return;
    }
    if (e && e.team === 0) {
      const harv = this.selectedOwn().some((s) => s.type === "unit" && s.kind === "harvester");
      if (harv && e.type === "building" && e.kind === "refinery" && !this.game.selected.has(e.id)) {
        this.command(px, py, id);
        return;
      }
      if (dbl) this.selectSameType(e.id);
      else this.selectOnly(e.id);
      return;
    }
    if (e && e.team !== 0) {
      if (can && this.selectedOwn().some((s) => s.type === "unit")) this.command(px, py, id);
      else this.selectOnly(e.id);
      return;
    }
    if (can) this.command(px, py, null);
    else this.game.selected.clear();
  }

  // ------------------------------------------------------------ teclado

  private keyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    this.keys.add(e.key);
    const k = e.key.toLowerCase();
    if (e.key === "Escape") {
      const mode = this.hooks.getMode();
      if (mode.placing || mode.attackMove || mode.forceMove || mode.rally || mode.guard)
        this.hooks.setMode({ placing: null, attackMove: false, forceMove: false, rally: false, guard: false });
      else if (this.game.selected.size) this.game.selected.clear();
      else this.hooks.togglePause();
      return;
    }
    if (k === "p") {
      this.hooks.togglePause();
      return;
    }
    if (k === "s" && !e.ctrlKey && !e.metaKey) {
      this.orders.stop([...this.game.selected]);
      return;
    }
    if (k === "a" && !e.ctrlKey && !e.metaKey) {
      if (this.canCommand()) this.hooks.setMode({ attackMove: true, forceMove: false, guard: false });
      return;
    }
    if (k === "m" && !e.ctrlKey && !e.metaKey) {
      if (this.canCommand()) this.hooks.setMode({ forceMove: true, attackMove: false, guard: false });
      return;
    }
    if (k === "g" && !e.ctrlKey && !e.metaKey) {
      if (this.selectedOwn().some((s) => s.type === "unit" && s.kind !== "harvester"))
        this.hooks.setMode({ guard: !this.hooks.getMode().guard, attackMove: false, forceMove: false, rally: false, placing: null });
      return;
    }
    if (k === "d" && !e.ctrlKey && !e.metaKey) {
      if (this.rallyBuildings().length) this.hooks.setMode({ rally: !this.hooks.getMode().rally, attackMove: false, forceMove: false, placing: null });
      return;
    }
    if (k === "h") {
      this.centerBase();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      this.centerSelection();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(
          n,
          [...this.game.selected].filter((id) => this.game.units.get(id)?.team === 0),
        );
        this.hooks.sfx.ui();
      } else {
        const ids = (this.groups.get(n) ?? []).filter((id) => this.game.units.has(id));
        if (!ids.length) return;
        this.game.selected.clear();
        for (const id of ids) this.game.selected.add(id);
        const now = performance.now();
        if (this.lastGroupKey.n === n && now - this.lastGroupKey.t < 400) this.centerSelection();
        this.lastGroupKey = { n, t: now };
        this.hooks.sfx.ui();
      }
    }
  }

  centerBase() {
    for (const b of this.game.buildings.values()) {
      if (b.team === 0 && b.kind === "hq") {
        this.r.focus(b.tx + 1.5, b.tz + 2);
        return;
      }
    }
    for (const b of this.game.buildings.values()) if (b.team === 0) return this.r.focus(b.tx + b.w / 2, b.tz + b.h / 2);
  }

  centerSelection() {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const id of this.game.selected) {
      const e = this.game.get(id);
      if (!e) continue;
      const c = this.game.center(e);
      x += c.x;
      z += c.z;
      n++;
    }
    if (n) this.r.focus(x / n, z / n);
  }

  selectArmy() {
    this.game.selected.clear();
    for (const u of this.game.units.values()) if (u.team === 0 && u.kind !== "harvester") this.game.selected.add(u.id);
    this.hooks.sfx.ui();
  }

  // Chamado a cada quadro.
  update(dt: number) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("ArrowDown")) dy += 1;
    if (dx || dy) this.r.panPixels(-dx * 700 * dt, -dy * 700 * dt);

    if (this.hooks.getMode().rally && !this.rallyBuildings().length) this.hooks.setMode({ rally: false });
    if (this.hooks.getMode().guard && !this.selectedOwn().some((s) => s.type === "unit")) this.hooks.setMode({ guard: false });
    const kind = this.hooks.getMode().placing;
    if (!kind) {
      this.touchGhost = null;
      this.r.setGhost(null, 0, 0, false);
      const m = this.hooks.getMode();
      this.canvas.style.cursor = m.attackMove || m.rally || m.guard ? "crosshair" : m.forceMove ? "cell" : this.hoverCursor();
      return;
    }
    let t: { tx: number; tz: number } | null = null;
    if (this.touchGhost) t = this.touchGhost;
    else if (this.hover) t = this.ghostTile(this.hover.x, this.hover.y);
    if (!t) {
      const c = this.r.screenToWorld(this.r.renderer.domElement.clientWidth / 2, this.r.renderer.domElement.clientHeight / 2);
      if (c) {
        const d = BUILDINGS[kind];
        t = { tx: Math.floor(c.x - d.w / 2 + 0.5), tz: Math.floor(c.z - d.h / 2 + 0.5) };
      }
    }
    this.lastGhost = t;
    if (t) this.r.setGhost(kind, t.tx, t.tz, this.game.canPlace(0, kind, t.tx, t.tz));
    this.canvas.style.cursor = "copy";
  }

  private hoverCursor() {
    if (!this.hover) return "default";
    const id = this.r.pick(this.hover.x, this.hover.y, 10);
    const e = this.game.get(id);
    if (e && e.team !== 0 && this.canCommand()) return "crosshair";
    if (e) return "pointer";
    return "default";
  }
}
