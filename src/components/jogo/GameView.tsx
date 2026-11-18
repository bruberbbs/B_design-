"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapIcon, Menu, Pause } from "lucide-react";
import { AIController } from "@/lib/jogo/ai";
import { Sfx } from "@/lib/jogo/audio";
import { BUILDINGS, type Difficulty, type Producer } from "@/lib/jogo/defs";
import { Game } from "@/lib/jogo/game";
import { drawMinimap, minimapToWorld, snapshot, type HudSnapshot, type ItemKind } from "@/lib/jogo/hud";
import { InputController, type InputMode } from "@/lib/jogo/input";
import { GameRenderer } from "@/lib/jogo/render/scene";
import { renderThumbnails } from "@/lib/jogo/render/thumbnails";
import { cn } from "@/lib/utils";
import { ActionBar, BuildCard, NoRadar, ResourceBar, SelectionPanel, Tabs, formatTime } from "./HudPanels";
import { EndScreen, PauseMenu } from "./Overlays";

interface Engine {
  game: Game;
  ai: AIController;
  renderer: GameRenderer;
  input: InputController;
  sfx: Sfx;
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "warn" | "good";
  at: number;
}

const INITIAL_MODE: InputMode = { placing: null, attackMove: false, boxMode: false };
let toastId = 1;

