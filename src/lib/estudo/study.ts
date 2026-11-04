import type { Lot, Rect } from "./city";
import { ZONES, type ZoneParams } from "./zoning";

export type Uso = "residencial" | "comercial" | "misto";

export interface StudyParams {
  pavimentos: number;
  uso: Uso;
  /** área privativa média por unidade residencial (m²) */
  areaUnidade: number;
  /** área privativa média por sala comercial (m²) */
  areaSala: number;
  /** eficiência: área privativa / área construída */
  eficiencia: number;
  /** usar índice máximo (outorga onerosa) */
  usarIaMaximo: boolean;
}

export const DEFAULT_PARAMS: StudyParams = {
  pavimentos: 2,
  uso: "residencial",
  areaUnidade: 90,
  areaSala: 35,
  eficiencia: 0.82,
  usarIaMaximo: false,
};

export interface LotMass {
  lotId: string;
  footprint: Rect;
  floors: number;
  floorHeight: number;
}

export interface StudyResult {
  zone: ZoneParams;
  areaLote: number;
  pavimentos: number;
  altura: number;
  projecao: number;
  totalConstruido: number;
  limiteIa: number;
  iaUtilizado: number;
  taxaOcupacao: number;
  areaPrivativa: number;
  unidades: number;
  salas: number;
  vagas: number;
  areaPermeavelMin: number;
  masses: LotMass[];
  avisos: string[];
  edificavel: boolean;
}

function rectArea(r: Rect) {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);
}

export function clampParams(params: StudyParams, zone: ZoneParams): StudyParams {
  return { ...params, pavimentos: Math.max(1, Math.min(params.pavimentos, Math.max(1, zone.maxPavimentos))) };
}

export function computeStudy(lots: Lot[], rawParams: StudyParams): StudyResult {
  const zone = ZONES[lots[0].zone];
  const params = clampParams(rawParams, zone);
  const avisos: string[] = [];
  const areaLote = lots.reduce((s, l) => s + l.area, 0);
  const ia = params.usarIaMaximo ? zone.iaMaximo : zone.iaBasico;
  const limiteIa = areaLote * ia;

  if (lots.some((l) => l.zone !== lots[0].zone)) {
    avisos.push("Lotes em zonas diferentes: foram usados os parâmetros da zona do primeiro lote.");
  }

  const edificavel = zone.maxPavimentos > 0 && lots.some((l) => l.appFraction < 0.5);
  if (zone.maxPavimentos === 0) avisos.push("Zona de preservação: o lote não é edificável.");

  const masses: LotMass[] = [];
  let projecao = 0;
  const pav = params.pavimentos;

  if (edificavel) {
    // primeiro passo: projeção máxima por lote respeitando recuos e taxa de ocupação
    const candidates = lots
      .filter((l) => l.appFraction < 0.5)
      .map((lot) => {
        const lateral = pav > 2 ? zone.recuoLateral : 0;
        const r = lot.rect;
        const frontN = lot.front === "N";
        let fp: Rect = {
          x0: r.x0 + lateral,
          x1: r.x1 - lateral,
          z0: frontN ? r.z0 + zone.recuoFrontal : r.z0 + zone.recuoFundos,
          z1: frontN ? r.z1 - zone.recuoFundos : r.z1 - zone.recuoFrontal,
        };
        // reduz área atingida pela APP
        const usable = lot.area * (1 - lot.appFraction);
        const maxTo = Math.min(usable, lot.area * zone.taxaOcupacao);
        if (rectArea(fp) > maxTo) fp = shrinkDepth(fp, maxTo, frontN);
        return { lot, fp };
      });

    const projMax = candidates.reduce((s, c) => s + rectArea(c.fp), 0);
    // segundo passo: limita pelo índice de aproveitamento
    const scale = projMax * pav > limiteIa ? limiteIa / (projMax * pav) : 1;
    if (scale < 1 && scale > 0) {
      avisos.push(
        `Projeção reduzida para caber no IA ${params.usarIaMaximo ? "máximo" : "básico"} (${ia.toLocaleString("pt-BR")}).`,
      );
    }
    for (const c of candidates) {
      const target = rectArea(c.fp) * scale;
      const fp = scale < 1 ? shrinkDepth(c.fp, target, c.lot.front === "N") : c.fp;
      projecao += rectArea(fp);
      masses.push({ lotId: c.lot.id, footprint: fp, floors: pav, floorHeight: zone.alturaPavimento });
    }
    if (lots.some((l) => l.appFraction > 0)) {
      avisos.push("Parte do terreno está em Área de Preservação Permanente (faixa marginal do curso d'água).");
    }
  }

  const totalConstruido = projecao * pav;
  const areaPrivativa = totalConstruido * params.eficiencia;
  let unidades = 0;
  let salas = 0;
  let vagas = 0;
  if (edificavel) {
    if (params.uso === "residencial") {
      unidades = Math.max(1, Math.floor(areaPrivativa / params.areaUnidade));
    } else if (params.uso === "comercial") {
      salas = Math.max(1, Math.floor(areaPrivativa / params.areaSala));
    } else {
      const privTerreo = projecao * params.eficiencia;
      salas = pav > 1 ? Math.max(1, Math.floor(privTerreo / params.areaSala)) : 0;
      unidades = Math.max(1, Math.floor((areaPrivativa - (pav > 1 ? privTerreo : 0)) / params.areaUnidade));
    }
    const vagasUnidade = params.areaUnidade > 120 ? 2 : 1;
    const areaComercial = params.uso === "comercial" ? areaPrivativa : params.uso === "misto" && pav > 1 ? projecao * params.eficiencia : 0;
    vagas = unidades * vagasUnidade + Math.ceil(areaComercial / 50);
  }

  return {
    zone,
    areaLote,
    pavimentos: edificavel ? pav : 0,
    altura: edificavel ? pav * zone.alturaPavimento : 0,
    projecao,
    totalConstruido,
    limiteIa,
    iaUtilizado: areaLote ? totalConstruido / areaLote : 0,
    taxaOcupacao: areaLote ? projecao / areaLote : 0,
    areaPrivativa,
    unidades,
    salas,
    vagas,
    areaPermeavelMin: areaLote * zone.permeabilidade,
    masses,
    avisos,
    edificavel,
  };
}

