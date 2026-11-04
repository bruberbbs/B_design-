// Gera uma cidade fictícia (lotes, quadras, ruas, edificações, rio e APP).
// Os dados são sintéticos: substitua por um cadastro real (GeoJSON) quando houver.

import { ZONES, type ZoneId } from "./zoning";

export type Side = "N" | "S";
export type ProjectStatus = "desenvolvimento" | "andamento" | "concluida";

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Street {
  id: string;
  name: string;
  kind: "arterial" | "coletora" | "local";
  orientation: "h" | "v";
  /** coordenada fixa (z para ruas horizontais, x para verticais) */
  at: number;
  from: number;
  to: number;
  width: number;
}

export interface Building {
  rect: Rect;
  height: number;
}

export interface Lot {
  id: string;
  inscricao: string;
  block: number;
  rect: Rect;
  front: Side;
  frontStreet: Street;
  zone: ZoneId;
  area: number;
  testada: number;
  profundidade: number;
  /** fração aproximada do lote dentro da APP (0..1) */
  appFraction: number;
  building: Building | null;
  status: ProjectStatus | null;
}

export interface City {
  lots: Lot[];
  streets: Street[];
  blocks: Rect[];
  river: [number, number][];
  appWidth: number;
  preservation: Rect;
  bounds: Rect;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cota do terreno (m) em um ponto. Relevo suave subindo para nordeste. */
export function elevation(x: number, z: number): number {
  const hill = 14 * Math.exp(-(((x - 520) ** 2) / 90000 + ((z + 120) ** 2) / 50000));
  return (
    3.2 +
    0.004 * x -
    0.003 * z +
    0.9 * Math.sin(x / 47) * Math.cos(z / 39) +
    hill
  );
}

function distToPolyline(px: number, pz: number, line: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    const cx = ax + t * dx;
    const cz = az + t * dz;
    best = Math.min(best, Math.hypot(px - cx, pz - cz));
  }
  return best;
}

export function isInsideRect(r: Rect, x: number, z: number) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

const H_NAMES = [
  "Rua das Garoupas",
  "Rua Capivara",
  "Avenida Central",
  "Rua dos Ipês",
  "Rua Tamanduá-mirim",
  "Rua das Bromélias",
  "Rua do Farol",
  "Rua Sabiá",
];
const V_NAMES = [
  "Rua Itaguaçu",
  "Rua das Gaivotas",
  "Rua Corvina",
  "Avenida Beira-Rio",
  "Rua Araçá",
  "Rua dos Pescadores",
  "Rua Manacá",
  "Rua Tainha",
  "Rua Jerivá",
  "Rua das Conchas",
  "Rua Guarapuvu",
  "Rua Pitanga",
];