export function GameView({ difficulty, onRestart, onMenu }: { difficulty: Difficulty; onRestart: () => void; onMenu: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const modeRef = useRef<InputMode>(INITIAL_MODE);
  const menuRef = useRef(false);
  const [mode, setModeState] = useState<InputMode>(INITIAL_MODE);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<Producer>("structure");
  const [sound, setSound] = useState(true);
  const [touch, setTouch] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMode = useCallback((patch: Partial<InputMode>) => {
    modeRef.current = { ...modeRef.current, ...patch };
    setModeState(modeRef.current);
  }, []);

  const openMenu = useCallback((open: boolean) => {
    const e = engineRef.current;
    if (e && e.game.phase === "playing") e.game.paused = open;
    menuRef.current = open;
    setMenu(open);
  }, []);

  const pushToast = useCallback((text: string, tone: Toast["tone"]) => {
    setToasts((prev) => [...prev.filter((t) => t.text !== text).slice(-3), { id: toastId++, text, tone, at: performance.now() }]);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const lowPower = coarse || window.innerWidth < 900;
    const game = new Game(difficulty);
    let renderer: GameRenderer;
    try {
      renderer = new GameRenderer(canvas, game, { lowPower });
    } catch {
      queueMicrotask(() => setError("Seu navegador não conseguiu iniciar o WebGL, necessário para o jogo."));
      return;
    }
    const sfx = new Sfx();
    const ai = new AIController(game, 1);
    const input = new InputController(canvas, game, renderer, {
      getMode: () => modeRef.current,
      setMode,
      setBox,
      togglePause: () => openMenu(!menuRef.current),
      sfx,
    });
    engineRef.current = { game, ai, renderer, input, sfx };
    if (process.env.NODE_ENV !== "production") (window as unknown as { __jogo?: Engine }).__jogo = engineRef.current;

    const resize = () => renderer.resize(wrap.clientWidth, wrap.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const near = (x: number, z: number) => {
      if (!game.isVisible(0, x, z)) return 0;
      const d = Math.hypot(x - renderer.target.x, z - renderer.target.z);
      return Math.max(0, Math.min(1, 1.15 - d / (renderer.viewHeight * 0.9)));
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      game.step(dt);
      ai.update(dt);
      input.update(dt);
      const events = game.drainEvents();
      renderer.handleEvents(events);
      sfx.handle(events, near);
      for (const ev of events) if (ev.type === "msg") pushToast(ev.text, ev.tone);
      renderer.render(game.paused || game.phase !== "playing" ? dt * 0.25 : dt * game.speed);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const hudTimer = window.setInterval(() => {
      setHud(snapshot(game));
      setToasts((prev) => (prev.length && performance.now() - prev[0].at > 4500 ? prev.slice(1) : prev));
    }, 120);

    const miniTimer = window.setInterval(() => {
      const root = rootRef.current;
      if (!root || !game.radarActive(0)) return;
      const corners = renderer.viewCorners();
      root.querySelectorAll<HTMLCanvasElement>("canvas[data-minimap]").forEach((c) => {
        if (!c.offsetParent) return;
        const size = c.clientWidth;
        const dpr = Math.min(2, window.devicePixelRatio);
        if (c.width !== Math.round(size * dpr)) {
          c.width = Math.round(size * dpr);
          c.height = Math.round(size * dpr);
        }
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMinimap(ctx, size, game, corners);
      });
    }, 200);

    const thumbTimer = window.setTimeout(() => {
      setTouch(coarse);
      setThumbs(renderThumbnails());
      pushToast("Construa usinas, uma refinaria e um exército. Destrua a base inimiga!", "info");
    }, 60);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(hudTimer);
      window.clearInterval(miniTimer);
      window.clearTimeout(thumbTimer);
      ro.disconnect();
      input.dispose();
      renderer.dispose();
      engineRef.current = null;
    };
  }, [difficulty, setMode, openMenu, pushToast]);

  // ------------------------------------------------------------ ações da interface

  const onItemClick = (kind: ItemKind) => {
    const e = engineRef.current;
    if (!e) return;
    e.sfx.unlock();
    const ts = e.game.teams[0];
    if (kind in BUILDINGS) {
      if (ts.ready === kind) {
        setMode({ placing: modeRef.current.placing ? null : (kind as keyof typeof BUILDINGS), attackMove: false });
        e.sfx.ui();
        return;
      }
      if (ts.ready || ts.queues.structure.length) {
        pushToast("Já há uma construção em andamento", "info");
        return;
      }
    }
    if (e.game.queueProduction(0, kind)) e.sfx.ui();
  };

  const onItemCancel = (kind: ItemKind) => {
    const e = engineRef.current;
    if (!e) return;
    if (e.game.cancelProduction(0, kind)) {
      e.sfx.ui();
      if (modeRef.current.placing === kind) setMode({ placing: null });
    }
  };

  const withEngine = (fn: (e: Engine) => void) => () => {
    const e = engineRef.current;
    if (e) {
      e.sfx.unlock();
      fn(e);
    }
  };

  const ownSelectedUnits = (e: Engine) => [...e.game.selected].filter((id) => e.game.units.get(id)?.team === 0);

  const actions = {
    onSell: (id: number) => withEngine((e) => e.game.sell(id))(),
    onRepair: (id: number) => withEngine((e) => e.game.toggleRepair(id))(),
    onPrimary: (id: number) =>
      withEngine((e) => {
        const b = e.game.buildings.get(id);
        if (b) e.game.primary[b.kind === "barracks" ? "infantry" : "vehicle"] = id;
      })(),
    onStop: withEngine((e) => e.game.issueStop(ownSelectedUnits(e))),
    onClear: withEngine((e) => e.game.selected.clear()),
    onSelectKind: (k: string) =>
      withEngine((e) => {
        for (const id of [...e.game.selected]) if (e.game.units.get(id)?.kind !== k) e.game.selected.delete(id);
      })(),
  };

  const bar = {
    onAttackMove: () => setMode({ attackMove: !modeRef.current.attackMove, placing: null }),
    onBoxMode: () => setMode({ boxMode: !modeRef.current.boxMode }),
    onArmy: withEngine((e) => e.input.selectArmy()),
    onStop: actions.onStop,
    onHome: withEngine((e) => e.input.centerBase()),
  };

  const onMinimap = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const e = engineRef.current;
    if (!e || !e.game.radarActive(0)) return;
    if (ev.type === "pointermove" && ev.buttons === 0) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const p = minimapToWorld(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, e.game);
    e.renderer.focus(p.x, p.z);
  };

  const toggleSound = () => {
    const e = engineRef.current;
    const next = !sound;
    if (e) e.sfx.enabled = next;
    setSound(next);
  };

  const setSpeed = (s: number) => {
    const e = engineRef.current;
    if (e) e.game.speed = s;
  };

  if (error) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-[#0a0e18] p-6 text-center text-white">
        <div>
          <p className="mb-4 text-white/80">{error}</p>
          <button onClick={onMenu} className="rounded-xl bg-sky-500 px-5 py-2.5 font-semibold">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const items = hud?.items[tab] ?? [];
  const placingName = mode.placing ? BUILDINGS[mode.placing].name : "";

  return (
    <div ref={rootRef} className="fixed inset-0 flex select-none flex-col overflow-hidden bg-[#0a0e18] text-white lg:flex-row">
      {/* área do jogo */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none outline-none" />

        {box && (
          <div
            className="pointer-events-none absolute rounded-sm border border-emerald-300/90 bg-emerald-300/10"
            style={{
              left: Math.min(box.x0, box.x1),
              top: Math.min(box.y0, box.y1),
              width: Math.abs(box.x1 - box.x0),
              height: Math.abs(box.y1 - box.y0),
            }}
          />
        )}

        {/* barra superior (celular) */}
        {hud && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
            <div className="pointer-events-auto rounded-2xl bg-[#0d1322]/80 p-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
              <ResourceBar hud={hud} compact />
            </div>
            <div className="pointer-events-auto flex gap-1.5">
              <button
                onClick={() => setMiniOpen((v) => !v)}
                aria-label="Minimapa"
                className={cn("grid size-10 place-items-center rounded-xl ring-1 ring-white/10 backdrop-blur-md", miniOpen ? "bg-sky-500" : "bg-[#0d1322]/80")}
              >
                <MapIcon className="size-5" />
              </button>
              <button onClick={() => openMenu(true)} aria-label="Menu" className="grid size-10 place-items-center rounded-xl bg-[#0d1322]/80 ring-1 ring-white/10 backdrop-blur-md">
                <Menu className="size-5" />
              </button>
            </div>
          </div>
        )}

        {/* minimapa (celular) */}
        {hud && miniOpen && (
          <div className="absolute right-2 top-[calc(max(0.5rem,env(safe-area-inset-top))+3rem)] size-40 rounded-2xl bg-[#0d1322]/85 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur-md lg:hidden">
            {hud.radar ? (
              <canvas data-minimap className="size-full touch-none rounded-xl" onPointerDown={onMinimap} onPointerMove={onMinimap} />
            ) : (
              <NoRadar />
            )}
          </div>
        )}

        {/* avisos */}
        <div className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center gap-1.5 px-4 lg:top-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "animate-in fade-in slide-in-from-top-2 rounded-full px-4 py-1.5 text-center text-xs font-semibold shadow-lg ring-1 backdrop-blur-md sm:text-sm",
                t.tone === "warn" && "bg-red-500/25 text-red-50 ring-red-300/40",
                t.tone === "good" && "bg-emerald-500/20 text-emerald-50 ring-emerald-300/40",
                t.tone === "info" && "bg-[#0d1322]/80 text-white/90 ring-white/15",
              )}
            >
              {t.text}
            </div>
          ))}
        </div>

        {/* modo de posicionamento / ataque */}
        {mode.placing && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div className="flex items-center gap-2 rounded-2xl bg-[#0d1322]/90 p-1.5 pl-4 shadow-xl ring-1 ring-amber-300/40 backdrop-blur-md">
              <span className="text-xs text-white/85 sm:text-sm">
                Posicione: <b>{placingName}</b>
                <span className="hidden text-white/50 sm:inline"> {touch ? "· toque no mapa" : "· clique no mapa, botão direito cancela"}</span>
              </span>
              {touch && (
                <button onClick={() => engineRef.current?.input.placeGhost()} className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-bold text-emerald-950">
                  Confirmar
                </button>
              )}
              <button onClick={() => setMode({ placing: null })} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {mode.attackMove && !mode.placing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="rounded-full bg-amber-400/90 px-4 py-1.5 text-xs font-bold text-amber-950 shadow-lg">
              Atacar-mover: {touch ? "toque" : "clique"} no destino
            </div>
          </div>
        )}
        {hud?.paused && !menu && hud.phase === "playing" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-2 rounded-2xl bg-black/60 px-5 py-3 text-lg font-bold">
              <Pause className="size-5" /> Pausado
            </div>
          </div>
        )}

        {/* ações rápidas */}
        {hud && (
          <div className={cn("absolute", touch ? "right-2 top-1/2 -translate-y-1/2" : "bottom-3 left-3", mode.placing && !touch && "hidden")}>
            <ActionBar hud={hud} attackMove={mode.attackMove} boxMode={mode.boxMode} touch={touch} vertical={touch} {...bar} />
          </div>
        )}

        {/* seleção (celular) */}
        {hud && hud.selection.type !== "none" && !mode.placing && (
          <div className="absolute bottom-2 left-2 w-[min(78vw,320px)] lg:hidden">
            <div className="rounded-2xl bg-[#0d1322]/80 shadow-xl backdrop-blur-md">
              <SelectionPanel sel={hud.selection} thumbs={thumbs} {...actions} />
            </div>
          </div>
        )}
      </div>

      {/* painel inferior (celular) */}
      {hud && (
        <div className="shrink-0 border-t border-white/10 bg-[#0d1322] pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="px-2 pt-2">
            <Tabs tab={tab} setTab={setTab} hud={hud} />
          </div>
          <div className="flex gap-2 overflow-x-auto px-2 py-2.5 [scrollbar-width:none]">
            {items.map((it) => (
              <BuildCard key={it.kind} item={it} thumb={thumbs[it.kind]} placing={mode.placing === it.kind} onClick={onItemClick} onCancel={onItemCancel} small />
            ))}
          </div>
        </div>
      )}

      {/* barra lateral (computador) */}
      {hud && (
        <aside className="hidden w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-gradient-to-b from-[#111a2e] to-[#0b1120] p-3 lg:flex">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-black tracking-[0.18em] text-white">MARÉ DE AÇO</h1>
              <p className="font-mono text-[11px] text-white/45">{formatTime(hud.time)}</p>
            </div>
            <button onClick={() => openMenu(true)} className="flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/15">
              <Menu className="size-4" /> Menu
            </button>
          </div>
          <ResourceBar hud={hud} />
          <div className="aspect-square w-full rounded-2xl bg-black/40 p-1.5 ring-1 ring-white/10">
            {hud.radar ? <canvas data-minimap className="size-full cursor-pointer rounded-xl" onPointerDown={onMinimap} onPointerMove={onMinimap} /> : <NoRadar />}
          </div>
          <Tabs tab={tab} setTab={setTab} hud={hud} />
          <div className="grid grid-cols-3 gap-2">
            {items.map((it) => (
              <BuildCard key={it.kind} item={it} thumb={thumbs[it.kind]} placing={mode.placing === it.kind} onClick={onItemClick} onCancel={onItemCancel} />
            ))}
          </div>
          <div className="mt-auto">
            <SelectionPanel sel={hud.selection} thumbs={thumbs} {...actions} />
          </div>
          <p className="text-[10px] leading-relaxed text-white/35">
            Esquerdo: selecionar · Direito: mover/atacar · Arraste: seleção em área · Roda: zoom · Setas ou arrastar com o direito: câmera · A: atacar-mover · S: parar · Ctrl+1–9: grupos
          </p>
        </aside>
      )}

      {menu && hud && (
        <PauseMenu
          speed={hud.speed}
          sound={sound}
          onSpeed={setSpeed}
          onSound={toggleSound}
          onResume={() => openMenu(false)}
          onRestart={onRestart}
          onQuit={onMenu}
        />
      )}
      {hud && hud.phase !== "playing" && <EndScreen hud={hud} onRestart={onRestart} onMenu={onMenu} />}
    </div>
  );
}
