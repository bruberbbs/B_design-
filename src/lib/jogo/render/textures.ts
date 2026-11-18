// Texturas procedurais (desenhadas em canvas): camuflagem, metal, concreto, reboco, chapa corrugada,
// lagartas, sacos de areia, folhagem e sprites de fumaça/fogo. Todas repetem sem emenda.

import * as THREE from "three";
import { mulberry32 } from "../map";

// Ruído de valor periódico (repete a cada `period` células), para texturas sem emenda.
function makeTileNoise(seed: number) {
  const rnd = mulberry32(seed);
  const vals = new Float32Array(256 * 256);
  for (let i = 0; i < vals.length; i++) vals[i] = rnd();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, period: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const w = (v: number) => ((v % period) + period) % period;
    const at = (a: number, b: number) => vals[(w(b) & 255) * 256 + (w(a) & 255)];
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

function fbm(n: ReturnType<typeof makeTileNoise>, x: number, y: number, period: number, octaves = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    v += n(x * f, y * f, period * f) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / (1 - Math.pow(0.5, octaves));
}

const hex = (c: string) => {
  const col = new THREE.Color(c);
  return [col.r * 255, col.g * 255, col.b * 255];
};

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, ctx: c.getContext("2d")! };
}

function toTex(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Preenche pixel a pixel a partir de uma função (u,v) → [r,g,b].
function paint(size: number, fn: (u: number, v: number) => [number, number, number]) {
  const { c, ctx } = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { c, ctx };
}

export type GroundPattern = "grass" | "soil" | "sand" | "rock" | "snow" | "ash";

// Detalhe de solo: cor (modulação em torno de 0,5 = neutro) e altura, ambos sem emenda.
function groundField(pattern: GroundPattern, seed: number, size: number) {
  const n = makeTileNoise(seed);
  const m = makeTileNoise(seed + 13);
  const rnd = mulberry32(seed + 5);
  const hgt = new Float32Array(size * size);
  const col = new Float32Array(size * size * 3);
  const set = (i: number, h: number, r: number, g: number, b: number) => {
    hgt[i] = h;
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const low = fbm(n, u * 4, v * 4, 4, 3);
      const mid = fbm(m, u * 16, v * 16, 16, 3);
      const hi = n(u * 96, v * 96, 96);
      if (pattern === "grass") {
        // tufos (alongados em várias direções), manchas de terra e brilho de folhas
        const blades = n(u * 140 + mid * 3, v * 40 + low * 2, 140) * 0.6 + n(u * 40 + mid * 2, v * 140, 140) * 0.4;
        const soil = Math.max(0, 0.42 - low) * 2.2 * (mid > 0.55 ? 1 : 0.4);
        const k = 0.36 + blades * 0.3 + mid * 0.12 - soil * 0.18;
        const yellow = Math.max(0, low - 0.55) * 0.5;
        set(i, blades * 0.7 + mid * 0.3 - soil * 0.4, k + yellow * 0.6 + soil * 0.08, k + 0.04 + yellow * 0.3, k - 0.04 - soil * 0.02);
      } else if (pattern === "soil") {
        // terra batida com cascalho
        const grit = hi * 0.6 + mid * 0.4;
        const k = 0.42 + grit * 0.18 + (low - 0.5) * 0.12;
        set(i, grit * 0.7 + low * 0.3, k + 0.01, k, k - 0.02);
      } else if (pattern === "sand") {
        // grãos finos e ondulações do vento
        const rip = Math.sin((v * 22 + low * 2.4 + mid * 0.6) * Math.PI * 2) * 0.5 + 0.5;
        const k = 0.44 + hi * 0.1 + rip * 0.07 + (low - 0.5) * 0.1;
        set(i, rip * 0.55 + hi * 0.25 + low * 0.2, k + 0.01, k, k - 0.01);
      } else if (pattern === "rock") {
        // pedra com veios e fissuras (ruído "ridged")
        const r1 = 1 - Math.abs(fbm(n, u * 6, v * 6, 6, 4) * 2 - 1);
        const r2 = 1 - Math.abs(fbm(m, u * 12 + 3, v * 12, 12, 3) * 2 - 1);
        const crack = Math.pow(Math.max(r1, r2 * 0.9), 8);
        const strata = Math.sin((v * 10 + low * 3) * Math.PI) * 0.04;
        const k = 0.47 + (mid - 0.5) * 0.22 + hi * 0.05 + strata - crack * 0.28;
        set(i, low * 0.5 + mid * 0.4 + hi * 0.1 - crack * 0.6, k, k, k + 0.005);
      } else if (pattern === "snow") {
        const drift = fbm(n, u * 5 + mid * 0.5, v * 5, 5, 4);
        const k = 0.47 + (drift - 0.5) * 0.12 + hi * 0.04;
        set(i, drift * 0.8 + hi * 0.2, k - 0.01, k, k + 0.025);
      } else {
        // cinza vulcânica com pedriscos de pomes
        const pum = hi > 0.84 ? (hi - 0.84) * 2.5 : 0;
        const k = 0.42 + mid * 0.12 + (low - 0.5) * 0.12 + pum * 0.08;
        set(i, mid * 0.6 + low * 0.3 + pum * 0.4, k + 0.01, k, k - 0.005);
      }
    }
  // pedrinhas soltas (exceto na neve)
  if (pattern !== "snow") {
    const count = pattern === "grass" ? 60 : pattern === "rock" ? 40 : 140;
    for (let k = 0; k < count; k++) {
      const cx = rnd() * size;
      const cy = rnd() * size;
      const r = 1 + rnd() * (pattern === "soil" ? 3.5 : 2.2);
      const tone = (rnd() - 0.4) * 0.22;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const d = Math.hypot(dx, dy) / r;
          if (d > 1) continue;
          const xx = (((Math.round(cx) + dx) % size) + size) % size;
          const yy = (((Math.round(cy) + dy) % size) + size) % size;
          const i = yy * size + xx;
          const bump = Math.sqrt(1 - d * d);
          hgt[i] += bump * 0.5;
          for (let c = 0; c < 3; c++) col[i * 3 + c] += tone * (1 - d * 0.5) - (d > 0.75 ? 0.05 : 0);
        }
    }
  }
  return { hgt, col };
}