export function generateCity(seed = 7): City {
  const rnd = mulberry32(seed);
  const COLS = 10;
  const ROWS = 7;
  const BW = 100; // largura da quadra (x)
  const LOT_DEPTH = 32;
  const BD = LOT_DEPTH * 2; // profundidade da quadra (z)
  const ROAD = 14;
  const AVENUE = 22;

  const ox = -((COLS * (BW + ROAD)) / 2);
  const oz = -((ROWS * (BD + ROAD)) / 2);

  const river: [number, number][] = [
    [ox - 80, oz + 90],
    [ox + 160, oz + 150],
    [ox + 330, oz + 120],
    [ox + 520, oz + 230],
    [ox + 700, oz + 360],
    [ox + 860, oz + 420],
    [ox + 1240, oz + 470],
  ];
  const appWidth = 30;

  // Colunas/linhas de quadras ocupadas pelo rio viram faixa verde
  const preservation: Rect = {
    x0: ox + 7 * (BW + ROAD) - 10,
    z0: oz - 150,
    x1: ox + COLS * (BW + ROAD) + 160,
    z1: oz + 1 * (BD + ROAD) - ROAD - 4,
  };

  const streets: Street[] = [];
  // posições de início de cada linha/coluna de quadras
  const colX: number[] = [];
  const rowZ: number[] = [];
  let cx = ox;
  for (let c = 0; c < COLS; c++) {
    colX.push(cx);
    cx += BW + (c === 4 ? AVENUE : ROAD);
  }
  let cz = oz;
  for (let r = 0; r < ROWS; r++) {
    rowZ.push(cz);
    cz += BD + (r === 3 ? AVENUE : ROAD);
  }
  const maxX = colX[COLS - 1] + BW;
  const maxZ = rowZ[ROWS - 1] + BD;

  for (let r = 0; r <= ROWS; r++) {
    const w = r === 4 ? AVENUE : ROAD;
    const z = r === 0 ? oz - ROAD / 2 : r === ROWS ? maxZ + ROAD / 2 : rowZ[r] - w / 2;
    streets.push({
      id: `h${r}`,
      name: H_NAMES[r % H_NAMES.length],
      kind: r === 4 ? "arterial" : r === 1 ? "arterial" : r % 2 ? "coletora" : "local",
      orientation: "h",
      at: z,
      from: ox - ROAD,
      to: maxX + ROAD,
      width: w,
    });
  }
  for (let c = 0; c <= COLS; c++) {
    const w = c === 5 ? AVENUE : ROAD;
    const x = c === 0 ? ox - ROAD / 2 : c === COLS ? maxX + ROAD / 2 : colX[c] - w / 2;
    streets.push({
      id: `v${c}`,
      name: V_NAMES[c % V_NAMES.length],
      kind: c === 5 ? "arterial" : c % 3 === 0 ? "coletora" : "local",
      orientation: "v",
      at: x,
      from: oz - ROAD,
      to: maxZ + ROAD,
      width: w,
    });
  }

  const lots: Lot[] = [];
  const blocks: Rect[] = [];
  let blockNum = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      blockNum++;
      const bx0 = colX[c];
      const bz0 = rowZ[r];
      const block: Rect = { x0: bx0, z0: bz0, x1: bx0 + BW, z1: bz0 + BD };
      blocks.push(block);
      const bcx = (block.x0 + block.x1) / 2;
      const bcz = (block.z0 + block.z1) / 2;
      const inPreservation = isInsideRect(preservation, bcx, bcz);

      let zone: ZoneId;
      if (inPreservation) zone = "ZPA";
      else if (r === 3 || r === 4 || c === 4 || c === 5) zone = Math.abs(c - 4.5) < 2 && Math.abs(r - 3.5) < 2 ? "ZC" : "ZMD";
      else if (distToPolyline(bcx, bcz, river) < 110) zone = "ZIA";
      else zone = "ZBD";

      let lotNum = 0;
      for (const side of ["N", "S"] as Side[]) {
        const z0 = side === "N" ? bz0 : bz0 + LOT_DEPTH;
        const z1 = z0 + LOT_DEPTH;
        let x = bx0;
        while (x < bx0 + BW - 0.1) {
          let w = 10 + Math.floor(rnd() * 9);
          if (zone === "ZC" && rnd() < 0.3) w += 8;
          if (bx0 + BW - (x + w) < 10) w = bx0 + BW - x;
          lotNum++;
          const rect: Rect = { x0: x, z0, x1: x + w, z1 };
          x += w;

          // fração na APP via amostragem
          let inside = 0;
          const S = 4;
          for (let i = 0; i < S; i++)
            for (let j = 0; j < S; j++) {
              const px = rect.x0 + ((i + 0.5) / S) * (rect.x1 - rect.x0);
              const pz = rect.z0 + ((j + 0.5) / S) * (rect.z1 - rect.z0);
              if (distToPolyline(px, pz, river) < appWidth) inside++;
            }
          const appFraction = inside / (S * S);

          const frontStreet = streets.find(
            (s) => s.orientation === "h" && s.id === `h${side === "N" ? r : r + 1}`,
          )!;

          let building: Building | null = null;
          const cfg = ZONES[zone];
          if (zone !== "ZPA" && appFraction < 0.6 && rnd() < 0.8) {
            const fx = 1 + rnd() * 1.5;
            const frontSet = 3 + rnd() * 3;
            const backSet = 2 + rnd() * 8;
            const bz0b = side === "N" ? rect.z0 + frontSet : rect.z0 + backSet;
            const bz1b = side === "N" ? rect.z1 - backSet : rect.z1 - frontSet;
            const floors = 1 + Math.floor(rnd() * Math.min(cfg.maxPavimentos, zone === "ZC" ? 6 : 3));
            building = {
              rect: { x0: rect.x0 + fx, z0: bz0b, x1: rect.x1 - fx * (0.5 + rnd()), z1: bz1b },
              height: floors * 3 + rnd() * 0.6,
            };
          }

          const roll = rnd();
          const status: ProjectStatus | null =
            zone === "ZPA" ? null : roll < 0.012 ? "desenvolvimento" : roll < 0.022 ? "andamento" : roll < 0.03 ? "concluida" : null;

          const inscricao = `01.02.${String(blockNum).padStart(3, "0")}.${String(lotNum).padStart(4, "0")}`;
          lots.push({
            id: inscricao,
            inscricao,
            block: blockNum,
            rect,
            front: side,
            frontStreet,
            zone,
            area: w * LOT_DEPTH,
            testada: w,
            profundidade: LOT_DEPTH,
            appFraction,
            building,
            status,
          });
        }
      }
    }
  }

  return {
    lots,
    streets,
    blocks,
    river,
    appWidth,
    preservation,
    bounds: { x0: ox - 120, z0: oz - 160, x1: maxX + 160, z1: maxZ + 120 },
  };
}