function shrinkDepth(fp: Rect, targetArea: number, frontN: boolean): Rect {
  const w = fp.x1 - fp.x0;
  if (w <= 0) return fp;
  const depth = Math.max(0, targetArea / w);
  return frontN ? { ...fp, z1: fp.z0 + depth } : { ...fp, z0: fp.z1 - depth };
}

// ---------------------------------------------------------------------------
// Análise solar

export const LATITUDE = -27.15;

export interface SunPosition {
  altitude: number; // rad
  azimuth: number; // rad, a partir do norte, sentido horário
}

export function sunPosition(dayOfYear: number, hour: number, lat = LATITUDE): SunPosition {
  const phi = (lat * Math.PI) / 180;
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const altitude = Math.asin(sinAlt);
  const azimuth = Math.atan2(
    -Math.cos(decl) * Math.sin(H),
    Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.sin(phi) * Math.cos(H),
  );
  return { altitude, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) };
}

/** vetor unitário apontando para o sol, no sistema da cena (x = leste, y = cima, z = sul) */
export function sunVector(p: SunPosition): [number, number, number] {
  return [
    Math.sin(p.azimuth) * Math.cos(p.altitude),
    Math.sin(p.altitude),
    -Math.cos(p.azimuth) * Math.cos(p.altitude),
  ];
}

export const DATES = [
  { id: "inverno", label: "Solstício de inverno (21/jun)", day: 172 },
  { id: "equinocio", label: "Equinócio (21/mar)", day: 80 },
  { id: "verao", label: "Solstício de verão (21/dez)", day: 355 },
] as const;

export type DateId = (typeof DATES)[number]["id"];

const FACADES = [
  { id: "N", label: "Norte", n: [0, -1] },
  { id: "L", label: "Leste", n: [1, 0] },
  { id: "S", label: "Sul", n: [0, 1] },
  { id: "O", label: "Oeste", n: [-1, 0] },
] as const;

export interface FacadeSun {
  id: string;
  label: string;
  horas: Record<DateId, number>;
}

export function facadeSunHours(): FacadeSun[] {
  return FACADES.map((f) => {
    const horas = {} as Record<DateId, number>;
    for (const d of DATES) {
      let minutes = 0;
      for (let m = 0; m < 24 * 60; m += 5) {
        const p = sunPosition(d.day, m / 60);
        if (p.altitude <= 0.05) continue;
        const [sx, , sz] = sunVector(p);
        if (sx * f.n[0] + sz * f.n[1] > 0.02) minutes += 5;
      }
      horas[d.id] = minutes / 60;
    }
    return { id: f.id, label: f.label, horas };
  });
}

export function daylight(day: number): { nascer: number; por: number } {
  let nascer = 6;
  let por = 18;
  for (let m = 0; m < 24 * 60; m++) {
    if (sunPosition(day, m / 60).altitude > 0) {
      nascer = m / 60;
      break;
    }
  }
  for (let m = 24 * 60; m > 0; m--) {
    if (sunPosition(day, m / 60).altitude > 0) {
      por = m / 60;
      break;
    }
  }
  return { nascer, por };
}

export function formatHour(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm === 60 ? 0 : mm).padStart(2, "0")}`;
}