export class TextureKit {
  private cache = new Map<string, THREE.Texture>();

  private get(key: string, make: () => THREE.Texture) {
    let t = this.cache.get(key);
    if (!t) {
      t = make();
      this.cache.set(key, t);
    }
    return t;
  }

  // Camuflagem em manchas com sujeira, linhas de painel e rebites.
  camo(palette: string[], seed: number, scale = 3, panels = true) {
    return this.get(`camo|${palette.join()}|${seed}|${scale}|${panels}`, () => {
      const n = makeTileNoise(seed);
      const g = makeTileNoise(seed + 7);
      const cols = palette.map(hex);
      const size = 256;
      const { c, ctx } = paint(size, (u, v) => {
        let col = cols[0];
        for (let k = 1; k < cols.length; k++) {
          const f = fbm(n, u * scale + k * 3.1, v * scale + k * 1.7, scale, 3);
          if (f > 0.56 + k * 0.025) col = cols[k];
        }
        const grime = 0.82 + fbm(g, u * 8, v * 8, 8, 3) * 0.3;
        return [col[0] * grime, col[1] * grime, col[2] * grime];
      });
      if (panels) {
        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.lineWidth = 1;
        for (let k = 0; k <= 4; k++) {
          ctx.beginPath();
          ctx.moveTo(k * 64 + 0.5, 0);
          ctx.lineTo(k * 64 + 0.5, size);
          ctx.moveTo(0, k * 64 + 0.5);
          ctx.lineTo(size, k * 64 + 0.5);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        for (let k = 0; k < 4; k++) for (let j = 0; j < 16; j++) ctx.fillRect(k * 64 + 4, j * 16 + 6, 1.5, 1.5);
        // desgaste nas bordas: riscos claros
        const r = mulberry32(seed + 3);
        ctx.strokeStyle = "rgba(220,215,200,0.18)";
        for (let k = 0; k < 40; k++) {
          const x = r() * size;
          const y = r() * size;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 4);
          ctx.stroke();
        }
      }
      return toTex(c, true);
    });
  }