export interface TerrainInfo {
  cotaMin: number;
  cotaMax: number;
  desnivel: number;
  declividadeMedia: number;
  cotaFrente: number;
  terreo: string;
  faixaDeclividade: string;
}

export function terrainInfo(lot: Lot): TerrainInfo {
  const { rect } = lot;
  const samples: number[] = [];
  let steep = 0;
  let total = 0;
  const N = 6;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const x = rect.x0 + (i / N) * (rect.x1 - rect.x0);
      const z = rect.z0 + (j / N) * (rect.z1 - rect.z0);
      const h = elevation(x, z);
      samples.push(h);
      const gx = (elevation(x + 0.5, z) - elevation(x - 0.5, z)) / 1;
      const gz = (elevation(x, z + 0.5) - elevation(x, z - 0.5)) / 1;
      const deg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      total++;
      if (deg > 16.7) steep++;
    }
  const cotaMin = Math.min(...samples);
  const cotaMax = Math.max(...samples);
  const midX = (rect.x0 + rect.x1) / 2;
  const frontZ = lot.front === "N" ? rect.z0 : rect.z1;
  const backZ = lot.front === "N" ? rect.z1 : rect.z0;
  const cotaFrente = elevation(midX, frontZ);
  const cotaFundo = elevation(midX, backZ);
  const desnivel = cotaMax - cotaMin;
  const declividadeMedia = (Math.abs(cotaFundo - cotaFrente) / lot.profundidade) * 100;
  const diff = cotaFundo - cotaFrente;
  let terreo: string;
  if (Math.abs(diff) < 0.8) terreo = `${fmt(cotaFrente, 1)} m · plano, no nível da frente`;
  else if (diff > 0) terreo = `${fmt(cotaFrente + Math.min(diff, 1.2), 1)} m · aclive, até +${fmt(Math.min(diff, 1.2), 2)} m da frente`;
  else terreo = `${fmt(cotaFrente, 1)} m · declive de ${fmt(-diff, 1)} m para o fundo`;
  const pctFlat = Math.round(((total - steep) / total) * 100);
  const faixaDeclividade = pctFlat === 100 ? "0–16,7°: 100%" : `0–16,7°: ${pctFlat}% · >16,7°: ${100 - pctFlat}%`;
  return { cotaMin, cotaMax, desnivel, declividadeMedia, cotaFrente, terreo, faixaDeclividade };
}

export function fmt(n: number, digits = 1) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
