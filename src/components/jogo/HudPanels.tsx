"use client";

import { Coins, Crosshair, House, Lock, OctagonX, Radar, SquareDashed, Star, Users, Wrench, X, Zap, BadgeDollarSign } from "lucide-react";
import type { Producer } from "@/lib/jogo/defs";
import type { HudSnapshot, ItemKind, ItemState, SelectionInfo } from "@/lib/jogo/hud";
import { cn } from "@/lib/utils";

export const TABS: { id: Producer; label: string }[] = [
  { id: "structure", label: "Base" },
  { id: "infantry", label: "Infantaria" },
  { id: "vehicle", label: "Veículos" },
  { id: "air", label: "Aéreo" },
];

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ------------------------------------------------------------ recursos

export function ResourceBar({ hud, compact }: { hud: HudSnapshot; compact?: boolean }) {
  const ratio = hud.powerProd > 0 ? Math.min(1, hud.powerUse / hud.powerProd) : 1;
  return (
    <div className={cn("flex items-center gap-2", compact ? "gap-2" : "gap-3")}>
      <div className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 ring-1 ring-amber-300/30">
        <Coins className="size-4 text-amber-300" />
        <span className="font-mono text-sm font-semibold tabular-nums text-amber-100">{hud.credits.toLocaleString("pt-BR")}</span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 ring-1",
          hud.lowPower ? "animate-pulse bg-red-500/20 ring-red-400/50" : "bg-sky-400/10 ring-sky-300/25",
        )}
        title={`Energia: ${hud.powerUse} usada de ${hud.powerProd}`}
      >
        <Zap className={cn("size-4", hud.lowPower ? "text-red-300" : "text-sky-300")} />
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn("h-full rounded-full", hud.lowPower ? "bg-red-400" : ratio > 0.8 ? "bg-amber-300" : "bg-emerald-400")}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <span className="font-mono text-xs tabular-nums text-white/70">
          {hud.powerUse}/{hud.powerProd}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ construção

export function Tabs({ tab, setTab, hud }: { tab: Producer; setTab: (p: Producer) => void; hud: HudSnapshot }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1">
      {TABS.map((t) => {
        const active = hud.items[t.id].some((i) => i.progress !== null || i.ready);
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative rounded-lg px-1 py-1.5 text-[11px] font-semibold transition",
              tab === t.id ? "bg-white/15 text-white shadow" : "text-white/55 hover:text-white/85",
            )}
          >
            {t.label}
            {active && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-400" />}
          </button>
        );
      })}
    </div>
  );
}

interface CardProps {
  item: ItemState;
  thumb?: string;
  placing: boolean;
  onClick: (k: ItemKind) => void;
  onCancel: (k: ItemKind) => void;
  small?: boolean;
}

