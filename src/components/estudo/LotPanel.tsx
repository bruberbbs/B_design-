"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Printer, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt, terrainInfo, type Lot } from "@/lib/estudo/city";
import {
  DATES,
  daylight,
  facadeSunHours,
  formatHour,
  sunPosition,
  type StudyParams,
  type StudyResult,
  type Uso,
} from "@/lib/estudo/study";
import type { SavedStudy, SunState } from "./types";

type Tab = "resumo" | "zoneamento" | "massa" | "unidades" | "solar";

interface Props {
  lots: Lot[];
  result: StudyResult;
  params: StudyParams;
  onParams: (p: StudyParams) => void;
  sun: SunState;
  onSun: (s: SunState) => void;
  saved: SavedStudy | null;
  onSave: (nome: string) => void;
  onPrint: () => void;
  onRemoveLot: (id: string) => void;
}

export function LotPanel(props: Props) {
  const { lots, result, sun } = props;
  const [tab, setTab] = useState<Tab>("resumo");

  const tabs: { id: Tab; label: string; sub: string }[] = [
    { id: "resumo", label: "Resumo", sub: `${m2(result.totalConstruido)} · IA ${fmt(result.iaUtilizado, 2)}` },
    { id: "zoneamento", label: "Zoneamento", sub: result.zone.id },
    { id: "massa", label: "Estudo de massa", sub: `${result.pavimentos} pav. · ${fmt(result.altura, 1)} m` },
    {
      id: "unidades",
      label: "Unidades",
      sub: `${result.unidades} unid. · ${result.salas} salas`,
    },
    { id: "solar", label: "Análise solar", sub: sun.enabled ? formatHour(sun.hour) : "sombras" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {lots.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {lots.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-1 pl-2.5 text-xs text-neutral-700">
              {l.inscricao}
              <button
                type="button"
                aria-label={`Remover lote ${l.inscricao}`}
                onClick={() => props.onRemoveLot(l.id)}
                className="rounded-full p-0.5 hover:bg-neutral-200"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-neutral-200 px-4 [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-2 pt-1 pb-2 text-left transition-colors",
              tab === t.id ? "border-[#1f5a46] text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800",
            )}
          >
            <span className="block text-[13px] font-medium">{t.label}</span>
            <span className="block text-[11px] text-neutral-500">{t.sub}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {result.avisos.length > 0 && (
          <div className="mb-4 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {result.avisos.map((a) => (
              <p key={a} className="flex gap-2">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                {a}
              </p>
            ))}
          </div>
        )}
        {tab === "resumo" && <Resumo {...props} />}
        {tab === "zoneamento" && <Zoneamento result={result} />}
        {tab === "massa" && <Massa {...props} />}
        {tab === "unidades" && <Unidades {...props} />}
        {tab === "solar" && <Solar sun={props.sun} onSun={props.onSun} />}
      </div>
    </div>
  );
}

export function m2(n: number) {
  return `${Math.round(n).toLocaleString("pt-BR")} m²`;
}

