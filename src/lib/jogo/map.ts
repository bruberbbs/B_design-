// Geração do mapa: simétrico em relação à diagonal x = z, para que os dois lados sejam justos.

import { ORE_TILE_MAX } from "./defs";

// Os layouts abaixo foram desenhados para 64×64; o mapa real é 30% maior e as
// posições são escaladas (larguras de rios, trilhas e campos ficam em tiles).
const LAYOUT_SIZE = 64;
export const MAP_W = 84;
export const MAP_H = 84;

export enum Terrain {
  Grass = 0,
  Sand = 1,
  Water = 2,
  Rock = 3,
  Tree = 4,
  Spire = 5,
}

export interface GameMap {
  id: MapId;
  biome: BiomeId;
  w: number;
  h: number;
  terrain: Uint8Array;
  ore: Float32Array; // créditos disponíveis em cada tile
  oreMax: Float32Array;
  spires: { x: number; z: number }[];
  starts: { x: number; z: number }[]; // canto superior-esquerdo do Centro de Comando, por time
  shade: Float32Array; // variação de cor da grama, 0..1
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruído de valor suave para variações orgânicas.
function makeNoise(seed: number) {
  const rnd = mulberry32(seed);
  const size = 256;
  const perm = new Uint8Array(size * 2);
  const vals = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < size; i++) perm[i + size] = perm[i];
  const lattice = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = lattice(xi, yi);
    const b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1);
    const d = lattice(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// Número pseudoaleatório estável por célula.
function cellRand(x: number, z: number, seed: number) {
  let h = Math.imul(x * 374761393 + z * 668265263 + seed * 2246822519, 1) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type MapId = "vale" | "dunas" | "fiorde" | "caldeira";
export type BiomeId = "temperate" | "desert" | "snow" | "volcanic";

interface Seg {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

// Configuração de um mapa. Coordenadas no lado do jogador (x < z); o outro lado é espelhado.
interface Layout {
  river?: { base: number; vary: number; fords: number[]; bank: number }; // líquido ao longo da diagonal
  lakes?: Circle[];
  channels?: (Seg & { w: number })[]; // braços de líquido (fiordes, rios de lava)
  ridges: Seg[];
  mesas?: { scale: number; threshold: number; minAcross: number; maxAcross: number };
  fields: Circle[];
  trees: { hi: number; hiChance: number; mid: number; midChance: number; sparse: number; nearLiquid?: number };
  border?: "trees" | "rock"; // o que fecha a borda do mapa
}

export interface MapInfo {
  id: MapId;
  name: string;
  biome: BiomeId;
  desc: string;
  layout: Layout;
}

export const MAPS: MapInfo[] = [
  {
    id: "vale",
    name: "Vale Verde",
    biome: "temperate",
    desc: "Campos e bosques cortados por um rio com três vaus.",
    layout: {
      river: { base: 1.7, vary: 1.3, fords: [11, 32, 53], bank: 1.1 },
      ridges: [
        { x0: 15, z0: 31, x1: 24, z1: 33 },
        { x0: 34, z0: 46, x1: 38, z1: 56 },
        { x0: 2, z0: 18, x1: 6, z1: 15 },
      ],
      fields: [
        { x: 6, z: 40, r: 3.4 },
        { x: 21, z: 57, r: 3.2 },
        { x: 22, z: 38, r: 3.6 },
        { x: 28, z: 37, r: 2.6 },
        { x: 8, z: 26, r: 2.8 },
      ],
      trees: { hi: 0.66, hiChance: 0.75, mid: 0.6, midChance: 0.3, sparse: 0.015 },
    },
  },
  {
    id: "dunas",
    name: "Dunas de Âmbar",
    biome: "desert",
    desc: "Deserto aberto com mesetas, cânions e oásis. Cristais ricos no centro.",
    layout: {
      lakes: [
        { x: 17, z: 44, r: 1.9 },
        { x: 24, z: 29, r: 1.5 },
      ],
      ridges: [
        { x0: 12, z0: 31, x1: 18, z1: 30 },
        { x0: 36, z0: 50, x1: 38, z1: 58 },
      ],
      mesas: { scale: 0.12, threshold: 0.6, minAcross: 4.5, maxAcross: 19 },
      fields: [
        { x: 6, z: 40, r: 3.3 },
        { x: 21, z: 57, r: 3.0 },
        { x: 26, z: 42, r: 3.0 },
        { x: 32, z: 32, r: 4.4 },
        { x: 9, z: 25, r: 2.6 },
      ],
      trees: { hi: 0.75, hiChance: 0.2, mid: 0.7, midChance: 0.06, sparse: 0.012, nearLiquid: 0.45 },
      border: "rock",
    },
  },
  {
    id: "fiorde",
    name: "Fiorde Gelado",
    biome: "snow",
    desc: "Tundra nevada com um mar congelado, fiordes e florestas de pinheiros.",
    layout: {
      river: { base: 2.5, vary: 1.5, fords: [10, 32, 54], bank: 1.2 },
      channels: [
        { x0: -1, z0: 30, x1: 11, z1: 33, w: 1.5 },
        { x0: 31, z0: 65, x1: 33, z1: 55, w: 1.4 },
      ],
      ridges: [
        { x0: 16, z0: 35, x1: 21, z1: 40 },
        { x0: 2, z0: 18, x1: 6, z1: 15 },
      ],
      fields: [
        { x: 6, z: 41, r: 3.3 },
        { x: 20, z: 58, r: 3.0 },
        { x: 23, z: 37, r: 3.4 },
        { x: 29, z: 41, r: 2.5 },
        { x: 9, z: 23, r: 2.8 },
      ],
      trees: { hi: 0.6, hiChance: 0.8, mid: 0.54, midChance: 0.35, sparse: 0.03 },
    },
  },
  {
    id: "caldeira",
    name: "Caldeira Vulcânica",
    biome: "volcanic",
    desc: "Basalto e cinzas ao redor de um lago de lava. Só se cruza pelos flancos.",
    layout: {
      river: { base: 1.5, vary: 0.8, fords: [12, 52], bank: 1.2 },
      lakes: [{ x: 32, z: 32, r: 6.5 }],
      ridges: [
        { x0: 14, z0: 34, x1: 19, z1: 41 },
        { x0: 25, z0: 52, x1: 28, z1: 60 },
        { x0: 3, z0: 20, x1: 8, z1: 18 },
      ],
      fields: [
        { x: 6, z: 40, r: 3.2 },
        { x: 20, z: 57, r: 3.0 },
        { x: 22, z: 41, r: 3.3 },
        { x: 28, z: 45, r: 2.3 },
        { x: 13, z: 23, r: 2.7 },
      ],
      trees: { hi: 0.68, hiChance: 0.35, mid: 0.62, midChance: 0.12, sparse: 0.02 },
      border: "rock",
    },
  },
];

export function mapInfo(id: MapId) {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

// Escala as posições do layout para o tamanho real do mapa.
function scaleLayout(L: Layout, k: number): Layout {
  const seg = <T extends Seg>(r: T): T => ({ ...r, x0: r.x0 * k, z0: r.z0 * k, x1: r.x1 * k, z1: r.z1 * k });
  return {
    ...L,
    river: L.river && { ...L.river, fords: L.river.fords.map((f) => f * k) },
    lakes: L.lakes?.map((c) => ({ x: c.x * k, z: c.z * k, r: c.r * Math.sqrt(k) })),
    channels: L.channels?.map(seg),
    ridges: L.ridges.map(seg),
    mesas: L.mesas && { ...L.mesas, scale: L.mesas.scale / k, minAcross: L.mesas.minAcross * k, maxAcross: L.mesas.maxAcross * k },
    fields: L.fields.map((c) => ({ x: c.x * k, z: c.z * k, r: c.r * 1.08 })),
  };
}

export function generateMap(id: MapId = "vale", seed = 7): GameMap {
  const info = mapInfo(id);
  const w = MAP_W;
  const h = MAP_H;
  const K = w / LAYOUT_SIZE;
  const L = scaleLayout(info.layout, K);
  const terrain = new Uint8Array(w * h);
  const ore = new Float32Array(w * h);
  const oreMax = new Float32Array(w * h);
  const shade = new Float32Array(w * h);
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 11);

  // bases nos cantos opostos: 30% mais distantes que no mapa antigo
  const playerStart = { x: Math.round(8 * K), z: Math.round(51 * K) };
  const aiStart = { x: playerStart.z, z: playerStart.x };

  const distSeg = (px: number, pz: number, r: Seg) => {
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const t = Math.max(0, Math.min(1, ((px - r.x0) * dx + (pz - r.z0) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - (r.x0 + dx * t), pz - (r.z0 + dz * t));
  };

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      // Trabalha no lado x <= z; o outro lado é espelhado.
      const sx = Math.min(x, z);
      const sz = Math.max(x, z);
      const cx = sx + 0.5;
      const cz = sz + 0.5;
      const along = (cx + cz) / 2;
      const across = (cz - cx) / Math.SQRT2;
      const wobble = noise(cx * 0.4, cz * 0.4);
      let t: Terrain = Terrain.Grass;
      let liquidD = Infinity; // distância até a borda do líquido (negativa = dentro)

      if (L.river) {
        const rw = L.river.base + noise(along * 0.15, 3.3) * L.river.vary;
        const nearFord = L.river.fords.some((f) => Math.abs(along - f) < 2.9);
        if (!nearFord) liquidD = Math.min(liquidD, across - rw);
        else if (across < rw) t = Terrain.Sand;
      }
      for (const lk of L.lakes ?? []) liquidD = Math.min(liquidD, Math.hypot(cx - lk.x, cz - lk.z) - lk.r - (wobble - 0.5) * 1.2);
      for (const ch of L.channels ?? []) liquidD = Math.min(liquidD, distSeg(cx, cz, ch) - ch.w - (wobble - 0.5) * 0.8);
      const bank = L.river?.bank ?? 1.1;
      if (liquidD < 0) t = Terrain.Water;
      else if (liquidD < bank) t = Terrain.Sand;

      if (t === Terrain.Grass) {
        for (const r of L.ridges) if (distSeg(cx, cz, r) < 1.1 + wobble * 0.8) t = Terrain.Rock;
        if (L.mesas && across > L.mesas.minAcross && across < L.mesas.maxAcross) {
          const m = noise2(cx * L.mesas.scale + 7, cz * L.mesas.scale + 3);
          if (m > L.mesas.threshold) t = Terrain.Rock;
          else if (m > L.mesas.threshold - 0.06) t = Terrain.Sand;
        }
      }

      if (t === Terrain.Grass) {
        const n = noise(cx * 0.13, cz * 0.13) * 0.7 + noise2(cx * 0.4, cz * 0.4) * 0.3;
        const edge = Math.min(cx, cz, w - cx, h - cz);
        const tr = L.trees;
        let chance = n > tr.hi ? tr.hiChance : n > tr.mid ? tr.midChance : tr.sparse;
        const rockBorder = L.border === "rock";
        if (rockBorder) {
          if (edge < 1.4 + wobble * 1.4) t = Terrain.Rock;
        } else if (edge < 2) chance = 0.85;
        else if (edge < 3.2) chance = Math.max(chance, 0.35);
        if (tr.nearLiquid && liquidD < 3.5) chance = Math.max(chance, tr.nearLiquid);
        // sorteio pela posição espelhada: os dois lados ficam idênticos
        if (t === Terrain.Grass && cellRand(sx, sz, seed) < chance) t = Terrain.Tree;
      }

      // Áreas livres: base, campos e caminhos perto das travessias.
      const baseD = Math.hypot(cx - (playerStart.x + 1.5), cz - (playerStart.z + 1.5));
      if (baseD < 8.5) t = Terrain.Grass;
      for (const f of L.fields) {
        const d = Math.hypot(cx - f.x, cz - f.z);
        if (d < f.r + 1.6 && (t === Terrain.Tree || t === Terrain.Rock)) t = Terrain.Grass;
      }
      for (const f of L.river?.fords ?? []) {
        const d = Math.hypot(cx - (f - 2), cz - (f + 2));
        if (d < 4.2 && (t === Terrain.Tree || t === Terrain.Rock)) t = Terrain.Grass;
      }

      terrain[z * w + x] = t;
      shade[z * w + x] = noise2(cx * 0.21, cz * 0.21) * 0.6 + noise(cx * 0.9, cz * 0.9) * 0.4;
    }
  }

  // Cristais.
  const spires: { x: number; z: number }[] = [];
  const addField = (fx: number, fz: number, r: number) => {
    const sxi = Math.floor(fx);
    const szi = Math.floor(fz);
    if (!spires.some((s) => s.x === sxi && s.z === szi)) {
      terrain[szi * w + sxi] = Terrain.Spire;
      spires.push({ x: sxi, z: szi });
    }
    for (let z = Math.floor(fz - r - 1); z <= fz + r + 1; z++) {
      for (let x = Math.floor(fx - r - 1); x <= fx + r + 1; x++) {
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const i = z * w + x;
        const tt = terrain[i];
        if (tt !== Terrain.Grass && tt !== Terrain.Sand) continue;
        // usa coordenadas espelhadas para o ruído, mantendo os dois lados iguais
        const mx = Math.min(x, z);
        const mz = Math.max(x, z);
        const d = Math.hypot(x + 0.5 - fx, z + 0.5 - fz) + noise(mx * 0.7, mz * 0.7) * 1.1 - 0.5;
        if (d < r) {
          const amt = Math.round((ORE_TILE_MAX * (0.45 + 0.55 * (1 - d / r))) / 10) * 10;
          ore[i] = amt;
          oreMax[i] = amt;
        }
      }
    }
  };
  for (const f of L.fields) {
    addField(f.x, f.z, f.r);
    addField(f.z, f.x, f.r);
  }

  return { id: info.id, biome: info.biome, w, h, terrain, ore, oreMax, spires, starts: [playerStart, aiStart], shade };
}

export function isPassableTerrain(t: number) {
  return t === Terrain.Grass || t === Terrain.Sand;
}