export function BuildCard({ item, thumb, placing, onClick, onCancel, small }: CardProps) {
  const inProgress = item.progress !== null;
  const pct = inProgress ? Math.floor(item.progress! * 100) : 0;
  const busy = inProgress || item.queued > 0 || item.ready;
  return (
    <div className={cn("relative", small ? "w-[76px] shrink-0" : "")}>
      <button
        onClick={() => onClick(item.kind)}
        onContextMenu={(e) => {
          e.preventDefault();
          onCancel(item.kind);
        }}
        disabled={!item.available && !busy}
        title={item.available ? `${item.name} — $${item.cost}` : `Requer: ${item.requires}`}
        className={cn(
          "group relative flex w-full flex-col items-center overflow-hidden rounded-xl bg-gradient-to-b from-white/10 to-white/[0.03] ring-1 ring-white/10 transition",
          small ? "h-[86px] p-1" : "aspect-square p-1.5",
          item.available ? "hover:ring-sky-300/60 active:scale-95" : "cursor-not-allowed",
          item.ready && "ring-2 ring-emerald-300 shadow-[0_0_18px_rgba(110,255,170,0.35)]",
          placing && item.ready && "ring-amber-300",
        )}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" draggable={false} className={cn("pointer-events-none min-h-0 flex-1 object-contain", !item.available && "opacity-30 grayscale")} />
        ) : (
          <div className="flex-1" />
        )}
        <span className={cn("w-full truncate text-center font-semibold leading-tight", small ? "text-[10px]" : "text-[11px]", !item.available && "text-white/40")}>
          {item.name}
        </span>
        <span className={cn("font-mono text-[10px] text-amber-200/90", !item.available && "text-white/30")}>${item.cost}</span>
        {inProgress && (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl"
            style={{ background: `conic-gradient(rgba(10,14,24,0) ${pct}%, rgba(10,14,24,0.72) ${pct}% 100%)` }}
          >
            <span className="rounded-full bg-black/55 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
              {item.waiting ? "sem $" : `${pct}%`}
            </span>
          </div>
        )}
        {item.ready && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-emerald-400 py-0.5 text-center text-[10px] font-bold text-emerald-950">
            {placing ? "POSICIONANDO" : "PRONTO"}
          </div>
        )}
        {!item.available && !busy && (
          <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/50 p-1">
            <Lock className="size-3 text-white/60" />
          </div>
        )}
      </button>
      {item.queued > 1 && (
        <span className="pointer-events-none absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-sky-500 text-[10px] font-bold shadow">
          {item.queued}
        </span>
      )}
      {busy && (
        <button
          onClick={() => onCancel(item.kind)}
          aria-label={`Cancelar ${item.name}`}
          className="absolute -left-1 -top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white/80 ring-1 ring-white/20 hover:bg-red-500"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------ seleção

interface SelProps {
  sel: SelectionInfo;
  thumbs: Record<string, string>;
  onSell: (id: number) => void;
  onRepair: (id: number) => void;
  onPrimary: (id: number) => void;
  onStop: () => void;
  onClear: () => void;
  onSelectKind: (k: string) => void;
}

export function SelectionPanel({ sel, thumbs, onSell, onRepair, onPrimary, onStop, onClear, onSelectKind }: SelProps) {
  if (sel.type === "none") return null;
  if (sel.type === "multi") {
    return (
      <div className="rounded-2xl bg-black/35 p-2.5 ring-1 ring-white/10">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-white/80">{sel.total} selecionados</span>
          <div className="flex gap-1">
            <IconBtn label="Parar" onClick={onStop}>
              <OctagonX className="size-4" />
            </IconBtn>
            <IconBtn label="Limpar seleção" onClick={onClear}>
              <X className="size-4" />
            </IconBtn>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sel.groups.map((g) => (
            <button
              key={g.kind}
              onClick={() => onSelectKind(g.kind)}
              className="relative size-11 rounded-lg bg-white/5 ring-1 ring-white/10 hover:ring-sky-300/50"
              title="Selecionar só este tipo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumbs[g.kind] && <img src={thumbs[g.kind]} alt="" className="size-full object-contain" />}
              <span className="absolute -bottom-1 -right-1 rounded-full bg-sky-500 px-1.5 text-[10px] font-bold">{g.count}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const ratio = sel.hp / sel.maxHp;
  return (
    <div className="rounded-2xl bg-black/35 p-2.5 ring-1 ring-white/10">
      <div className="flex items-start gap-2.5">
        <div className={cn("size-12 shrink-0 rounded-xl ring-1", sel.own ? "bg-sky-500/15 ring-sky-300/30" : "bg-red-500/15 ring-red-300/30")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumbs[sel.kind] && <img src={thumbs[sel.kind]} alt="" className={cn("size-full object-contain", !sel.own && "hue-rotate-[150deg]")} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-sm font-bold">{sel.name}</span>
            <IconBtn label="Limpar seleção" onClick={onClear}>
              <X className="size-3.5" />
            </IconBtn>
          </div>
          <p className="truncate text-[11px] text-white/55">{sel.status}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn("h-full rounded-full", ratio > 0.6 ? "bg-emerald-400" : ratio > 0.3 ? "bg-amber-300" : "bg-red-400")}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-white/60">
              {sel.hp}/{sel.maxHp}
            </span>
          </div>
          {sel.cargo !== null && (
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-amber-300" style={{ width: `${(sel.cargo / 1000) * 100}%` }} />
              </div>
              <span className="font-mono text-[10px] text-amber-200/80">{sel.cargo}</span>
            </div>
          )}
        </div>
      </div>
      {sel.own && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sel.entity === "unit" && (
            <ActionChip onClick={onStop}>
              <OctagonX className="size-3.5" /> Parar
            </ActionChip>
          )}
          {sel.entity === "building" && sel.hp < sel.maxHp && (
            <ActionChip onClick={() => onRepair(sel.id)} active={sel.repairing}>
              <Wrench className="size-3.5" /> {sel.repairing ? "Reparando" : "Reparar"}
            </ActionChip>
          )}
          {sel.canPrimary && (
            <ActionChip onClick={() => onPrimary(sel.id)} active={sel.isPrimary}>
              <Star className="size-3.5" /> Principal
            </ActionChip>
          )}
          {sel.canSell && (
            <ActionChip onClick={() => onSell(sel.id)} danger>
              <BadgeDollarSign className="size-3.5" /> Vender
            </ActionChip>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-6 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

function ActionChip({ onClick, children, active, danger }: { onClick: () => void; children: React.ReactNode; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition active:scale-95",
        active ? "bg-emerald-400/25 text-emerald-100 ring-emerald-300/50" : danger ? "bg-red-500/10 text-red-100 ring-red-300/25 hover:bg-red-500/25" : "bg-white/8 text-white/90 ring-white/15 hover:bg-white/15",
      )}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------ barra de ações

interface ActionProps {
  hud: HudSnapshot;
  attackMove: boolean;
  boxMode: boolean;
  touch: boolean;
  onAttackMove: () => void;
  onBoxMode: () => void;
  onArmy: () => void;
  onStop: () => void;
  onHome: () => void;
  vertical?: boolean;
}

export function ActionBar({ hud, attackMove, boxMode, touch, onAttackMove, onBoxMode, onArmy, onStop, onHome, vertical }: ActionProps) {
  return (
    <div className={cn("flex gap-1.5 rounded-2xl bg-[#0d1322]/80 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur-md", vertical && "flex-col")}>
      {touch && (
        <FabBtn label="Seleção em área" active={boxMode} onClick={onBoxMode}>
          <SquareDashed className="size-5" />
        </FabBtn>
      )}
      <FabBtn label="Selecionar exército" onClick={onArmy}>
        <Users className="size-5" />
      </FabBtn>
      <FabBtn label="Atacar-mover (A)" active={attackMove} disabled={!hud.hasCommandable} onClick={onAttackMove}>
        <Crosshair className="size-5" />
      </FabBtn>
      <FabBtn label="Parar (S)" disabled={!hud.hasCommandable} onClick={onStop}>
        <OctagonX className="size-5" />
      </FabBtn>
      <FabBtn label="Ir para a base (H)" onClick={onHome}>
        <House className="size-5" />
      </FabBtn>
    </div>
  );
}

function FabBtn({ label, onClick, children, active, disabled }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-10 place-items-center rounded-xl transition active:scale-90",
        active ? "bg-amber-400 text-amber-950" : "bg-white/5 text-white/85 hover:bg-white/15",
        disabled && "opacity-35",
      )}
    >
      {children}
    </button>
  );
}

export function NoRadar() {
  return (
    <div className="grid size-full place-items-center rounded-xl bg-[radial-gradient(circle,rgba(56,189,248,0.08),transparent_70%)] text-center">
      <div className="flex flex-col items-center gap-1.5 text-white/40">
        <Radar className="size-6" />
        <span className="text-[11px] leading-tight">
          Sem radar
          <br />
          Construa um Radar
        </span>
      </div>
    </div>
  );
}