function SectionTag({ children, right }: { children: React.ReactNode; right?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-md bg-[#e8efe9] px-2.5 py-1.5">
      <span className="text-[10px] font-semibold tracking-wider text-[#1f5a46] uppercase">{children}</span>
      {right && <span className="text-[10px] text-neutral-500">{right}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-neutral-600">{label}</span>
      <span className="text-right text-neutral-900 tabular-nums">{value}</span>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className={cn("px-3 py-3", highlight ? "bg-[#e8efe9]" : "bg-white")}>
      <div className="text-xl font-medium text-neutral-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}

function Resumo({ lots, result, saved, onSave, onPrint }: Props) {
  const lot = lots[0];
  const t = useMemo(() => terrainInfo(lot), [lot]);
  const [nome, setNome] = useState(saved?.nome ?? `Estudo ${lot.inscricao}`);

  return (
    <div>
      <SectionTag right="lote">Dados do terreno</SectionTag>
      <div className="divide-y divide-neutral-100">
        <Row label="Área do lote" value={m2(result.areaLote)} />
        {lots.length === 1 && (
          <>
            <Row label="Testada · profundidade" value={`${fmt(lot.testada, 1)} m · ${fmt(lot.profundidade, 1)} m`} />
            <Row label="Cotas do terreno" value={`${fmt(t.cotaMin, 1)} a ${fmt(t.cotaMax, 1)} m`} />
            <Row label="Desnível" value={`${fmt(t.desnivel, 1)} m`} />
            <Row label="Declividade média" value={`${fmt(t.declividadeMedia, 1)}%`} />
            <Row label="Cota da frente (meio da testada)" value={`${fmt(t.cotaFrente, 1)} m`} />
            <Row label="Térreo" value={t.terreo} />
            <Row label="Declividade" value={t.faixaDeclividade} />
          </>
        )}
        <Row label="Frente para" value={`${lot.frontStreet.name} · ${lot.frontStreet.kind}`} />
        <Row label="Zona" value={`${result.zone.id} · ${result.zone.nome}`} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200">
        <Stat highlight value={m2(result.totalConstruido)} label="Total construído" />
        <Stat value={m2(result.limiteIa)} label={`Limite pelo IA ${props_ia(result)}`} />
        <Stat value={`${result.pavimentos} · ${fmt(result.altura, 1)} m`} label="Pavimentos · altura" />
        <Stat value={fmt(result.iaUtilizado, 2)} label="IA utilizado" />
        <Stat value={String(result.vagas)} label="Vagas necessárias (lei)" />
        <Stat value={`${result.unidades} / ${result.salas}`} label="Unidades / salas" />
      </div>

      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (nome.trim()) onSave(nome.trim());
        }}
      >
        <label htmlFor="nome-estudo" className="text-[13px] font-medium text-neutral-800">
          {saved ? `Estudo já salvo como “${saved.nome}”` : "Salvar este estudo"}
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="nome-estudo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm outline-none focus:border-[#1f5a46] focus:bg-white"
          />
          <button type="submit" className="h-9 rounded-md bg-[#1f5a46] px-4 text-sm font-medium text-white hover:bg-[#184837]">
            {saved ? "Atualizar" : "Salvar"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-500">Fica salvo neste navegador.</p>
      </form>
      <button
        type="button"
        onClick={onPrint}
        className="mx-auto mt-4 flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900"
      >
        <Printer className="size-3.5" />
        Imprimir estudo (A4)
      </button>
    </div>
  );
}

function props_ia(r: StudyResult) {
  return r.limiteIa / Math.max(1, r.areaLote) > r.zone.iaBasico + 0.001 ? "máximo" : "básico";
}

function Check2({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="ml-1 inline size-3.5 text-emerald-600" aria-label="atende" />
  ) : (
    <AlertTriangle className="ml-1 inline size-3.5 text-amber-600" aria-label="não atende" />
  );
}

function Zoneamento({ result }: { result: StudyResult }) {
  const z = result.zone;
  const rows: [string, string, string, boolean][] = [
    ["Índice de aproveitamento básico", fmt(z.iaBasico, 2), fmt(result.iaUtilizado, 2), result.iaUtilizado <= z.iaMaximo + 0.001],
    ["Índice de aproveitamento máximo", fmt(z.iaMaximo, 2), "—", true],
    ["Taxa de ocupação", `${Math.round(z.taxaOcupacao * 100)}%`, `${fmt(result.taxaOcupacao * 100, 1)}%`, result.taxaOcupacao <= z.taxaOcupacao + 0.001],
    ["Taxa de permeabilidade mín.", `${Math.round(z.permeabilidade * 100)}%`, m2(result.areaPermeavelMin), true],
    ["Gabarito (pavimentos)", String(z.maxPavimentos), String(result.pavimentos), result.pavimentos <= z.maxPavimentos],
    ["Altura máxima", `${fmt(z.maxPavimentos * z.alturaPavimento, 1)} m`, `${fmt(result.altura, 1)} m`, true],
    ["Recuo frontal", `${fmt(z.recuoFrontal, 1)} m`, `${fmt(z.recuoFrontal, 1)} m`, true],
    ["Recuo de fundos", `${fmt(z.recuoFundos, 1)} m`, `${fmt(z.recuoFundos, 1)} m`, true],
    ["Recuo lateral (a partir do 3º pav.)", `${fmt(z.recuoLateral, 1)} m`, result.pavimentos > 2 ? `${fmt(z.recuoLateral, 1)} m` : "—", true],
  ];
  return (
    <div>
      <SectionTag right={z.id}>{z.nome}</SectionTag>
      <p className="mb-3 text-[13px] text-neutral-600">
        <span className="font-medium text-neutral-800">Usos permitidos:</span> {z.usos}
      </p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-500">
            <th className="py-1.5 font-normal">Parâmetro</th>
            <th className="py-1.5 text-right font-normal">Lei</th>
            <th className="py-1.5 text-right font-normal">Estudo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map(([p, lei, est, ok]) => (
            <tr key={p}>
              <td className="py-1.5 text-neutral-700">{p}</td>
              <td className="py-1.5 text-right tabular-nums">{lei}</td>
              <td className="py-1.5 text-right tabular-nums">
                {est}
                {est !== "—" && <Check2 ok={ok} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-neutral-500">
        Parâmetros ilustrativos. Confirme sempre na lei de zoneamento vigente do município.
      </p>
    </div>
  );
}

function Massa({ result, params, onParams }: Props) {
  const z = result.zone;
  const max = Math.max(1, z.maxPavimentos);
  return (
    <div>
      <SectionTag right={`máx. ${z.maxPavimentos} pav.`}>Volumetria</SectionTag>
      <label className="block text-[13px] text-neutral-700" htmlFor="pav">
        Pavimentos: <span className="font-medium text-neutral-900">{result.pavimentos}</span>
      </label>
      <input
        id="pav"
        type="range"
        min={1}
        max={max}
        step={1}
        disabled={!result.edificavel}
        value={Math.min(params.pavimentos, max)}
        onChange={(e) => onParams({ ...params, pavimentos: Number(e.target.value) })}
        className="mt-2 w-full accent-[#1f5a46]"
      />
      <label className="mt-3 flex items-center gap-2 text-[13px] text-neutral-700">
        <input
          type="checkbox"
          checked={params.usarIaMaximo}
          onChange={(e) => onParams({ ...params, usarIaMaximo: e.target.checked })}
          className="accent-[#1f5a46]"
        />
        Usar IA máximo (outorga onerosa) — {fmt(z.iaMaximo, 2)}
      </label>

      <div className="mt-4 divide-y divide-neutral-100">
        <Row label="Projeção (térreo)" value={m2(result.projecao)} />
        <Row label="Taxa de ocupação" value={`${fmt(result.taxaOcupacao * 100, 1)}% de ${Math.round(z.taxaOcupacao * 100)}%`} />
        <Row label="Total construído" value={m2(result.totalConstruido)} />
        <Row label="Altura total" value={`${fmt(result.altura, 1)} m`} />
      </div>

      {result.pavimentos > 0 && (
        <table className="mt-4 w-full text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-500">
              <th className="py-1.5 font-normal">Pavimento</th>
              <th className="py-1.5 text-right font-normal">Área</th>
              <th className="py-1.5 text-right font-normal">Piso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {Array.from({ length: result.pavimentos }, (_, i) => result.pavimentos - 1 - i).map((f) => (
              <tr key={f}>
                <td className="py-1.5">{f === 0 ? "Térreo" : `${f}º pavimento`}</td>
                <td className="py-1.5 text-right tabular-nums">{m2(result.projecao)}</td>
                <td className="py-1.5 text-right tabular-nums">+{fmt(f * z.alturaPavimento, 1)} m</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NumberField({ id, label, value, onChange, suffix }: { id: string; label: string; value: number; onChange: (n: number) => void; suffix: string }) {
  return (
    <label htmlFor={id} className="block text-[13px] text-neutral-700">
      {label}
      <div className="mt-1 flex items-center rounded-md border border-neutral-200 bg-neutral-50 focus-within:border-[#1f5a46]">
        <input
          id={id}
          type="number"
          min={10}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n > 0) onChange(n);
          }}
          className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
        />
        <span className="pr-3 text-xs text-neutral-500">{suffix}</span>
      </div>
    </label>
  );
}

function Unidades({ result, params, onParams }: Props) {
  const usos: { id: Uso; label: string }[] = [
    { id: "residencial", label: "Residencial" },
    { id: "comercial", label: "Comercial" },
    { id: "misto", label: "Misto" },
  ];
  return (
    <div>
      <SectionTag>Programa</SectionTag>
      <div className="inline-flex rounded-lg bg-neutral-100 p-1">
        {usos.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onParams({ ...params, uso: u.id })}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              params.uso === u.id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800",
            )}
          >
            {u.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {params.uso !== "comercial" && (
          <NumberField id="au" label="Área média por unidade" value={params.areaUnidade} suffix="m²" onChange={(n) => onParams({ ...params, areaUnidade: n })} />
        )}
        {params.uso !== "residencial" && (
          <NumberField id="as" label="Área média por sala" value={params.areaSala} suffix="m²" onChange={(n) => onParams({ ...params, areaSala: n })} />
        )}
      </div>
      <label className="mt-4 block text-[13px] text-neutral-700" htmlFor="ef">
        Eficiência (privativa / construída): <span className="font-medium">{Math.round(params.eficiencia * 100)}%</span>
      </label>
      <input
        id="ef"
        type="range"
        min={0.6}
        max={0.95}
        step={0.01}
        value={params.eficiencia}
        onChange={(e) => onParams({ ...params, eficiencia: Number(e.target.value) })}
        className="mt-2 w-full accent-[#1f5a46]"
      />
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200">
        <Stat highlight value={String(result.unidades)} label="Unidades residenciais" />
        <Stat value={String(result.salas)} label="Salas comerciais" />
        <Stat value={m2(result.areaPrivativa)} label="Área privativa total" />
        <Stat value={String(result.vagas)} label="Vagas necessárias (lei)" />
      </div>
      <p className="mt-3 text-[11px] text-neutral-500">
        Vagas: 1 por unidade (2 acima de 120 m²) e 1 a cada 50 m² de área comercial.
      </p>
    </div>
  );
}

function Solar({ sun, onSun }: { sun: SunState; onSun: (s: SunState) => void }) {
  const fachadas = useMemo(() => facadeSunHours(), []);
  const day = DATES.find((d) => d.id === sun.date)!.day;
  const dl = daylight(day);
  const pos = sunPosition(day, sun.hour);
  const best = [...fachadas].sort((a, b) => b.horas.inverno - a.horas.inverno)[0];
  return (
    <div>
      <SectionTag right="lat. 27°S">Insolação</SectionTag>
      <label className="flex items-center gap-2 text-[13px] text-neutral-700">
        <input type="checkbox" checked={sun.enabled} onChange={(e) => onSun({ ...sun, enabled: e.target.checked })} className="accent-[#1f5a46]" />
        Mostrar sol e sombras no mapa
      </label>
      <SunControls sun={sun} onSun={onSun} />
      <div className="mt-3 divide-y divide-neutral-100">
        <Row label="Nascer · pôr do sol" value={`${formatHour(dl.nascer)} · ${formatHour(dl.por)}`} />
        <Row label="Altura do sol agora" value={`${fmt(Math.max(0, (pos.altitude * 180) / Math.PI), 1)}°`} />
        <Row label="Azimute" value={`${fmt((pos.azimuth * 180) / Math.PI, 0)}°`} />
      </div>
      <table className="mt-4 w-full text-[13px]">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-500">
            <th className="py-1.5 font-normal">Fachada</th>
            <th className="py-1.5 text-right font-normal">Inverno</th>
            <th className="py-1.5 text-right font-normal">Equinócio</th>
            <th className="py-1.5 text-right font-normal">Verão</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {fachadas.map((f) => (
            <tr key={f.id}>
              <td className="py-1.5">{f.label}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(f.horas.inverno, 1)} h</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(f.horas.equinocio, 1)} h</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(f.horas.verao, 1)} h</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex gap-2 text-[12px] text-neutral-600">
        <Sun className="mt-px size-3.5 shrink-0 text-amber-500" />
        Melhor fachada no inverno: {best.label} ({fmt(best.horas.inverno, 1)} h de sol direto).
      </p>
    </div>
  );
}

export function SunControls({ sun, onSun, compact }: { sun: SunState; onSun: (s: SunState) => void; compact?: boolean }) {
  return (
    <div className={cn("space-y-2", compact ? "" : "mt-3")}>
      <select
        aria-label="Data"
        value={sun.date}
        onChange={(e) => onSun({ ...sun, enabled: true, date: e.target.value as SunState["date"] })}
        className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs"
      >
        {DATES.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-3">
        <span className="w-10 text-xs text-neutral-700 tabular-nums">{formatHour(sun.hour)}</span>
        <input
          aria-label="Hora do dia"
          type="range"
          min={5}
          max={20}
          step={0.25}
          value={sun.hour}
          onChange={(e) => onSun({ ...sun, enabled: true, hour: Number(e.target.value) })}
          className="flex-1 accent-amber-500"
        />
      </div>
    </div>
  );
}
