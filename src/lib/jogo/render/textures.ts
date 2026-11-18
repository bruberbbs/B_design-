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
