// A* em grade com 8 direções, sem cortar quinas, e suavização por linha de visão.

export interface Pt {
  x: number;
  z: number;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    const a = this.items;
    const pr = this.prio;
    a.push(item);
    pr.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      [pr[parent], pr[i]] = [pr[i], pr[parent]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const pr = this.prio;
    const top = a[0];
    const lastI = a.pop()!;
    const lastP = pr.pop()!;
    if (a.length > 0) {
      a[0] = lastI;
      pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && pr[l] < pr[m]) m = l;
        if (r < a.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export class PathFinder {
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;

  constructor(
    private w: number,
    private h: number,
    private blocked: (i: number) => boolean,
  ) {
    this.g = new Float32Array(w * h);
    this.from = new Int32Array(w * h);
    this.stamp = new Uint32Array(w * h);
    this.closed = new Uint32Array(w * h);
  }

  passable(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h && !this.blocked(z * this.w + x);
  }

  // Tile livre mais próximo de (x, z), em espiral.
  nearestFree(x: number, z: number, maxR = 12): Pt | null {
    if (this.passable(x, z)) return { x, z };
    for (let r = 1; r <= maxR; r++) {
      let best: Pt | null = null;
      let bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.passable(x + dx, z + dz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            best = { x: x + dx, z: z + dz };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Retorna lista de tiles (centros) do início ao destino, ou null.
  find(sx: number, sz: number, tx: number, tz: number, maxNodes = 6000): Pt[] | null {
    const w = this.w;
    if (!this.passable(tx, tz)) {
      const alt = this.nearestFree(tx, tz);
      if (!alt) return null;
      tx = alt.x;
      tz = alt.z;
    }
    const start = sz * w + sx;
    const goal = tz * w + tx;
    if (start === goal) return [{ x: tx, z: tz }];
    this.gen++;
    const gen = this.gen;
    const heap = new MinHeap();
    const hfn = (i: number) => {
      const dx = Math.abs((i % w) - tx);
      const dz = Math.abs(Math.floor(i / w) - tz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.from[start] = -1;
    heap.push(start, hfn(start));
    let best = start;
    let bestH = hfn(start);
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        best = cur;
        break;
      }
      const ch = hfn(cur);
      if (ch < bestH) {
        bestH = ch;
        best = cur;
      }
      if (++expanded > maxNodes) break;
      const cx = cur % w;
      const cz = Math.floor(cur / w);
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.passable(nx, nz)) continue;
        if (dx !== 0 && dz !== 0 && (!this.passable(cx + dx, cz) || !this.passable(cx, cz + dz))) continue;
        const ni = nz * w + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + cost;
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.stamp[ni] = gen;
          this.g[ni] = ng;
          this.from[ni] = cur;
          heap.push(ni, ng + hfn(ni) * 1.001);
        }
      }
    }
    if (best === start) return null;
    const out: Pt[] = [];
    let c = best;
    while (c !== -1 && c !== start) {
      out.push({ x: c % w, z: Math.floor(c / w) });
      c = this.from[c];
    }
    out.reverse();
    return this.smooth(sx, sz, out);
  }

  lineClear(x0: number, z0: number, x1: number, z1: number) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 3);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + 0.5 + dx * t;
      const pz = z0 + 0.5 + dz * t;
      // checa uma pequena "largura" para não raspar nas quinas
      for (const [ox, oz] of [
        [0, 0],
        [0.3, 0.3],
        [-0.3, 0.3],
        [0.3, -0.3],
        [-0.3, -0.3],
      ]) {
        if (!this.passable(Math.floor(px + ox), Math.floor(pz + oz))) return false;
      }
    }
    return true;
  }

  private smooth(sx: number, sz: number, path: Pt[]): Pt[] {
    if (path.length < 3) return path;
    const out: Pt[] = [];
    let ax = sx;
    let az = sz;
    let i = 0;
    while (i < path.length) {
      let j = path.length - 1;
      while (j > i && !this.lineClear(ax, az, path[j].x, path[j].z)) j--;
      out.push(path[j]);
      ax = path[j].x;
      az = path[j].z;
      i = j + 1;
    }
    return out;
  }
}
