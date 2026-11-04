"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Layers as LayersIcon, LocateFixed, Maximize2, Minimize2, Search, Sun, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateCity, type Lot } from "@/lib/estudo/city";
import { computeStudy, DATES, DEFAULT_PARAMS, sunPosition, sunVector, type StudyParams } from "@/lib/estudo/study";
import { MapScene, type Layers, type MapApi } from "./MapScene";
import { LotPanel, SunControls, m2 } from "./LotPanel";
import { PrintReport } from "./PrintReport";
import type { SavedStudy, SunState } from "./types";

const STORAGE_KEY = "estudo-lote:estudos:v1";

function loadStudies(): SavedStudy[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedStudy[]) : [];
  } catch {
    return [];
  }
}

function persistStudies(list: SavedStudy[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // armazenamento indisponível: segue só em memória
  }
}

const LAYER_LABELS: Record<keyof Layers, string> = {
  edificacoes: "Edificações",
  lotes: "Lotes",
  zoneamento: "Zoneamento",
  app: "APP / cursos d'água",
  ruas: "Nomes de ruas",
  status: "Status de obras",
};

export function EstudoApp() {
  const city = useMemo(() => generateCity(7), []);
  const mapApi = useRef<MapApi | null>(null);

  const [mode, setMode] = useState<"um" | "varios">("um");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [params, setParams] = useState<StudyParams>(DEFAULT_PARAMS);
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [layers, setLayers] = useState<Layers>({
    edificacoes: true,
    lotes: true,
    zoneamento: false,
    app: true,
    ruas: true,
    status: true,
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [sun, setSun] = useState<SunState>({ enabled: false, date: "inverno", hour: 10 });
  const [panelOpen, setPanelOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [studies, setStudies] = useState<SavedStudy[]>(loadStudies);
  const [currentStudyId, setCurrentStudyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const lotById = useMemo(() => new Map(city.lots.map((l) => [l.id, l])), [city]);
  const selectedLots = useMemo(() => selectedIds.map((id) => lotById.get(id)).filter((l): l is Lot => !!l), [selectedIds, lotById]);
  const result = useMemo(() => (selectedLots.length ? computeStudy(selectedLots, params) : null), [selectedLots, params]);
  const savedStudy = studies.find((s) => s.id === currentStudyId) ?? null;

  const sunDir = useMemo(() => {
    if (!sun.enabled) return null;
    const day = DATES.find((d) => d.id === sun.date)!.day;
    return sunVector(sunPosition(day, sun.hour));
  }, [sun]);

  const selectLots = useCallback((ids: string[], fly = true) => {
    setSelectedIds(ids);
    setCurrentStudyId(null);
    if (ids.length) {
      setPanelOpen(true);
      if (fly) mapApi.current?.flyToLots(ids);
    }
  }, []);

  const onPick = useCallback(
    (lot: Lot) => {
      if (mode === "um") {
        selectLots([lot.id]);
        return;
      }
      setCurrentStudyId(null);
      setPanelOpen(true);
      setSelectedIds((prev) => (prev.includes(lot.id) ? prev.filter((i) => i !== lot.id) : [...prev, lot.id]));
    },
    [mode, selectLots],
  );

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().replace(/\s/g, "");
    if (!q) return;
    const lot = city.lots.find((l) => l.inscricao === q) ?? city.lots.find((l) => l.inscricao.endsWith(q) || l.inscricao.includes(q));
    if (!lot) {
      setToast(`Nenhum lote encontrado para “${query}”.`);
      return;
    }
    setMode("um");
    selectLots([lot.id]);
  };

  const saveStudy = (nome: string) => {
    if (!result) return;
    const base = {
      nome,
      lotIds: selectedIds,
      params,
      areaLote: result.areaLote,
      totalConstruido: result.totalConstruido,
      pavimentos: result.pavimentos,
    };
    let next: SavedStudy[];
    if (savedStudy) {
      next = studies.map((s) => (s.id === savedStudy.id ? { ...s, ...base } : s));
      setToast("Estudo atualizado.");
    } else {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      next = [{ id, criadoEm: new Date().toISOString(), ...base }, ...studies];
      setCurrentStudyId(id);
      setToast("Estudo salvo no banco de estudos.");
    }
    setStudies(next);
    persistStudies(next);
  };

  const openStudy = (s: SavedStudy) => {
    setMode(s.lotIds.length > 1 ? "varios" : "um");
    setSelectedIds(s.lotIds);
    setParams(s.params);
    setCurrentStudyId(s.id);
    setPanelOpen(true);
    mapApi.current?.flyToLots(s.lotIds);
  };

  const deleteStudy = (id: string) => {
    const next = studies.filter((s) => s.id !== id);
    setStudies(next);
    persistStudies(next);
    if (currentStudyId === id) setCurrentStudyId(null);
  };

  const print = () => {
    setSnapshot(mapApi.current?.snapshot() ?? null);
    setTimeout(() => window.print(), 150);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setCurrentStudyId(null);
  };

  const masses = result?.masses ?? [];

  return (
    <>
      <div className="fixed inset-0 overflow-hidden bg-[#f1f0ec] font-sans text-neutral-900 print:hidden">
        <MapScene
          city={city}
          selectedIds={selectedIds}
          masses={masses}
          view={view}
          layers={layers}
          sun={sunDir}
          onPick={onPick}
          apiRef={mapApi}
        />

        {/* Barra superior */}
        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3">
          <div className="pointer-events-auto flex h-11 items-center gap-2.5 rounded-xl bg-white px-3 shadow-sm ring-1 ring-black/5">
            <LogoMark />
            <span className="hidden text-[13px] text-neutral-600 sm:inline">Estudo de Lote</span>
          </div>
          <form onSubmit={onSearch} className="pointer-events-auto flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-white pr-1.5 pl-3 shadow-sm ring-1 ring-black/5 sm:max-w-[360px] sm:flex-none">
            <Search className="size-4 shrink-0 text-neutral-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Inscrição, ex. ${city.lots[412].inscricao}`}
              aria-label="Buscar lote pela inscrição"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
            />
            <button type="submit" className="h-8 shrink-0 rounded-lg bg-neutral-100 px-3 text-xs font-medium hover:bg-neutral-200">
              Buscar
            </button>
          </form>
          <div className="pointer-events-auto ml-auto hidden h-11 items-center gap-2 rounded-xl bg-white pr-3 pl-1.5 shadow-sm ring-1 ring-black/5 sm:flex">
            <span className="grid size-8 place-items-center rounded-full bg-[#e8efe9] text-xs font-medium text-[#1f5a46]">U</span>
            <span className="text-[13px]">Usuário</span>
          </div>
        </header>

        {/* Painel */}
        <section
          aria-label={selectedLots.length ? "Lote selecionado" : "Banco de estudos"}
          className={cn(
            "absolute inset-x-2 bottom-[118px] flex max-h-[50vh] flex-col overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/5 transition-[width] sm:inset-x-auto sm:top-[66px] sm:right-3 sm:bottom-auto sm:max-h-[calc(100vh-150px)]",
            wide ? "sm:w-[min(980px,calc(100vw-24px))]" : "sm:w-[min(640px,calc(100vw-24px))] lg:w-[min(745px,58vw)]",
          )}
        >
          <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-3">
            <button type="button" onClick={() => setPanelOpen((o) => !o)} className="min-w-0 text-left">
              <div className="text-[11px] text-neutral-500">
                {selectedLots.length === 0 ? "Banco de estudos" : selectedLots.length === 1 ? "Lote selecionado" : "Lotes selecionados"}
              </div>
              <div className="truncate text-lg font-medium tabular-nums">
                {selectedLots.length === 0
                  ? `${studies.length} ${studies.length === 1 ? "estudo" : "estudos"}`
                  : selectedLots.length === 1
                    ? selectedLots[0].inscricao
                    : `${selectedLots.length} lotes · ${m2(result?.areaLote ?? 0)}`}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              {selectedLots.length > 0 && panelOpen && (
                <button
                  type="button"
                  onClick={() => setWide((w) => !w)}
                  aria-label={wide ? "Reduzir painel" : "Expandir painel"}
                  className="hidden size-8 place-items-center rounded-md bg-[#1f5a46] text-white hover:bg-[#184837] sm:grid"
                >
                  {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              )}
              {selectedLots.length > 0 && (
                <button type="button" onClick={clearSelection} aria-label="Limpar seleção" className="grid size-8 place-items-center rounded-md hover:bg-neutral-100">
                  <X className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setPanelOpen((o) => !o)}
                aria-label={panelOpen ? "Recolher painel" : "Abrir painel"}
                aria-expanded={panelOpen}
                className="grid size-8 place-items-center rounded-md border border-neutral-200 hover:bg-neutral-100"
              >
                {panelOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            </div>
          </div>

          {panelOpen && result && (
            <LotPanel
              key={`${selectedIds.join("|")}:${currentStudyId ?? ""}`}
              lots={selectedLots}
              result={result}
              params={params}
              onParams={setParams}
              sun={sun}
              onSun={setSun}
              saved={savedStudy}
              onSave={saveStudy}
              onPrint={print}
              onRemoveLot={(id) => setSelectedIds((prev) => prev.filter((i) => i !== id))}
            />
          )}

          {panelOpen && !result && (
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-neutral-100">
              {studies.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-neutral-500">
                  Nenhum estudo salvo ainda. Clique em um lote no mapa (ou busque pela inscrição) para ver o estudo e salvá-lo.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {studies.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">{s.nome}</div>
                        <div className="text-[11px] text-neutral-500">
                          {s.lotIds.length} {s.lotIds.length === 1 ? "lote" : "lotes"} · {m2(s.areaLote)} · CA {m2(s.totalConstruido)} · {s.pavimentos} pav.
                        </div>
                        <button type="button" onClick={() => openStudy(s)} className="mt-1 text-[11px] font-medium text-[#1f5a46] hover:underline">
                          Abrir no mapa
                        </button>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[11px] text-neutral-400">{new Date(s.criadoEm).toLocaleDateString("pt-BR")}</span>
                        <button type="button" onClick={() => deleteStudy(s.id)} aria-label={`Apagar ${s.nome}`} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Legenda + barra inferior */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 p-3">
          {sun.enabled && (
            <div className="pointer-events-auto w-[min(320px,calc(100vw-24px))] rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
              <div className="mb-2 flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5">
                  <Sun className="size-3.5 text-amber-500" /> Insolação
                </span>
                <button type="button" onClick={() => setSun({ ...sun, enabled: false })} aria-label="Fechar insolação" className="rounded p-0.5 hover:bg-neutral-100">
                  <X className="size-3.5" />
                </button>
              </div>
              <SunControls sun={sun} onSun={setSun} compact />
            </div>
          )}
          {layersOpen && (
            <div className="pointer-events-auto w-56 rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5">
              {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-neutral-50">
                  <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} className="accent-[#1f5a46]" />
                  {LAYER_LABELS[k]}
                </label>
              ))}
            </div>
          )}
          <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white/85 px-2 py-1 text-[10px] text-neutral-600 backdrop-blur">
            <LegendDot color="#6fae6f" label="Projeto em desenvolvimento" />
            <LegendDot color="#d9b44a" label="Obra em andamento" />
            <LegendDot color="#8a7ad6" label="Obra concluída" />
          </div>
          <nav className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            <Segmented
              value={mode}
              onChange={(v) => {
                setMode(v);
                if (v === "um" && selectedIds.length > 1) setSelectedIds(selectedIds.slice(0, 1));
              }}
              options={[
                { value: "um", label: "Um lote" },
                { value: "varios", label: "Vários lotes" },
              ]}
            />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "2d", label: "2D" },
                { value: "3d", label: "3D" },
              ]}
            />
            <ToolButton active={layersOpen} onClick={() => setLayersOpen((o) => !o)} icon={<LayersIcon className="size-3.5" />} label="Camadas" />
            <ToolButton active={sun.enabled} onClick={() => setSun({ ...sun, enabled: !sun.enabled })} icon={<Sun className="size-3.5" />} label="Insolação" />
            <ToolButton
              onClick={() => (selectedIds.length ? mapApi.current?.flyToLots(selectedIds) : mapApi.current?.resetView())}
              icon={<LocateFixed className="size-3.5" />}
              label="Localização"
            />
          </nav>
        </div>

        {mode === "varios" && selectedIds.length === 0 && (
          <div className="pointer-events-none absolute top-[70px] left-1/2 -translate-x-1/2 rounded-full bg-neutral-900/85 px-3 py-1.5 text-xs text-white sm:top-auto sm:bottom-24">
            Clique nos lotes para somá-los ao estudo
          </div>
        )}

        {toast && (
          <div role="status" className="absolute top-[70px] left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-xs text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>

      {result && <PrintReport lots={selectedLots} result={result} params={params} snapshot={snapshot} nome={savedStudy?.nome ?? `Estudo ${selectedLots[0].inscricao}`} />}
    </>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-label="Estudo de Lote">
      <rect x="2" y="14" width="10" height="12" rx="1.5" fill="#1f5a46" />
      <rect x="14" y="6" width="12" height="20" rx="1.5" fill="#9fabc2" />
      <rect x="14" y="6" width="12" height="20" rx="1.5" fill="none" stroke="#1f5a46" strokeWidth="1.5" />
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-white p-1 shadow-sm ring-1 ring-black/5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap",
            value === o.value ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToolButton({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap shadow-sm ring-1 ring-black/5",
        active ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