  // Metal escovado/pintado com riscos e manchas.
  metal(base: string, seed = 5) {
    return this.get(`metal|${base}|${seed}`, () => {
      const n = makeTileNoise(seed);
      const b = hex(base);
      const { c, ctx } = paint(128, (u, v) => {
        const k = 0.85 + fbm(n, u * 6, v * 6, 6, 3) * 0.28 + (n(u * 64, v * 2, 64) - 0.5) * 0.05;
        return [b[0] * k, b[1] * k, b[2] * k];
      });
      const r = mulberry32(seed + 1);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      for (let i = 0; i < 30; i++) {
        const x = r() * 128;
        const y = r() * 128;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + r() * 20 - 10, y + r() * 3);
        ctx.stroke();
      }
      return toTex(c, true);
    });
  }

  // Concreto com manchas de escorrimento e juntas.
  concrete(base: string, seed = 11, seams = true) {
    return this.get(`concrete|${base}|${seed}|${seams}`, () => {
      const n = makeTileNoise(seed);
      const s = makeTileNoise(seed + 5);
      const b = hex(base);
      const { c, ctx } = paint(256, (u, v) => {
        let k = 0.8 + fbm(n, u * 6, v * 6, 6, 4) * 0.32;
        // escorrimento vertical de sujeira
        k -= Math.max(0, s(u * 24, v * 1.5, 24) - 0.62) * 0.6;
        const speck = n(u * 128, v * 128, 128) > 0.86 ? 0.88 : 1;
        k *= speck;
        return [b[0] * k, b[1] * k, b[2] * k];
      });
      if (seams) {
        ctx.strokeStyle = "rgba(40,36,30,0.35)";
        ctx.lineWidth = 1.5;
        for (let k = 0; k <= 2; k++) {
          ctx.beginPath();
          ctx.moveTo(0, k * 128 + 0.5);
          ctx.lineTo(256, k * 128 + 0.5);
          ctx.moveTo(k * 128 + 0.5, 0);
          ctx.lineTo(k * 128 + 0.5, 256);
          ctx.stroke();
        }
      }
      return toTex(c, true);
    });
  }

  // Chapa metálica corrugada (telhados e galpões).
  corrugated(base: string, seed = 17) {
    return this.get(`corr|${base}|${seed}`, () => {
      const n = makeTileNoise(seed);
      const b = hex(base);
      const { c } = paint(128, (u, v) => {
        const ridge = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 16));
        const k = ridge * (0.82 + fbm(n, u * 5, v * 5, 5, 3) * 0.3) - Math.max(0, n(u * 10, v * 2, 10) - 0.7) * 0.4;
        return [b[0] * k, b[1] * k, b[2] * k];
      });
      return toTex(c, true);
    });
  }

  // Lagarta de tanque: borracha escura com garras.
  tread() {
    return this.get("tread", () => {
      const n = makeTileNoise(23);
      const { c } = paint(64, (u, v) => {
        const bar = Math.sin(u * Math.PI * 2 * 8) > 0.25 ? 1.35 : 0.8;
        const k = (0.75 + n(u * 16, v * 16, 16) * 0.3) * bar;
        return [38 * k, 36 * k, 34 * k];
      });
      return toTex(c, true);
    });
  }

  // Lona de sacos de areia.
  burlap() {
    return this.get("burlap", () => {
      const n = makeTileNoise(29);
      const { c } = paint(64, (u, v) => {
        const weave = 0.9 + 0.1 * Math.sin(u * 200) * Math.sin(v * 200);
        const k = (0.8 + n(u * 8, v * 8, 8) * 0.3) * weave;
        return [180 * k, 158 * k, 112 * k];
      });
      return toTex(c, true);
    });
  }

  // Grão fino (rugosidade e detalhe do terreno), em tons de cinza.
  // Textura de detalhe do solo (cor) e o mapa de normais correspondente.
  ground(pattern: GroundPattern, seed = 3) {
    const key = `ground|${pattern}|${seed}`;
    const cached = this.cache.get(key);
    if (cached) return { map: cached, normal: this.cache.get(key + "|n")! };
    const size = 256;
    const { hgt, col } = groundField(pattern, seed, size);
    const { c, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.max(0, Math.min(255, col[i * 3 + k] * 255));
      img.data[i * 4 + 3] = 255; // (canvas pré-multiplica o alfa: altura fica só nas normais)
    }
    ctx.putImageData(img, 0, 0);
    const map = toTex(c, false);
    // normais a partir da altura (diferenças centrais com repetição)
    const strength = pattern === "rock" ? 5 : pattern === "snow" ? 1.6 : pattern === "sand" ? 2.2 : 3;
    const { c: nc, ctx: nctx } = canvas(size);
    const nimg = nctx.createImageData(size, size);
    const H = (x: number, y: number) => hgt[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        nimg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        nimg.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
        nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        nimg.data[i + 3] = 255;
      }
    nctx.putImageData(nimg, 0, 0);
    const normal = toTex(nc, false);
    this.cache.set(key, map);
    this.cache.set(key + "|n", normal);
    return { map, normal };
  }

  // Ondulações da água (mapa de normais que repete).
  waterNormal() {
    return this.get("waterNormal", () => {
      const n = makeTileNoise(77);
      const m = makeTileNoise(78);
      const size = 256;
      const hgt = new Float32Array(size * size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          hgt[y * size + x] = fbm(n, u * 8, v * 8, 8, 4) * 0.7 + fbm(m, u * 20 + 1, v * 20, 20, 2) * 0.3;
        }
      const { c, ctx } = canvas(size);
      const img = ctx.createImageData(size, size);
      const H = (x: number, y: number) => hgt[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = (H(x + 1, y) - H(x - 1, y)) * 9;
          const dy = (H(x, y + 1) - H(x, y - 1)) * 9;
          const len = Math.hypot(dx, dy, 1);
          const i = (y * size + x) * 4;
          img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
          img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
          img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      return toTex(c, false);
    });
  }

  grain(seed = 31) {
    return this.get(`grain|${seed}`, () => {
      const n = makeTileNoise(seed);
      const { c } = paint(256, (u, v) => {
        const k = fbm(n, u * 16, v * 16, 16, 4) * 0.6 + n(u * 128, v * 128, 128) * 0.4;
        const g = 255 * Math.min(1, Math.max(0, k));
        return [g, g, g];
      });
      return toTex(c, false);
    });
  }

  // Folha de palmeira com recorte (usar com alphaTest).
  frond() {
    return this.get("frond", () => {
      const { c, ctx } = canvas(128);
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = "#5b4a2a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(4, 64);
      ctx.lineTo(124, 64);
      ctx.stroke();
      for (let i = 0; i < 26; i++) {
        const x = 8 + i * 4.5;
        const len = 30 * Math.sin(((i + 1) / 27) * Math.PI) + 6;
        const g = 90 + (i % 3) * 14;
        ctx.strokeStyle = `rgb(${40 + (i % 2) * 10},${g},${36})`;
        ctx.lineWidth = 3;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, 64);
          ctx.lineTo(x + 10, 64 + s * len);
          ctx.stroke();
        }
      }
      const t = toTex(c, true);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }

  // Sprite de fumaça (nuvem com bordas irregulares) e de fogo.
  smokeSprite() {
    return this.get("smoke", () => {
      const n = makeTileNoise(37);
      const size = 64;
      const { c, ctx } = canvas(size);
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = x / size - 0.5;
          const dy = y / size - 0.5;
          const d = Math.hypot(dx, dy) * 2;
          const f = fbm(n, x / 16, y / 16, 4, 4);
          const a = Math.max(0, 1 - d) * (0.45 + f * 0.75);
          const i = (y * size + x) * 4;
          const l = 200 + f * 55;
          img.data[i] = l;
          img.data[i + 1] = l;
          img.data[i + 2] = l;
          img.data[i + 3] = Math.min(255, a * a * 255 * 1.4);
        }
      ctx.putImageData(img, 0, 0);
      const t = toTex(c, false);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }
}
