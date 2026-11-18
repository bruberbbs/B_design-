"use client";

import { useState } from "react";
import { Play, RotateCcw, Skull, Swords, Trophy, Volume2, VolumeX, House, ChevronDown } from "lucide-react";
import { DIFFICULTY, TEAM_COLORS, type Difficulty } from "@/lib/jogo/defs";
import type { HudSnapshot } from "@/lib/jogo/hud";
import { cn } from "@/lib/utils";
import { formatTime } from "./HudPanels";

export function StartScreen({ onStart }: { onStart: (d: Difficulty) => void }) {
  const [diff, setDiff] = useState<Difficulty>("normal");
  const [help, setHelp] = useState(false);
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0e18] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-10 size-[28rem] rounded-full bg-sky-500/25 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-[30rem] rounded-full bg-red-500/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 size-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/10 blur-3xl" />
      </div>
      <div className="relative mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-5 py-10 text-center">
        <div className="mb-5 flex items-center gap-3">
          <span className="size-4 rounded-full shadow-[0_0_20px_currentColor]" style={{ color: TEAM_COLORS[0].main, background: TEAM_COLORS[0].main }} />
          <Swords className="size-7 text-white/70" />
          <span className="size-4 rounded-full shadow-[0_0_20px_currentColor]" style={{ color: TEAM_COLORS[1].main, background: TEAM_COLORS[1].main }} />
        </div>
        <h1 className="bg-gradient-to-b from-white to-sky-200 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-6xl">Maré de Aço</h1>
        <p className="mt-3 max-w-md text-balance text-sm text-white/65 sm:text-base">
          Estratégia em tempo real. Comande a <b className="text-sky-300">{TEAM_COLORS[0].name}</b>, colete cristais, erga sua base e derrote a{" "}
          <b className="text-red-300">{TEAM_COLORS[1].name}</b>.
        </p>

        <div className="mt-8 w-full max-w-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/45">Dificuldade</p>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-white/5 p-1.5 ring-1 ring-white/10">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => setDiff(d)}
                className={cn("rounded-xl py-2.5 text-sm font-semibold transition", diff === d ? "bg-white text-[#0a0e18] shadow" : "text-white/70 hover:bg-white/10")}
              >
                {DIFFICULTY[d].label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onStart(diff)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-sky-400 to-sky-600 py-4 text-lg font-bold shadow-[0_10px_40px_-10px_rgba(56,189,248,0.7)] ring-1 ring-sky-300/50 transition hover:brightness-110 active:scale-[0.98]"
          >
            <Play className="size-5 fill-current" /> Iniciar batalha
          </button>
        </div>

        <button onClick={() => setHelp((v) => !v)} className="mt-8 flex items-center gap-1 text-sm font-semibold text-white/60 hover:text-white">
          Como jogar <ChevronDown className={cn("size-4 transition", help && "rotate-180")} />
        </button>
        {help && (
          <div className="mt-3 grid w-full gap-3 text-left text-sm sm:grid-cols-2">
            <HelpCard title="Objetivo">
              Destrua todas as construções inimigas. Se você perder todas as suas, a batalha acaba.
            </HelpCard>
            <HelpCard title="Economia">
              Usinas geram energia. A Refinaria traz um Coletor que busca cristais dourados e os transforma em créditos. Energia baixa deixa tudo lento e
              desliga torres e radar.
            </HelpCard>
            <HelpCard title="Aeronaves">
              O Heliporto (requer Radar) produz Drones Vigia e Helicópteros Colibri, que voam por cima de rios e árvores. Só Torres Antiaéreas,
              Fuzileiros, Lança-mísseis, Batedores e Drones conseguem atingi-los — tanques e artilharia não.
            </HelpCard>
            <HelpCard title="Mouse e teclado">
              Esquerdo seleciona (arraste para área, duplo clique pega o mesmo tipo). Direito move, ataca ou coleta. Roda: zoom. Setas ou arrastar com o
              direito: câmera. A: atacar-mover, S: parar, H: base, Ctrl+1–9: grupos, Esc: menu.
            </HelpCard>
            <HelpCard title="Toque">
              Toque numa unidade para selecionar e toque no mapa para mover ou atacar. Arraste para mover a câmera e use pinça para zoom. O botão de
              seleção em área permite arrastar um retângulo.
            </HelpCard>
          </div>
        )}
      </div>
    </div>
  );
}

function HelpCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h3 className="mb-1 font-bold text-white">{title}</h3>
      <p className="text-white/60">{children}</p>
    </div>
  );
}

interface PauseProps {
  speed: number;
  sound: boolean;
  onSpeed: (s: number) => void;
  onSound: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

export function PauseMenu({ speed, sound, onSpeed, onSound, onResume, onRestart, onQuit }: PauseProps) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={onResume}>
      <div className="w-full max-w-xs rounded-3xl bg-[#111a2e] p-5 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-center text-xl font-black">Pausado</h2>
        <button onClick={onResume} className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3 font-bold hover:bg-sky-400">
          <Play className="size-4 fill-current" /> Continuar
        </button>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/45">Velocidade</p>
        <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-black/30 p-1">
          {[1, 1.5, 2].map((s) => (
            <button key={s} onClick={() => onSpeed(s)} className={cn("rounded-xl py-2 text-sm font-semibold", speed === s ? "bg-white text-[#0a0e18]" : "text-white/70")}>
              {s}×
            </button>
          ))}
        </div>
        <button onClick={onSound} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15">
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Som {sound ? "ligado" : "desligado"}
        </button>
        <button onClick={onRestart} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15">
          <RotateCcw className="size-4" /> Reiniciar
        </button>
        <button onClick={onQuit} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15">
          <House className="size-4" /> Menu principal
        </button>
      </div>
    </div>
  );
}

export function EndScreen({ hud, onRestart, onMenu }: { hud: HudSnapshot; onRestart: () => void; onMenu: () => void }) {
  const win = hud.phase === "victory";
  const stats: [string, string][] = [
    ["Duração", formatTime(hud.time)],
    ["Unidades produzidas", String(hud.stats.built)],
    ["Construções erguidas", String(hud.stats.structures)],
    ["Abates", String(hud.stats.kills)],
    ["Unidades perdidas", String(hud.stats.lost)],
    ["Créditos coletados", Math.round(hud.stats.harvested).toLocaleString("pt-BR")],
  ];
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="animate-in zoom-in-95 fade-in w-full max-w-sm rounded-3xl bg-[#111a2e] p-6 text-center shadow-2xl ring-1 ring-white/10 duration-500">
        <div className={cn("mx-auto mb-3 grid size-16 place-items-center rounded-full", win ? "bg-amber-300/20 text-amber-300" : "bg-red-500/20 text-red-300")}>
          {win ? <Trophy className="size-8" /> : <Skull className="size-8" />}
        </div>
        <h2 className="text-3xl font-black">{win ? "Vitória!" : "Derrota"}</h2>
        <p className="mt-1 text-sm text-white/60">{win ? "A Legião Escarlate foi varrida do mapa." : "Nossa última estrutura caiu. Reagrupe e tente de novo."}</p>
        <dl className="mt-5 grid grid-cols-2 gap-2 text-left">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
              <dt className="text-[11px] text-white/50">{k}</dt>
              <dd className="font-mono text-lg font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onMenu} className="rounded-2xl bg-white/10 py-3 font-semibold hover:bg-white/15">
            Menu
          </button>
          <button onClick={onRestart} className="rounded-2xl bg-sky-500 py-3 font-bold hover:bg-sky-400">
            Jogar de novo
          </button>
        </div>
      </div>
    </div>
  );
}
