// Geração do mapa: simétrico em relação à diagonal x = z, para que os dois lados sejam justos.

import { ORE_TILE_MAX } from "./defs";

export const MAP_W = 64;
export const MAP_H = 64;

export enum Terrain {
  Grass = 0,
  Sand = 1,
  Water = 2,
  Rock = 3,
  Tree = 4,
  Spire = 5,
}

export interface GameMap {
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

export function generateMap(seed = 7): GameMap {
  const w = MAP_W;
  const h = MAP_H;
  const terrain = new Uint8Array(w * h);
  const ore = new Float32Array(w * h);
  const oreMax = new Float32Array(w * h);
  const shade = new Float32Array(w * h);
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 11);
  const rnd = mulberry32(seed + 3);

  const playerStart = { x: 8, z: 51 };
  const aiStart = { x: 51, z: 8 };

  // Campos de cristal no lado do jogador (x < z); são espelhados para a IA.
  const fields = [
    { x: 6, z: 40, r: 3.4 },
    { x: 21, z: 57, r: 3.2 },
    { x: 22, z: 38, r: 3.6 },
    { x: 28, z: 37, r: 2.6 },
    { x: 8, z: 26, r: 2.8 },
  ];
  // Cristas de rocha que criam passagens.
  const ridges = [
    { x0: 15, z0: 31, x1: 24, z1: 33 },
    { x0: 34, z0: 46, x1: 38, z1: 56 },
    { x0: 2, z0: 18, x1: 6, z1: 15 },
  ];
  const fords = [11, 32, 53]; // posições ao longo da diagonal

  const distSeg = (px: number, pz: number, r: { x0: number; z0: number; x1: number; z1: number }) => {
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const t = Math.max(0, Math.min(1, ((px - r.x0) * dx + (pz - r.z0) * dz) / (dx * dx + dz * dz)));
    const cx = r.x0 + dx * t;
    const cz = r.z0 + dz * t;
    return Math.hypot(px - cx, pz - cz);
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
      let t: Terrain = Terrain.Grass;

      const riverW = 1.7 + noise(along * 0.15, 3.3) * 1.3;
      const nearFord = fords.some((f) => Math.abs(along - f) < 2.6);
      if (across < riverW) {
        t = nearFord ? Terrain.Sand : Terrain.Water;
      } else if (across < riverW + 1.1) {
        t = Terrain.Sand;
      }

      if (t === Terrain.Grass) {
        for (const r of ridges) {
          const d = distSeg(cx, cz, r);
          if (d < 1.1 + noise(cx * 0.4, cz * 0.4) * 0.8) t = Terrain.Rock;
        }
      }

      if (t === Terrain.Grass) {
        const n = noise(cx * 0.13, cz * 0.13) * 0.7 + noise2(cx * 0.4, cz * 0.4) * 0.3;
        const edge = Math.min(cx, cz, w - cx, h - cz);
        let treeChance = n > 0.66 ? 0.75 : n > 0.6 ? 0.3 : 0.015;
        if (edge < 2) treeChance = 0.85;
        else if (edge < 3.2) treeChance = Math.max(treeChance, 0.35);
        if (rnd() < treeChance) t = Terrain.Tree;
      }

      // Áreas livres: base, campos e caminhos perto das travessias.
      const baseD = Math.hypot(cx - (playerStart.x + 1.5), cz - (playerStart.z + 1.5));
      if (baseD < 8.5 && t !== Terrain.Water) t = Terrain.Grass;
      for (const f of fields) {
        const d = Math.hypot(cx - f.x, cz - f.z);
        if (d < f.r + 1.6 && (t === Terrain.Tree || t === Terrain.Rock)) t = Terrain.Grass;
      }
      for (const f of fords) {
        const fx = f - 0.0;
        const d = Math.hypot(cx - (fx - 2), cz - (fx + 2));
        if (d < 4.2 && t === Terrain.Tree) t = Terrain.Grass;
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
    terrain[szi * w + sxi] = Terrain.Spire;
    spires.push({ x: sxi, z: szi });
    for (let z = Math.floor(fz - r - 1); z <= fz + r + 1; z++) {
      for (let x = Math.floor(fx - r - 1); x <= fx + r + 1; x++) {
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const i = z * w + x;
        const tt = terrain[i];
        if (tt !== Terrain.Grass && tt !== Terrain.Sand) continue;
        const d = Math.hypot(x + 0.5 - fx, z + 0.5 - fz) + noise(x * 0.7, z * 0.7) * 1.1 - 0.5;
        if (d < r) {
          const amt = Math.round((ORE_TILE_MAX * (0.45 + 0.55 * (1 - d / r))) / 10) * 10;
          ore[i] = amt;
          oreMax[i] = amt;
        }
      }
    }
  };
  for (const f of fields) {
    addField(f.x, f.z, f.r);
    addField(f.z, f.x, f.r);
  }

  return { w, h, terrain, ore, oreMax, spires, starts: [playerStart, aiStart], shade };
}

export function isPassableTerrain(t: number) {
  return t === Terrain.Grass || t === Terrain.Sand;
}
