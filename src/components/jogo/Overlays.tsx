"use client";

import { useMemo, useState } from "react";
import { Play, RotateCcw, Skull, Swords, Trophy, Volume2, VolumeX, House, ChevronDown, Music2, Bot, Wifi, LogIn } from "lucide-react";
import { DIFFICULTY, FACTIONS, type Difficulty, type Faction } from "@/lib/jogo/defs";
import { mapPreviews, type HudSnapshot } from "@/lib/jogo/hud";
import { MAPS, type MapId } from "@/lib/jogo/map";
import { normalizeCode } from "@/lib/jogo/net/room";
import { cn } from "@/lib/utils";
import { formatTime } from "./HudPanels";

interface StartProps {
  onStart: (d: Difficulty, f: Faction, m: MapId) => void;
  onHost: (f: Faction, m: MapId) => void;
  onJoin: (code: string) => void;
}

// Builds sem acesso a WebRTC (ex.: prévia embutida) desligam o modo em rede.
const NET_OFF = process.env.NEXT_PUBLIC_NET_DISABLED === "1";

export function StartScreen({ onStart, onHost, onJoin }: StartProps) {
  const [mode, setMode] = useState<"solo" | "online">("solo");
  const [code, setCode] = useState("");
  const [diff, setDiff] = useState<Difficulty>("normal");
  const [faction, setFaction] = useState<Faction>("aurora");
  const [mapId, setMapId] = useState<MapId>("vale");
  const previews = useMemo(() => mapPreviews(), []);
  const [help, setHelp] = useState(false);
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0e18] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-10 size-[28rem] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-[30rem] rounded-full bg-red-500/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 size-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/10 blur-3xl" />
      </div>
      <div className="relative mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-5 py-10 text-center">
        <div className="mb-5 flex items-center gap-3">
          <span className="size-4 rounded-full shadow-[0_0_20px_currentColor]" style={{ color: FACTIONS.aurora.main, background: FACTIONS.aurora.main }} />
          <Swords className="size-7 text-white/70" />
          <span className="size-4 rounded-full shadow-[0_0_20px_currentColor]" style={{ color: FACTIONS.escarlate.main, background: FACTIONS.escarlate.main }} />
        </div>
        <h1 className="bg-gradient-to-b from-white to-sky-200 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-6xl">Force One</h1>
        <p className="mt-3 max-w-md text-balance text-sm text-white/65 sm:text-base">
          Estratégia em tempo real. Escolha sua facção, colete cristais, erga sua base e derrote o exército rival.
        </p>

        <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-1.5 rounded-2xl bg-white/5 p-1.5 ring-1 ring-white/10">
          {(
            [
              ["solo", "Contra a IA", Bot],
              ["online", "Em rede", Wifi],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition",
                mode === id ? "bg-white text-[#0a0e18] shadow" : "text-white/70 hover:bg-white/10",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {mode === "online" && (
          <p className="mt-3 max-w-sm text-xs text-white/55">
            Dois aparelhos, um contra o outro. Quem cria a sala escolhe o mapa e a facção; o adversário fica com a outra facção.
          </p>
        )}

        <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
          {(Object.keys(FACTIONS) as Faction[]).map((f) => {
            const info = FACTIONS[f];
            const active = faction === f;
            return (
              <button
                key={f}
                onClick={() => setFaction(f)}
                aria-pressed={active}
                className={cn(
                  "rounded-2xl p-4 text-left ring-1 transition",
                  active ? "bg-white/10 ring-2" : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.07]",
                )}
                style={active ? { boxShadow: `0 0 0 2px ${info.main}, 0 12px 40px -12px ${info.main}` } : undefined}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: info.main }} />
                  <span className="font-bold">{info.name}</span>
                </div>
                <p className="mb-2 text-xs text-white/60">{info.motto}</p>
                <ul className="space-y-0.5 text-[11px] text-white/50">
                  {info.traits.map((t) => (
                    <li key={t}>• {t}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-widest text-white/45">Mapa</p>
        <div className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4">
          {MAPS.map((m) => {
            const active = mapId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMapId(m.id)}
                aria-pressed={active}
                title={m.desc}
                className={cn(
                  "flex flex-col items-center rounded-2xl p-2 text-center ring-1 transition",
                  active ? "bg-white/12 ring-2 ring-white/80" : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.07]",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[m.id]} alt="" className="aspect-square w-full max-w-[120px] [image-rendering:pixelated]" />
                <span className="mt-1 text-xs font-bold leading-tight">{m.name}</span>
                <span className="mt-0.5 text-[10px] leading-snug text-white/50">{m.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 w-full max-w-sm">
          {mode === "solo" ? (
            <>
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
            onClick={() => onStart(diff, faction, mapId)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold ring-1 ring-white/25 transition hover:brightness-110 active:scale-[0.98]"
            style={{
              background: `linear-gradient(to bottom, ${FACTIONS[faction].main}, ${FACTIONS[faction].dark})`,
              boxShadow: `0 10px 40px -10px ${FACTIONS[faction].main}`,
            }}
          >
            <Play className="size-5 fill-current" /> Iniciar batalha
          </button>
            </>
          ) : NET_OFF ? (
            <p className="rounded-2xl bg-white/5 p-4 text-sm text-white/70 ring-1 ring-white/10">
              O jogo em rede não funciona nesta versão de prévia. Abra a versão hospedada do Force One para jogar contra outro aparelho.
            </p>
          ) : (
            <>
              <button
                onClick={() => onHost(faction, mapId)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold ring-1 ring-white/25 transition hover:brightness-110 active:scale-[0.98]"
                style={{
                  background: `linear-gradient(to bottom, ${FACTIONS[faction].main}, ${FACTIONS[faction].dark})`,
                  boxShadow: `0 10px 40px -10px ${FACTIONS[faction].main}`,
                }}
              >
                <Wifi className="size-5" /> Criar sala
              </button>
              <div className="my-4 flex items-center gap-3 text-xs text-white/40">
                <span className="h-px flex-1 bg-white/10" /> ou entre na sala de alguém <span className="h-px flex-1 bg-white/10" />
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === 4) onJoin(code);
                }}
              >
                <input
                  value={code}
                  onChange={(e) => setCode(normalizeCode(e.target.value))}
                  placeholder="CÓDIGO"
                  aria-label="Código da sala"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-2xl bg-white/5 px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.3em] text-white outline-none ring-1 ring-white/15 placeholder:text-base placeholder:tracking-widest placeholder:text-white/25 focus:ring-2 focus:ring-sky-400"
                />
                <button
                  type="submit"
                  disabled={code.length !== 4}
                  className="flex items-center gap-1.5 rounded-2xl bg-white px-5 font-bold text-[#0a0e18] transition disabled:opacity-30"
                >
                  <LogIn className="size-4" /> Entrar
                </button>
              </form>
            </>
          )}
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
            <HelpCard title="Facções">
              A Coalizão Aurora aposta em mobilidade e precisão (Vespa, Lumen, Morteiro, Colibri, Torre de Defesa). A Legião Escarlate aposta em
              blindagem e fogo (Titã, Javali, Tempestade, Lança-chamas, Tufão, Torre Inferno). Construções básicas, Coletor, Fuzileiro, Lança-mísseis,
              Drone e Torre Antiaérea são comuns às duas.
            </HelpCard>
            <HelpCard title="Aeronaves">
              O Heliporto (requer Radar) produz Drones e helicópteros, que voam por cima de rios e árvores. Só Torres Antiaéreas, Fuzileiros,
              Lança-mísseis, Batedores, Javalis e Drones conseguem atingi-los — tanques, artilharia e torres terrestres não.
            </HelpCard>
            <HelpCard title="Defesa automática">
              Tropas atacadas revidam sozinhas e chamam as companheiras por perto. Em movimento normal, elas param para lutar e depois seguem até o
              destino. Use “Mover” quando quiser passar sem parar para lutar.
            </HelpCard>
            <HelpCard title="Mouse e teclado">
              Esquerdo seleciona (arraste no vazio para área, duplo clique pega o mesmo tipo). Com tropas selecionadas, clique no chão para mover e
              num inimigo para atacar, ou arraste a tropa até o destino. Esc desmarca. Roda: zoom. Setas ou arrastar com o direito: câmera. M: mover
              sem lutar, A: atacar, S: parar, H: base, Ctrl+1–9: grupos.
            </HelpCard>
            <HelpCard title="Toque">
              Toque numa unidade para selecionar e toque no mapa para mover ou atacar, ou arraste a tropa até o destino (soltar sobre um inimigo ataca). Os botões Mover, Atacar e Parar aparecem na seleção. Arraste para mover a câmera e use pinça para zoom. O botão de
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
  online?: boolean;
  quality: "max" | "balanced" | "low";
  onQuality: (q: "max" | "balanced" | "low") => void;
  sound: boolean;
  music: boolean;
  onSpeed: (s: number) => void;
  onSound: () => void;
  onMusic: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

export function PauseMenu({ speed, online, quality, onQuality, sound, music, onSpeed, onSound, onMusic, onResume, onRestart, onQuit }: PauseProps) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={onResume}>
      <div className="w-full max-w-xs rounded-3xl bg-[#111a2e] p-5 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-center text-xl font-black">{online ? "Menu" : "Pausado"}</h2>
        {online && <p className="-mt-2 mb-3 text-center text-xs text-white/50">Em rede a partida continua rodando.</p>}
        <button onClick={onResume} className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3 font-bold hover:bg-sky-400">
          <Play className="size-4 fill-current" /> Continuar
        </button>
        {!online && (
          <>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/45">Velocidade</p>
            <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-black/30 p-1">
              {[1, 1.5, 2].map((s) => (
                <button key={s} onClick={() => onSpeed(s)} className={cn("rounded-xl py-2 text-sm font-semibold", speed === s ? "bg-white text-[#0a0e18]" : "text-white/70")}>
                  {s}×
                </button>
              ))}
            </div>
          </>
        )}
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/45">Gráficos</p>
        <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-black/30 p-1">
          {(
            [
              ["max", "Máxima"],
              ["balanced", "Equilibrada"],
              ["low", "Leve"],
            ] as const
          ).map(([q, label]) => (
            <button
              key={q}
              onClick={() => onQuality(q)}
              aria-pressed={quality === q}
              className={cn("rounded-xl py-2 text-xs font-semibold", quality === q ? "bg-white text-[#0a0e18]" : "text-white/70")}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={onSound} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15">
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Efeitos {sound ? "ligados" : "desligados"}
        </button>
        <button
          onClick={onMusic}
          className={cn(
            "mb-2 flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15",
            music ? "bg-white/8" : "bg-white/[0.03] text-white/50",
          )}
        >
          <Music2 className="size-4" /> Música {music ? "ligada" : "desligada"}
        </button>
        {!online && (
          <button onClick={onRestart} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15">
            <RotateCcw className="size-4" /> Reiniciar
          </button>
        )}
        <button onClick={onQuit} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/8 py-2.5 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15">
          <House className="size-4" /> {online ? "Sair da partida" : "Menu principal"}
        </button>
      </div>
    </div>
  );
}

export function EndScreen({ hud, online, onRestart, onMenu }: { hud: HudSnapshot; online?: boolean; onRestart: () => void; onMenu: () => void }) {
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
        <p className="mt-1 text-sm text-white/60">{win ? `A ${hud.enemyName} foi varrida do mapa.` : "Nossa última estrutura caiu. Reagrupe e tente de novo."}</p>
        <dl className="mt-5 grid grid-cols-2 gap-2 text-left">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
              <dt className="text-[11px] text-white/50">{k}</dt>
              <dd className="font-mono text-lg font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className={cn("mt-5 grid gap-2", online ? "grid-cols-1" : "grid-cols-2")}>
          <button onClick={onMenu} className={cn("rounded-2xl py-3 font-semibold", online ? "bg-sky-500 font-bold hover:bg-sky-400" : "bg-white/10 hover:bg-white/15")}>
            Menu
          </button>
          {!online && (
            <button onClick={onRestart} className="rounded-2xl bg-sky-500 py-3 font-bold hover:bg-sky-400">
              Jogar de novo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
