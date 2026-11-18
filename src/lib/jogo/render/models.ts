// Modelos 3D realistas montados com primitivas e texturas procedurais.
// Unidades olham para +x; construções têm origem no centro e a frente em +z.
// Cada modelo é montado uma vez por (tipo, time), tem as peças estáticas fundidas por material
// (poucas chamadas de desenho) e depois é copiado para cada unidade.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BuildingKind, FactionInfo, Team, UnitKind } from "../defs";
import { TextureKit } from "./textures";

export type MatPatcher = (m: THREE.Material) => void;
type Colors = Pick<FactionInfo, "main" | "dark" | "light" | "camo" | "uniform" | "structure">;

export interface UnitModel {
  root: THREE.Group;
  body: THREE.Object3D;
  turret: THREE.Object3D | null;
  barrel: THREE.Object3D | null;
  cargo: THREE.Object3D | null;
  rotors: THREE.Object3D[];
  legs: THREE.Object3D[];
  height: number;
}

export interface BuildingModel {
  root: THREE.Group;
  inner: THREE.Object3D;
  spin: THREE.Object3D | null;
  turret: THREE.Object3D | null;
  barrel: THREE.Object3D | null;
  glow: THREE.MeshStandardMaterial | null;
  height: number;
}

type V3 = [number, number, number];

export class ModelKit {
  readonly tex = new TextureKit();
  private geos = new Map<string, THREE.BufferGeometry>();
  private mats = new Map<string, THREE.Material>();
  private unitTpl = new Map<string, UnitModel>();
  private bldTpl = new Map<string, BuildingModel>();

  constructor(
    private patch: MatPatcher,
    private colorsOf: (team: Team) => Colors,
  ) {}

  // ------------------------------------------------------------ geometria

  geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geos.get(key);
    if (!g) {
      g = make();
      this.geos.set(key, g);
    }
    return g as T;
  }

  box(w: number, h: number, d: number, r = 0.012) {
    return this.geo(`b${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)));
  }
  sphere(r: number, ws = 16, hs = 12, phiLen = Math.PI * 2, thetaLen = Math.PI) {
    return this.geo(`s${r},${ws},${hs},${phiLen},${thetaLen}`, () => new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen));
  }
  cyl(rt: number, rb: number, h: number, seg = 16, open = false) {
    return this.geo(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  }
  capsule(r: number, len: number) {
    return this.geo(`p${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
  }
  torus(r: number, t: number, arc = Math.PI * 2) {
    return this.geo(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 8, 24, arc));
  }

  // Perfil lateral (x para frente, y para cima) extrudado na largura (z).
  side(key: string, profile: [number, number][], width: number, bevel = 0.012) {
    return this.geo(`side|${key}|${width}`, () => {
      const s = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 });
      g.translate(0, 0, -width / 2);
      return g;
    });
  }

  // Contorno visto de cima ([x, z]) extrudado para cima (y).
  top(key: string, outline: [number, number][], height: number, bevel = 0.01) {
    return this.geo(`top|${key}|${height}`, () => {
      const s = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2);
      return g;
    });
  }

  lathe(key: string, pts: [number, number][], seg = 28) {
    return this.geo(`lathe|${key}`, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
  }

  // ------------------------------------------------------------ materiais

  private std(key: string, opts: THREE.MeshStandardMaterialParameters, uvScale = 1) {
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial(opts);
      m.userData.uvScale = uvScale;
      this.patch(m);
      this.mats.set(key, m);
    }
    return m as THREE.MeshStandardMaterial;
  }

  mat(key: string, color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return this.std(`${key}|${color}`, { color, roughness: 0.6, metalness: 0.1, ...opts });
  }

  private get grain() {
    return this.tex.grain();
  }

  camo(team: Team) {
    const c = this.colorsOf(team);
    return this.std(`camo|${c.camo.join()}`, { map: this.tex.camo(c.camo, 3 + c.camo[0].length, 2.5), roughness: 0.66, metalness: 0.12, roughnessMap: this.grain }, 1.1);
  }
  uniform(team: Team) {
    const c = this.colorsOf(team);
    return this.std(`unif|${c.uniform.join()}`, { map: this.tex.camo(c.uniform, 9, 4, false), roughness: 0.92, metalness: 0 }, 5);
  }
  gear(team: Team) {
    const c = this.colorsOf(team);
    return this.mat("gear", c.uniform[3], { roughness: 0.85 });
  }
  // marcações na cor do time (faixas, bandeiras, insígnias)
  team(team: Team, shade: "main" | "dark" | "light" = "main") {
    return this.mat("teampaint", this.colorsOf(team)[shade], { roughness: 0.5, metalness: 0.15 });
  }
  wall(team: Team) {
    return this.std(`wall|${this.colorsOf(team).structure}`, { map: this.tex.concrete(this.colorsOf(team).structure, 41), roughness: 0.88, metalness: 0, color: "#ffffff" }, 0.7);
  }
  get concrete() {
    return this.std("concrete", { map: this.tex.concrete("#a8a499", 11), roughness: 0.94, metalness: 0 }, 0.55);
  }
  get concreteDark() {
    return this.std("concreteDark", { map: this.tex.concrete("#8f8b82", 13, false), roughness: 0.95, metalness: 0 }, 0.8);
  }
  get roof() {
    return this.std("roof", { map: this.tex.corrugated("#9a9e9f"), roughness: 0.55, metalness: 0.25 }, 1.6);
  }
  get rustRoof() {
    return this.std("rustRoof", { map: this.tex.corrugated("#946f52", 19), roughness: 0.75, metalness: 0.2 }, 1.6);
  }
  get steel() {
    return this.std("steel", { map: this.tex.metal("#9a9ea2"), roughness: 0.4, metalness: 0.6 }, 2);
  }
  get gunmetal() {
    return this.std("gunmetal", { map: this.tex.metal("#34373a", 7), roughness: 0.38, metalness: 0.85 }, 3);
  }
  get rubber() {
    return this.mat("rubber", "#1d1d1c", { roughness: 0.92, metalness: 0 });
  }
  get tread() {
    return this.std("tread", { map: this.tex.tread(), roughness: 0.85, metalness: 0.35 }, 6);
  }
  get skin() {
    return this.mat("skin", "#b9875f", { roughness: 0.7, metalness: 0 });
  }
  get glass() {
    return this.mat("glass", "#14212b", { roughness: 0.08, metalness: 0.7, envMapIntensity: 1.6 });
  }
  get dark() {
    return this.mat("dark", "#141414", { roughness: 0.9, metalness: 0 });
  }
  get sandbag() {
    return this.std("sandbag", { map: this.tex.burlap(), roughness: 1, metalness: 0 }, 4);
  }
  get wood() {
    return this.mat("wood", "#6d5235", { roughness: 0.85, metalness: 0 });
  }
  get hazard() {
    return this.mat("hazard", "#e0b020", { roughness: 0.6, metalness: 0.1 });
  }
  get whitePaint() {
    return this.mat("whitepaint", "#e8e6dd", { roughness: 0.7, metalness: 0 });
  }
  get crystal() {
    return this.mat("crystal", "#5ff0d0", { roughness: 0.2, metalness: 0.1, emissive: "#19b89a", emissiveIntensity: 0.6 });
  }
  get lampRed() {
    return this.mat("lampred", "#ff4a3a", { emissive: "#ff2a1a", emissiveIntensity: 1.4, roughness: 0.4 });
  }
  get lampWhite() {
    return this.mat("lampwhite", "#fff6d8", { emissive: "#fff0c0", emissiveIntensity: 1.2, roughness: 0.4 });
  }

  // ------------------------------------------------------------ montagem

  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s?: V3) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p);
    m.rotation.set(...r);
    if (s) m.scale.set(...s);
    parent.add(m);
    return m;
  }

  part(parent: THREE.Object3D, name: string, p: V3 = [0, 0, 0]) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.part = true;
    g.position.set(...p);
    parent.add(g);
    return g;
  }

  // Funde as malhas estáticas de cada peça por material e projeta UVs no espaço do modelo,
  // para a textura ter a mesma densidade em qualquer parte.
  private bake(g: THREE.Object3D) {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const keepParts: THREE.Object3D[] = [];
    const walk = (o: THREE.Object3D, m4: THREE.Matrix4) => {
      for (const child of [...o.children]) {
        child.updateMatrix();
        const mm = m4.clone().multiply(child.matrix);
        if (child.userData.part) {
          // peça móvel: posiciona relativa a g e funde por dentro
          mm.decompose(child.position, child.quaternion, child.scale);
          keepParts.push(child);
          this.bake(child);
          continue;
        }
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mm);
          for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(name)) geo.deleteAttribute(name);
          if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          const mat = mesh.material as THREE.Material;
          const list = byMat.get(mat) ?? [];
          list.push(geo);
          byMat.set(mat, list);
        }
        walk(child, mm);
      }
    };
    walk(g, new THREE.Matrix4());
    for (const c of [...g.children]) g.remove(c);
    for (const p of keepParts) g.add(p);
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      boxUV(merged, (mat.userData.uvScale as number) ?? 1);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
  }

  // ------------------------------------------------------------ peças reutilizáveis

  private sandbagRow(g: THREE.Object3D, x0: number, z0: number, x1: number, z1: number, layers = 2) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.13));
    const a = Math.atan2(z1 - z0, x1 - x0);
    for (let l = 0; l < layers; l++)
      for (let i = 0; i < n - (l % 2); i++) {
        const t = (i + 0.5 + (l % 2) * 0.5) / n;
        this.add(g, this.capsule(0.04, 0.07), this.sandbag, [x0 + (x1 - x0) * t, 0.04 + l * 0.065, z0 + (z1 - z0) * t], [0, -a, Math.PI / 2], [1, 1, 0.7]);
      }
  }

  private crate(g: THREE.Object3D, x: number, z: number, s = 0.12, rot = 0) {
    this.add(g, this.box(s, s * 0.8, s, 0.008), this.wood, [x, s * 0.4, z], [0, rot, 0]);
  }

  private barrel(g: THREE.Object3D, x: number, z: number, color = "#3d5a3a") {
    this.add(g, this.cyl(0.035, 0.035, 0.1, 12), this.mat("drum", color, { roughness: 0.6, metalness: 0.5 }), [x, 0.05, z]);
  }

  private wheel(g: THREE.Object3D, x: number, y: number, z: number, r: number, w: number) {
    this.add(g, this.cyl(r, r, w, 18), this.rubber, [x, y, z], [Math.PI / 2, 0, 0]);
    this.add(g, this.cyl(r * 0.55, r * 0.55, w * 1.05, 12), this.steel, [x, y, z], [Math.PI / 2, 0, 0]);
  }

  // Lagarta com rodas de apoio, para tanques e veículos de esteira.
  private trackUnit(g: THREE.Object3D, len: number, z: number, h = 0.15, w = 0.11, wheels = 5) {
    const r = h / 2;
    const prof: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      prof.push([len / 2 - r + Math.cos(a) * r, r + Math.sin(a) * r]);
    }
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 2 + (i / 8) * Math.PI;
      prof.push([-len / 2 + r + Math.cos(a) * r * 0.9, r + Math.sin(a) * r * 0.9]);
    }
    this.add(g, this.side(`track${len},${h}`, prof, w, 0.006), this.tread, [0, 0, z]);
    const side = Math.sign(z);
    for (let i = 0; i < wheels; i++) {
      const x = -len / 2 + r + ((len - 2 * r) * i) / (wheels - 1);
      this.add(g, this.cyl(r * 0.72, r * 0.72, 0.012, 14), this.steel, [x, r, z + side * (w / 2 + 0.002)], [Math.PI / 2, 0, 0]);
    }
  }

  private antenna(g: THREE.Object3D, x: number, y: number, z: number, team: Team, h = 0.3) {
    this.add(g, this.cyl(0.004, 0.006, h, 5), this.gunmetal, [x, y + h / 2, z]);
    this.add(g, this.box(0.07, 0.04, 0.004, 0.001), this.team(team), [x - 0.035, y + h - 0.03, z]);
  }

  private insignia(g: THREE.Object3D, team: Team, x: number, y: number, z: number, ry = 0, s = 1) {
    this.add(g, this.box(0.07 * s, 0.045 * s, 0.006, 0.004), this.team(team), [x, y, z], [0, ry, 0]);
  }

  // ------------------------------------------------------------ unidades

  unit(kind: UnitKind, team: Team): UnitModel {
    const key = `${kind}|${team}`;
    let tpl = this.unitTpl.get(key);
    if (!tpl) {
      tpl = this.buildUnit(kind, team);
      this.unitTpl.set(key, tpl);
    }
    const root = tpl.root.clone(true);
    const find = (n: string) => root.getObjectByName(n) ?? null;
    const rotors: THREE.Object3D[] = [];
    const legs: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name.startsWith("rotor")) rotors.push(o);
      if (o.name.startsWith("leg")) legs.push(o);
    });
    rotors.sort((a, b) => a.name.localeCompare(b.name));
    legs.sort((a, b) => a.name.localeCompare(b.name));
    return { root, body: find("body")!, turret: find("turret"), barrel: find("barrel"), cargo: find("cargo"), rotors, legs, height: tpl.height };
  }

  private buildUnit(kind: UnitKind, team: Team): UnitModel {
    const root = new THREE.Group();
    const body = this.part(root, "body");
    let height = 0.5;
    const camo = this.camo(team);

    const soldier = (gear: "rifle" | "rocket" | "flamer") => {
      const fig = new THREE.Group();
      fig.scale.setScalar(1.25);
      body.add(fig);
      const unif = this.uniform(team);
      const vest = this.gear(team);
      for (const [i, z] of [0.032, -0.032].entries()) {
        const leg = this.part(fig, `leg${i}`, [0, 0.2, z]);
        this.add(leg, this.capsule(0.022, 0.13), unif, [0, -0.095, 0]);
        this.add(leg, this.box(0.06, 0.035, 0.04, 0.01), this.mat("boot", "#2b231a", { roughness: 0.8 }), [0.012, -0.185, 0]);
      }
      this.add(fig, this.box(0.075, 0.05, 0.08, 0.015), unif, [0, 0.21, 0]);
      this.add(fig, this.capsule(0.042, 0.08), unif, [0, 0.29, 0]);
      this.add(fig, this.box(0.075, 0.105, 0.1, 0.018), vest, [0.004, 0.295, 0]);
      for (const z of [-0.025, 0.025]) this.add(fig, this.box(0.02, 0.03, 0.025, 0.006), vest, [0.045, 0.27, z]);
      this.add(fig, this.box(0.045, 0.075, 0.075, 0.012), vest, [-0.06, 0.3, 0]);
      this.add(fig, this.cyl(0.018, 0.02, 0.025, 8), this.skin, [0, 0.355, 0]);
      this.add(fig, this.sphere(0.03, 12, 10), this.skin, [0.004, 0.385, 0]);
      this.add(fig, this.sphere(0.038, 14, 8, Math.PI * 2, Math.PI / 2), unif, [0, 0.393, 0], [0, 0, 0], [1, 0.95, 1]);
      this.add(fig, this.torus(0.036, 0.0045), this.team(team), [0, 0.396, 0], [Math.PI / 2, 0, 0]);
      // braços e ombreira com a cor do time
      for (const z of [0.05, -0.05]) {
        this.add(fig, this.capsule(0.017, 0.085), unif, [0.04, 0.3, z * 0.8], [z > 0 ? 0.3 : -0.1, 0, -1.2]);
        this.add(fig, this.box(0.022, 0.02, 0.008, 0.003), this.team(team), [0, 0.33, z * 1.02]);
      }
      const gm = this.gunmetal;
      if (gear === "rocket") {
        this.add(fig, this.cyl(0.026, 0.026, 0.32, 14), camo, [0.03, 0.36, -0.06], [0, 0, Math.PI / 2]);
        this.add(fig, this.cyl(0.032, 0.026, 0.04, 14), gm, [0.2, 0.36, -0.06], [0, 0, Math.PI / 2]);
        this.add(fig, this.box(0.03, 0.025, 0.015, 0.004), gm, [0.06, 0.385, -0.035]);
      } else if (gear === "flamer") {
        for (const z of [0.022, -0.022]) {
          this.add(fig, this.capsule(0.022, 0.1), this.steel, [-0.075, 0.31, z]);
          this.add(fig, this.torus(0.023, 0.003), this.team(team), [-0.075, 0.3, z], [Math.PI / 2, 0, 0]);
        }
        this.add(fig, this.cyl(0.011, 0.014, 0.22, 8), gm, [0.13, 0.28, -0.02], [0, 0, Math.PI / 2]);
        this.add(fig, this.sphere(0.012, 8, 6), this.mat("pilot", "#ffb347", { emissive: "#ff7a00", emissiveIntensity: 1.6 }), [0.245, 0.28, -0.02]);
      } else {
        this.add(fig, this.box(0.12, 0.024, 0.016, 0.004), gm, [0.1, 0.29, -0.015], [0, 0, 0.1]);
        this.add(fig, this.cyl(0.005, 0.005, 0.1, 6), gm, [0.205, 0.3, -0.015], [0, 0, Math.PI / 2 + 0.1]);
        this.add(fig, this.box(0.016, 0.04, 0.012, 0.003), gm, [0.105, 0.265, -0.015], [0, 0, 0.25]);
        this.add(fig, this.box(0.05, 0.03, 0.014, 0.004), this.mat("stock", "#3a3328", { roughness: 0.8 }), [0.025, 0.28, -0.015], [0, 0, 0.1]);
      }
      height = 0.55;
    };

    switch (kind) {
      case "rifle":
        soldier("rifle");
        break;
      case "rocket":
        soldier("rocket");
        break;
      case "flamer":
        soldier("flamer");
        break;
      case "scout": {
        // jipe com metralhadora
        this.add(body, this.side("jeepbody", [[-0.3, 0.1], [0.24, 0.1], [0.32, 0.15], [0.32, 0.2], [0.12, 0.215], [0.08, 0.22], [-0.3, 0.22]], 0.3), camo);
        this.add(body, this.box(0.02, 0.1, 0.27, 0.005), this.gunmetal, [0.07, 0.27, 0], [0, 0, -0.25]);
        this.add(body, this.box(0.012, 0.085, 0.24, 0.003), this.glass, [0.078, 0.27, 0], [0, 0, -0.25]);
        this.add(body, this.box(0.012, 0.012, 0.3, 0.004), this.gunmetal, [-0.13, 0.33, 0]);
        for (const z of [0.14, -0.14]) this.add(body, this.cyl(0.006, 0.006, 0.12, 6), this.gunmetal, [-0.13, 0.27, z]);
        for (const x of [0.2, -0.19]) for (const z of [0.155, -0.155]) this.wheel(body, x, 0.07, z, 0.068, 0.06);
        for (const x of [0.2, -0.19]) for (const z of [0.15, -0.15]) this.add(body, this.box(0.15, 0.02, 0.07, 0.008), camo, [x, 0.145, z]);
        this.add(body, this.cyl(0.055, 0.055, 0.04, 14), this.rubber, [-0.33, 0.17, 0], [0, 0, Math.PI / 2]);
        this.add(body, this.box(0.14, 0.003, 0.06, 0.001), this.team(team), [0.2, 0.218, 0], [0, 0, -0.07]);
        for (const z of [0.1, -0.1]) this.add(body, this.cyl(0.014, 0.014, 0.01, 10), this.lampWhite, [0.322, 0.17, z], [0, 0, Math.PI / 2]);
        const t = this.part(body, "turret", [-0.12, 0.25, 0]);
        this.add(t, this.cyl(0.012, 0.012, 0.06, 6), this.gunmetal, [0, 0.03, 0]);
        const b = this.part(t, "barrel", [0, 0.07, 0]);
        this.add(b, this.box(0.1, 0.03, 0.025, 0.005), this.gunmetal, [0.02, 0, 0]);
        this.add(b, this.cyl(0.006, 0.006, 0.16, 6), this.gunmetal, [0.14, 0.005, 0], [0, 0, Math.PI / 2]);
        this.add(b, this.box(0.01, 0.05, 0.06, 0.003), this.gunmetal, [0.055, 0.01, 0]);
        height = 0.45;
        break;
      }
      case "javali": {
        // blindado 6x6
        this.add(body, this.side("apc", [[-0.38, 0.1], [0.3, 0.1], [0.42, 0.18], [0.36, 0.25], [-0.36, 0.27], [-0.4, 0.2]], 0.34), camo);
        for (const x of [0.24, 0.02, -0.22]) for (const z of [0.18, -0.18]) this.wheel(body, x, 0.075, z, 0.075, 0.06);
        for (const z of [0.172, -0.172]) this.add(body, this.box(0.62, 0.03, 0.02, 0.006), camo, [0.0, 0.175, z]);
        this.add(body, this.box(0.06, 0.04, 0.24, 0.006), this.glass, [0.36, 0.23, 0], [0, 0, -0.9]);
        this.insignia(body, team, -0.1, 0.2, 0.173);
        this.insignia(body, team, -0.1, 0.2, -0.173);
        for (const x of [-0.25, -0.12]) this.add(body, this.cyl(0.035, 0.035, 0.012, 12), this.gunmetal, [x, 0.275, 0.08]);
        this.antenna(body, -0.33, 0.27, -0.12, team, 0.25);
        const t = this.part(body, "turret", [0.02, 0.27, 0]);
        this.add(t, this.top("apcTur", [[0.11, 0.05], [0.07, 0.09], [-0.09, 0.09], [-0.11, 0.05], [-0.11, -0.05], [-0.09, -0.09], [0.07, -0.09], [0.11, -0.05]], 0.06), camo);
        const b = this.part(t, "barrel", [0.1, 0.035, 0]);
        for (const z of [0.025, -0.025]) this.add(b, this.cyl(0.008, 0.009, 0.2, 8), this.gunmetal, [0.1, 0, z], [0, 0, Math.PI / 2]);
        height = 0.5;
        break;
      }
      case "tank":
      case "heavy":
      case "lumen": {
        const S = kind === "heavy" ? 1.22 : 1;
        const g = new THREE.Group();
        g.scale.setScalar(S);
        body.add(g);
        for (const z of [0.25, -0.25]) this.trackUnit(g, 0.88, z, 0.15, 0.12, 6);
        const hull: [number, number][] = [[-0.42, 0.07], [0.34, 0.07], [0.46, 0.165], [0.27, 0.245], [-0.4, 0.245], [-0.45, 0.19]];
        this.add(g, this.side("mbtHull", hull, 0.4), camo);
        for (const z of [0.31, -0.31]) this.add(g, this.box(0.8, 0.055, 0.02, 0.006), camo, [-0.02, 0.19, z]);
        this.add(g, this.box(0.06, 0.05, 0.36, 0.01), this.gunmetal, [-0.43, 0.2, 0]);
        for (const z of [0.12, -0.12]) this.add(g, this.cyl(0.016, 0.016, 0.012, 10), this.lampWhite, [0.39, 0.205, z], [0, 0, Math.PI / 2]);
        this.add(g, this.box(0.18, 0.025, 0.06, 0.006), this.wood, [-0.25, 0.258, 0.13]);
        for (const z of [0.15, -0.15]) this.add(g, this.cyl(0.035, 0.035, 0.09, 12), this.mat("fuel", "#3b4630", { roughness: 0.6, metalness: 0.4 }), [-0.38, 0.27, z], [Math.PI / 2, 0, 0]);
        this.insignia(g, team, -0.12, 0.19, 0.322, 0, 1.2);
        this.insignia(g, team, -0.12, 0.19, -0.322, 0, 1.2);
        const t = this.part(g, "turret", [-0.03, 0.245, 0]);
        if (kind === "lumen") {
          this.add(t, this.top("lumenTur", [[0.19, 0.06], [0.12, 0.15], [-0.14, 0.15], [-0.2, 0.08], [-0.2, -0.08], [-0.14, -0.15], [0.12, -0.15], [0.19, -0.06]], 0.1), camo);
          this.add(t, this.box(0.1, 0.05, 0.22, 0.01), this.gunmetal, [-0.04, 0.12, 0]);
        } else {
          this.add(t, this.top("mbtTur", [[0.21, 0.04], [0.14, 0.15], [-0.12, 0.16], [-0.22, 0.11], [-0.24, -0.11], [-0.12, -0.16], [0.14, -0.15], [0.21, -0.04]], 0.105), camo);
          this.add(t, this.box(0.12, 0.05, 0.28, 0.008), camo, [-0.27, 0.05, 0]);
        }
        this.add(t, this.cyl(0.045, 0.045, 0.025, 14), camo, [-0.06, 0.12, 0.07]);
        this.add(t, this.cyl(0.04, 0.04, 0.02, 14), camo, [-0.06, 0.12, -0.07]);
        this.add(t, this.box(0.025, 0.02, 0.1, 0.004), this.gunmetal, [-0.03, 0.15, 0.07]);
        this.add(t, this.cyl(0.003, 0.003, 0.08, 5), this.gunmetal, [0.0, 0.17, 0.07], [0, 0, Math.PI / 2]);
        this.antenna(t, -0.2, 0.1, -0.1, team, 0.3);
        this.insignia(t, team, 0.0, 0.055, 0.155, 0.1, 0.9);
        this.insignia(t, team, 0.0, 0.055, -0.155, -0.1, 0.9);
        if (kind === "heavy") for (let i = 0; i < 6; i++) this.add(t, this.box(0.035, 0.04, 0.05, 0.004), camo, [0.17, 0.05, -0.12 + i * 0.048], [0, 0, 0.3]);
        const b = this.part(t, "barrel", [0.2, 0.055, 0]);
        if (kind === "lumen") {
          this.add(b, this.box(0.06, 0.07, 0.1, 0.01), this.gunmetal, [0.0, 0, 0]);
          this.add(b, this.cyl(0.03, 0.035, 0.32, 14), this.gunmetal, [0.18, 0, 0], [0, 0, Math.PI / 2]);
          for (let i = 0; i < 4; i++) this.add(b, this.torus(0.036, 0.007), this.steel, [0.08 + i * 0.06, 0, 0], [0, Math.PI / 2, 0]);
          this.add(b, this.sphere(0.03, 14, 10), this.mat("lens", "#bdf7ff", { emissive: "#36e0ff", emissiveIntensity: 2.2, roughness: 0.1 }), [0.345, 0, 0]);
        } else {
          this.add(b, this.box(0.06, 0.07, 0.12, 0.01), camo, [0, 0, 0]);
          const offs = kind === "heavy" ? [0.035, -0.035] : [0];
          for (const z of offs) {
            this.add(b, this.cyl(0.015, 0.019, 0.5, 12), this.gunmetal, [0.27, 0, z], [0, 0, Math.PI / 2]);
            this.add(b, this.cyl(0.025, 0.025, 0.07, 12), camo, [0.22, 0, z], [0, 0, Math.PI / 2]);
            this.add(b, this.box(0.045, 0.034, 0.034, 0.004), this.gunmetal, [0.53, 0, z]);
          }
        }
        height = 0.6 * S;
        break;
      }
      case "artillery": {
        // obuseiro autopropulsado
        for (const z of [0.24, -0.24]) this.trackUnit(body, 0.86, z, 0.14, 0.11, 6);
        this.add(body, this.side("spgHull", [[-0.42, 0.07], [0.32, 0.07], [0.44, 0.15], [0.3, 0.22], [-0.42, 0.22]], 0.38), camo);
        const t = this.part(body, "turret", [-0.08, 0.22, 0]);
        this.add(t, this.top("spgTur", [[0.16, 0.14], [-0.24, 0.16], [-0.26, -0.16], [0.16, -0.14], [0.2, 0]], 0.16), camo);
        this.add(t, this.box(0.06, 0.05, 0.05, 0.006), this.gunmetal, [-0.1, 0.19, 0.07]);
        this.insignia(t, team, -0.04, 0.09, 0.15, 0, 1.1);
        this.insignia(t, team, -0.04, 0.09, -0.15, 0, 1.1);
        this.antenna(t, -0.2, 0.16, -0.11, team, 0.28);
        const b = this.part(t, "barrel", [0.17, 0.09, 0]);
        b.rotation.z = 0.35;
        this.add(b, this.box(0.08, 0.08, 0.1, 0.01), camo);
        this.add(b, this.cyl(0.02, 0.026, 0.62, 12), this.gunmetal, [0.33, 0, 0], [0, 0, Math.PI / 2]);
        this.add(b, this.box(0.06, 0.04, 0.045, 0.005), this.gunmetal, [0.66, 0, 0]);
        height = 0.6;
        break;
      }
      case "tempest": {
        // caminhão lança-foguetes 6x6
        this.add(body, this.box(0.86, 0.06, 0.28, 0.01), this.gunmetal, [-0.02, 0.12, 0]);
        this.add(body, this.side("cab", [[0.18, 0.15], [0.42, 0.15], [0.42, 0.25], [0.36, 0.34], [0.18, 0.34]], 0.3), camo);
        this.add(body, this.box(0.012, 0.07, 0.24, 0.003), this.glass, [0.39, 0.3, 0], [0, 0, -0.95]);
        for (const z of [0.151, -0.151]) this.add(body, this.box(0.08, 0.05, 0.004, 0.002), this.glass, [0.28, 0.3, z]);
        for (const x of [0.3, 0.0, -0.18]) for (const z of [0.16, -0.16]) this.wheel(body, x, 0.08, z, 0.08, 0.065);
        this.insignia(body, team, 0.3, 0.22, 0.152);
        this.insignia(body, team, 0.3, 0.22, -0.152);
        const t = this.part(body, "turret", [-0.15, 0.17, 0]);
        this.add(t, this.cyl(0.09, 0.1, 0.05, 14), this.gunmetal, [0, 0.025, 0]);
        const b = this.part(t, "barrel", [0, 0.1, 0]);
        b.rotation.z = 0.42;
        this.add(b, this.box(0.4, 0.16, 0.26, 0.012), camo, [0.04, 0, 0]);
        for (const y of [0.04, -0.04]) for (const z of [0.07, 0.0, -0.07]) this.add(b, this.cyl(0.024, 0.024, 0.01, 10), this.dark, [0.245, y, z], [0, 0, Math.PI / 2]);
        height = 0.6;
        break;
      }
      case "harvester": {
        // coletor de cristais: esteiras, caçamba e cabine
        for (const z of [0.27, -0.27]) this.trackUnit(body, 0.9, z, 0.16, 0.13, 5);
        this.add(body, this.box(0.86, 0.14, 0.44, 0.02), camo, [0, 0.21, 0]);
        this.add(body, this.box(0.24, 0.2, 0.42, 0.02), camo, [0.28, 0.38, 0]);
        this.add(body, this.box(0.012, 0.11, 0.36, 0.004), this.glass, [0.402, 0.42, 0]);
        this.add(body, this.box(0.52, 0.18, 0.5, 0.015), this.steel, [-0.16, 0.37, 0]);
        for (const x of [-0.38, 0.06]) this.add(body, this.box(0.02, 0.185, 0.51, 0.004), this.hazard, [x, 0.37, 0]);
        this.add(body, this.side("scoop", [[0.0, 0.0], [0.14, 0.0], [0.18, 0.1], [0.04, 0.16]], 0.56), this.steel, [0.42, 0.05, 0]);
        this.add(body, this.cyl(0.025, 0.03, 0.22, 10), this.gunmetal, [0.15, 0.48, -0.17]);
        this.insignia(body, team, 0.28, 0.4, 0.212);
        this.insignia(body, team, 0.28, 0.4, -0.212);
        for (const z of [0.15, -0.15]) this.add(body, this.cyl(0.012, 0.012, 0.012, 10), this.mat("amber", "#ffb020", { emissive: "#ff9000", emissiveIntensity: 1.2 }), [0.3, 0.49, z]);
        const c = this.part(body, "cargo", [-0.16, 0.46, 0]);
        for (const [x, z, s] of [
          [-0.12, 0.1, 1],
          [0.05, -0.1, 0.8],
          [-0.05, -0.12, 0.9],
          [0.08, 0.12, 0.7],
          [0.15, 0.0, 0.85],
        ] as V3[])
          this.add(c, this.geo("gem", () => new THREE.OctahedronGeometry(0.07, 0)), this.crystal, [x, 0, z], [0.4, x * 3, 0.2], [s, s * 1.4, s]);
        height = 0.66;
        break;
      }
      case "drone": {
        const carbon = this.mat("carbon", "#2a2d31", { roughness: 0.45, metalness: 0.5 });
        this.add(body, this.box(0.2, 0.06, 0.13, 0.02), carbon);
        this.add(body, this.box(0.12, 0.02, 0.09, 0.008), this.team(team), [0, 0.035, 0]);
        this.add(body, this.sphere(0.03, 12, 10), this.gunmetal, [0.09, -0.04, 0]);
        this.add(body, this.sphere(0.016, 10, 8), this.glass, [0.115, -0.045, 0]);
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          this.add(body, this.box(0.24, 0.016, 0.022, 0.006), carbon, [Math.cos(a) * 0.12, 0.01, Math.sin(a) * 0.12], [0, -a, 0]);
          this.add(body, this.cyl(0.018, 0.018, 0.03, 10), this.gunmetal, [Math.cos(a) * 0.23, 0.02, Math.sin(a) * 0.23]);
          const r = this.part(body, `rotor${i}`, [Math.cos(a) * 0.23, 0.04, Math.sin(a) * 0.23]);
          this.add(r, this.box(0.16, 0.004, 0.018, 0.002), this.rubber);
          this.add(r, this.cyl(0.085, 0.085, 0.002, 20), this.mat("blur", "#202020", { transparent: true, opacity: 0.22, depthWrite: false }));
        }
        this.add(body, this.box(0.06, 0.02, 0.02, 0.005), this.gunmetal, [0.06, -0.05, 0.04]);
        height = 0.2;
        break;
      }
      case "heli":
      case "tufao": {
        const S = kind === "tufao" ? 1.15 : 1;
        const g = new THREE.Group();
        g.scale.setScalar(S);
        body.add(g);
        const fus: [number, number][] = [[-0.2, -0.08], [0.18, -0.09], [0.32, -0.04], [0.36, 0.02], [0.26, 0.08], [0.0, 0.12], [-0.22, 0.1], [-0.3, 0.03]];
        this.add(g, this.side(`fus${kind}`, fus, kind === "tufao" ? 0.2 : 0.15, 0.03), camo);
        this.add(g, this.side("canopy", [[0.04, 0.08], [0.24, 0.07], [0.3, 0.02], [0.2, 0.12], [0.06, 0.14]], 0.1, 0.02), this.glass);
        this.add(g, this.cyl(0.018, 0.045, 0.5, 10), camo, [-0.5, 0.04, 0], [0, 0, Math.PI / 2 - 0.05]);
        this.add(g, this.side("fin", [[-0.82, 0.02], [-0.7, 0.04], [-0.72, 0.2], [-0.8, 0.22]], 0.015, 0.004), camo);
        this.add(g, this.box(0.12, 0.012, 0.18, 0.004), camo, [-0.68, 0.05, 0]);
        this.insignia(g, team, -0.05, 0.03, kind === "tufao" ? 0.11 : 0.085, 0, 1.2);
        this.insignia(g, team, -0.05, 0.03, kind === "tufao" ? -0.11 : -0.085, 0, 1.2);
        const tr = this.part(g, "rotor0", [-0.78, 0.13, 0.03]);
        this.add(tr, this.box(0.016, 0.2, 0.006, 0.002), this.gunmetal);
        this.add(tr, this.cyl(0.1, 0.1, 0.002, 18), this.mat("blur", "#202020", { transparent: true, opacity: 0.22, depthWrite: false }), [0, 0, 0], [Math.PI / 2, 0, 0]);
        // asas curtas com armamento
        this.add(g, this.box(0.1, 0.014, 0.44, 0.005), camo, [-0.02, -0.02, 0]);
        for (const z of [0.2, -0.2]) {
          if (kind === "heli") {
            this.add(g, this.cyl(0.03, 0.03, 0.16, 10), this.gunmetal, [-0.02, -0.055, z], [0, 0, Math.PI / 2]);
            this.add(g, this.sphere(0.03, 10, 8), this.gunmetal, [0.06, -0.055, z]);
          } else {
            this.add(g, this.box(0.14, 0.05, 0.05, 0.01), this.gunmetal, [-0.02, -0.055, z]);
          }
        }
        // canhão no nariz
        const gun = new THREE.Group();
        gun.position.set(0.24, -0.11, 0);
        g.add(gun);
        this.add(gun, this.sphere(0.03, 10, 8), this.gunmetal);
        if (kind === "tufao") for (let i = 0; i < 3; i++) this.add(gun, this.cyl(0.006, 0.006, 0.16, 6), this.gunmetal, [0.08, Math.cos(i * 2.1) * 0.012, Math.sin(i * 2.1) * 0.012], [0, 0, Math.PI / 2]);
        else this.add(gun, this.cyl(0.008, 0.008, 0.14, 6), this.gunmetal, [0.07, 0, 0], [0, 0, Math.PI / 2]);
        for (const z of [0.07, -0.07]) {
          this.add(g, this.box(0.36, 0.012, 0.012, 0.005), this.gunmetal, [0.02, -0.14, z]);
          for (const x of [0.1, -0.08]) this.add(g, this.box(0.01, 0.06, 0.01, 0.003), this.gunmetal, [x, -0.11, z]);
        }
        this.add(g, this.cyl(0.025, 0.03, 0.05, 10), this.gunmetal, [0.0, 0.14, 0]);
        const rot = this.part(g, "rotor1", [0.0, 0.175, 0]);
        const blades = kind === "tufao" ? 5 : 4;
        for (let i = 0; i < blades; i++) {
          const arm = new THREE.Group();
          arm.rotation.y = (i * Math.PI * 2) / blades;
          rot.add(arm);
          this.add(arm, this.box(0.62, 0.006, 0.045, 0.002), this.mat("blade", "#26282b", { roughness: 0.5, metalness: 0.4 }), [0.31, 0, 0]);
        }
        this.add(rot, this.cyl(0.62, 0.62, 0.002, 32), this.mat("blur", "#202020", { transparent: true, opacity: 0.22, depthWrite: false }));
        this.add(rot, this.cyl(0.03, 0.03, 0.025, 10), this.gunmetal);
        height = 0.32 * S;
        break;
      }
    }
    this.bake(root);
    const find = (n: string) => root.getObjectByName(n) ?? null;
    return { root, body: find("body")!, turret: find("turret"), barrel: find("barrel"), cargo: find("cargo"), rotors: [], legs: [], height };
  }

  // ------------------------------------------------------------ construções

  building(kind: BuildingKind, team: Team): BuildingModel {
    const key = `${kind}|${team}`;
    let tpl = this.bldTpl.get(key);
    if (!tpl) {
      tpl = this.buildBuilding(kind, team);
      this.bldTpl.set(key, tpl);
    }
    const root = tpl.root.clone(true);
    const find = (n: string) => root.getObjectByName(n) ?? null;
    return { root, inner: find("inner")!, spin: find("spin"), turret: find("turret"), barrel: find("barrel"), glow: tpl.glow, height: tpl.height };
  }

  // janelas em fileira numa parede (frente/lado)
  private windows(g: THREE.Object3D, cx: number, y: number, cz: number, along: "x" | "z", count: number, span: number, face: number) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * span;
      const [x, z] = along === "x" ? [cx + t, cz + face] : [cx + face, cz + t];
      const [w, d] = along === "x" ? [0.1, 0.02] : [0.02, 0.1];
      this.add(g, this.box(w, 0.08, d, 0.004), this.glass, [x, y, z]);
      this.add(g, this.box(along === "x" ? 0.12 : 0.03, 0.012, along === "x" ? 0.03 : 0.12, 0.003), this.concreteDark, [x, y - 0.048, z]);
    }
  }

  private flag(g: THREE.Object3D, team: Team, x: number, z: number, h = 0.9) {
    this.add(g, this.cyl(0.008, 0.01, h, 6), this.steel, [x, h / 2, z]);
    this.add(g, this.box(0.2, 0.12, 0.004, 0.001), this.team(team), [x + 0.105, h - 0.08, z]);
  }

  private buildBuilding(kind: BuildingKind, team: Team): BuildingModel {
    const root = new THREE.Group();
    const inner = this.part(root, "inner");
    let glow: THREE.MeshStandardMaterial | null = null;
    let height = 1;
    const wall = this.wall(team);
    const conc = this.concrete;
    const plinth = (w: number, d: number) => this.add(inner, this.box(w, 0.06, d, 0.02), this.concreteDark, [0, 0.03, 0]);

    switch (kind) {
      case "hq": {
        // centro de comando fortificado
        plinth(2.95, 2.95);
        this.add(inner, this.box(2.3, 0.62, 1.8, 0.02), wall, [-0.05, 0.37, -0.15]);
        this.add(inner, this.box(2.36, 0.06, 1.86, 0.01), conc, [-0.05, 0.7, -0.15]);
        this.add(inner, this.box(2.3, 0.04, 0.04, 0.005), this.team(team), [-0.05, 0.62, 0.755]);
        this.windows(inner, -0.05, 0.42, -0.15, "x", 9, 2.0, 0.91);
        this.windows(inner, -0.05, 0.42, -0.15, "z", 6, 1.4, 1.16);
        this.windows(inner, -0.05, 0.42, -0.15, "z", 6, 1.4, -1.16);
        // bloco superior e torre de comunicação
        this.add(inner, this.box(1.1, 0.38, 0.9, 0.02), wall, [-0.45, 0.92, -0.45]);
        this.add(inner, this.box(1.14, 0.04, 0.94, 0.01), conc, [-0.45, 1.12, -0.45]);
        this.add(inner, this.box(1.0, 0.1, 0.02, 0.004), this.glass, [-0.45, 0.98, 0.006]);
        for (const [x, z] of [[0.55, -0.6], [0.75, 0.2], [0.35, 0.3]] as [number, number][]) {
          this.add(inner, this.box(0.18, 0.1, 0.14, 0.01), this.steel, [x, 0.78, z]);
          this.add(inner, this.cyl(0.04, 0.04, 0.012, 14), this.gunmetal, [x, 0.835, z]);
        }
        const mx = 0.6;
        const mz = -0.55;
        for (const [dx, dz] of [[0.06, 0.06], [-0.06, 0.06], [0.06, -0.06], [-0.06, -0.06]] as [number, number][])
          this.add(inner, this.cyl(0.008, 0.012, 0.9, 5), this.steel, [mx + dx * 0.6, 1.15, mz + dz * 0.6], [dz * 0.15, 0, -dx * 0.15]);
        for (let i = 0; i < 4; i++) this.add(inner, this.box(0.1, 0.006, 0.006, 0.002), this.steel, [mx, 0.8 + i * 0.18, mz]);
        this.add(inner, this.sphere(0.02, 8, 6), this.lampRed, [mx, 1.62, mz]);
        this.add(inner, this.sphere(0.16, 18, 10, Math.PI * 2, Math.PI / 3), this.whitePaint, [-0.75, 1.2, -0.75], [0.6, 0.4, 0]);
        // entrada com marquise, sacos de areia e bandeira
        this.add(inner, this.box(0.5, 0.3, 0.06, 0.01), this.dark, [-0.05, 0.21, 0.76]);
        this.add(inner, this.box(0.7, 0.04, 0.3, 0.01), conc, [-0.05, 0.4, 0.85]);
        for (const x of [-0.35, 0.25]) this.add(inner, this.box(0.05, 0.36, 0.05, 0.01), conc, [x, 0.2, 0.97]);
        this.sandbagRow(inner, -1.35, 1.3, -0.6, 1.3);
        this.sandbagRow(inner, 0.5, 1.3, 1.35, 1.3);
        this.sandbagRow(inner, 1.35, 1.3, 1.35, 0.6);
        this.flag(inner, team, 1.2, 1.15, 1.1);
        this.crate(inner, -1.2, 1.05, 0.12, 0.3);
        this.crate(inner, -1.05, 1.1, 0.1, 0.8);
        height = 1.65;
        break;
      }
      case "power": {
        plinth(1.95, 1.95);
        // torres de resfriamento hiperbólicas
        const tower = this.lathe("cool", [[0.0, 0], [0.34, 0], [0.3, 0.2], [0.24, 0.45], [0.22, 0.6], [0.24, 0.78], [0.26, 0.82], [0.25, 0.82], [0.23, 0.78], [0.21, 0.6]]);
        const steam: { x: number; y: number; z: number }[] = [];
        for (const [x, z] of [[-0.45, -0.4], [0.35, -0.5]] as [number, number][]) {
          this.add(inner, tower, conc, [x, 0.06, z]);
          this.add(inner, this.cyl(0.21, 0.21, 0.01, 20), this.dark, [x, 0.84, z]);
          steam.push({ x, y: 0.95, z });
        }
        // casa de máquinas e subestação
        this.add(inner, this.box(0.7, 0.32, 0.4, 0.015), wall, [-0.3, 0.22, 0.45]);
        this.add(inner, this.box(0.74, 0.03, 0.44, 0.008), this.roof, [-0.3, 0.395, 0.45]);
        this.windows(inner, -0.3, 0.26, 0.45, "x", 4, 0.5, 0.21);
        for (let i = 0; i < 3; i++) {
          this.add(inner, this.box(0.13, 0.16, 0.1, 0.01), this.steel, [0.32 + (i % 2) * 0.2, 0.14, 0.2 + Math.floor(i / 2) * 0.35]);
          for (let k = 0; k < 3; k++) this.add(inner, this.cyl(0.01, 0.014, 0.08, 6), this.mat("ceramic", "#8a6f5a", { roughness: 0.4 }), [0.28 + (i % 2) * 0.2 + k * 0.04, 0.26, 0.2 + Math.floor(i / 2) * 0.35]);
        }
        this.add(inner, this.cyl(0.03, 0.03, 0.9, 10), this.steel, [-0.05, 0.3, -0.05], [0, 0, Math.PI / 2]);
        glow = this.mat(`warn${team}`, "#ff4a3a", { emissive: "#ff2a1a", emissiveIntensity: 1.2, roughness: 0.4 });
        for (const [x, z] of [[-0.45, -0.4], [0.35, -0.5]] as [number, number][]) this.add(inner, this.sphere(0.02, 8, 6), glow, [x + 0.25, 0.86, z]);
        this.add(inner, this.box(0.4, 0.03, 0.03, 0.005), this.team(team), [-0.3, 0.36, 0.67]);
        root.userData.steam = steam;
        height = 1.0;
        break;
      }
      case "refinery": {
        plinth(2.95, 2.95);
        for (const [x, z, r] of [[-0.85, -0.85, 0.36], [-0.05, -0.95, 0.3], [-0.95, -0.05, 0.3]] as V3[]) {
          this.add(inner, this.cyl(r, r, 0.62, 24), this.steel, [x, 0.37, z]);
          this.add(inner, this.sphere(r, 24, 8, Math.PI * 2, Math.PI / 2), this.steel, [x, 0.68, z], [0, 0, 0], [1, 0.35, 1]);
          this.add(inner, this.torus(r + 0.005, 0.012), this.team(team), [x, 0.5, z], [Math.PI / 2, 0, 0]);
          this.add(inner, this.cyl(0.006, 0.006, 0.6, 5), this.gunmetal, [x + r + 0.02, 0.38, z]);
        }
        this.add(inner, this.box(1.1, 0.5, 0.8, 0.015), wall, [0.6, 0.31, -0.5]);
        this.add(inner, this.box(1.14, 0.03, 0.84, 0.008), this.roof, [0.6, 0.575, -0.5]);
        this.windows(inner, 0.6, 0.38, -0.5, "x", 6, 0.8, 0.41);
        this.add(inner, this.cyl(0.15, 0.15, 0.3, 18), this.glass, [0.6, 0.73, -0.5]);
        this.add(inner, this.cyl(0.12, 0.12, 0.26, 18), this.crystal, [0.6, 0.73, -0.5]);
        // tubulação
        this.add(inner, this.cyl(0.04, 0.04, 1.3, 10), this.steel, [-0.3, 0.3, -0.3], [0, Math.PI / 4, Math.PI / 2]);
        this.add(inner, this.cyl(0.035, 0.035, 0.9, 10), this.steel, [0.05, 0.55, -0.85], [0, 0, Math.PI / 2]);
        for (const x of [-0.5, 0.0, 0.4]) this.add(inner, this.cyl(0.012, 0.012, 0.5, 6), this.gunmetal, [x, 0.25, -0.85]);
        // doca de descarga na frente
        this.add(inner, this.box(1.0, 0.04, 0.9, 0.01), this.concreteDark, [0, 0.07, 0.95]);
        for (let i = 0; i < 6; i++) this.add(inner, this.box(0.08, 0.005, 0.12, 0.002), i % 2 ? this.dark : this.hazard, [-0.4 + i * 0.16, 0.093, 0.5]);
        this.add(inner, this.box(1.1, 0.4, 0.05, 0.01), this.steel, [0, 0.27, 0.45]);
        this.add(inner, this.box(0.6, 0.25, 0.06, 0.01), this.dark, [0, 0.19, 0.47]);
        this.barrel(inner, 1.15, 0.7);
        this.barrel(inner, 1.22, 0.78);
        this.barrel(inner, 1.12, 0.85);
        height = 1.4;
        break;
      }
      case "barracks": {
        plinth(1.95, 1.95);
        // galpão em arco (chapa corrugada)
        const hut = this.geo("quonset", () => {
          const g = new THREE.CylinderGeometry(0.55, 0.55, 1.4, 28, 1, true, -Math.PI / 2, Math.PI);
          g.rotateZ(Math.PI / 2);
          g.rotateY(Math.PI / 2);
          return g;
        });
        this.add(inner, hut, this.mat(`hutpaint${team}`, "#ffffff", { map: this.tex.corrugated(this.colorsOf(team).camo[0], 43), roughness: 0.7, metalness: 0.15 }), [0, 0.06, -0.15]);
        for (const z of [0.55, -0.85]) this.add(inner, this.cyl(0.55, 0.55, 0.03, 28, false), wall, [0, 0.06, z], [Math.PI / 2, 0, 0], [1, 1, 1]);
        this.add(inner, this.box(0.26, 0.34, 0.03, 0.006), this.wood, [0, 0.23, 0.57]);
        for (const x of [-0.3, 0.3]) this.add(inner, this.box(0.12, 0.1, 0.02, 0.004), this.glass, [x, 0.34, 0.565]);
        this.add(inner, this.box(0.4, 0.03, 0.2, 0.006), this.roof, [0, 0.43, 0.66]);
        this.sandbagRow(inner, -0.9, 0.85, -0.25, 0.85);
        this.sandbagRow(inner, 0.25, 0.85, 0.9, 0.85);
        this.flag(inner, team, 0.8, -0.8, 0.85);
        this.crate(inner, -0.8, 0.55, 0.12, 0.4);
        this.crate(inner, -0.68, 0.6, 0.1, 0.9);
        this.barrel(inner, 0.75, 0.55);
        height = 0.85;
        break;
      }
      case "factory": {
        plinth(2.95, 2.95);
        const walls = this.mat(`factorywall${team}`, "#ffffff", { map: this.tex.corrugated(this.colorsOf(team).structure, 47), roughness: 0.7, metalness: 0.15 });
        walls.userData.uvScale = 1.6;
        this.add(inner, this.box(2.5, 0.75, 2.0, 0.01), walls, [0, 0.43, -0.2]);
        // telhado em dente de serra
        for (let i = 0; i < 4; i++) {
          const z = -0.95 + i * 0.5;
          this.add(inner, this.side("saw", [[-0.25, 0], [0.25, 0], [0.25, 0.22]], 2.5, 0.004), this.roof, [0, 0.8, z], [0, Math.PI / 2, 0]);
          this.add(inner, this.box(2.48, 0.19, 0.012, 0.003), this.glass, [0, 0.9, z - 0.244]);
        }
        // portão de rolar e faixas de sinalização
        this.add(inner, this.box(1.1, 0.58, 0.04, 0.006), this.steel, [0, 0.35, 0.81]);
        for (let i = 0; i < 9; i++) this.add(inner, this.box(1.06, 0.008, 0.012, 0.002), this.gunmetal, [0, 0.1 + i * 0.065, 0.835]);
        for (let i = 0; i < 8; i++) this.add(inner, this.box(0.1, 0.004, 0.25, 0.002), i % 2 ? this.dark : this.hazard, [-0.42 + i * 0.12, 0.062, 1.05]);
        this.add(inner, this.box(2.52, 0.05, 0.05, 0.006), this.team(team), [0, 0.76, 0.8]);
        // ponte rolante lateral e chaminés
        for (const z of [0.4, -0.8]) this.add(inner, this.box(0.06, 0.6, 0.06, 0.006), this.steel, [1.32, 0.33, z]);
        this.add(inner, this.box(0.06, 0.06, 1.3, 0.006), this.hazard, [1.32, 0.64, -0.2]);
        for (const x of [-1.0, -0.75]) this.add(inner, this.cyl(0.05, 0.06, 0.5, 12), this.steel, [x, 1.05, -1.05]);
        this.crate(inner, 1.2, 1.1, 0.14, 0.2);
        this.crate(inner, 1.05, 1.2, 0.12, 0.7);
        this.barrel(inner, -1.25, 1.15);
        this.barrel(inner, -1.17, 1.22);
        height = 1.3;
        break;
      }
      case "radar": {
        plinth(1.95, 1.95);
        this.add(inner, this.box(0.9, 0.4, 0.7, 0.015), wall, [-0.3, 0.26, 0.35]);
        this.add(inner, this.box(0.94, 0.03, 0.74, 0.008), conc, [-0.3, 0.475, 0.35]);
        this.windows(inner, -0.3, 0.3, 0.35, "x", 5, 0.65, 0.36);
        this.add(inner, this.box(0.9, 0.03, 0.03, 0.005), this.team(team), [-0.3, 0.44, 0.71]);
        // torre treliçada
        const tx = 0.35;
        const tz = -0.35;
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][])
          this.add(inner, this.cyl(0.01, 0.014, 1.0, 5), this.steel, [tx + dx * 0.11, 0.55, tz + dz * 0.11], [dz * 0.1, 0, -dx * 0.1]);
        for (let i = 0; i < 5; i++) {
          const y = 0.15 + i * 0.2;
          const w = 0.28 - i * 0.035;
          for (const r of [0, Math.PI / 2]) this.add(inner, this.box(w, 0.008, 0.008, 0.002), this.steel, [tx, y, tz], [0, r, 0]);
        }
        this.add(inner, this.box(0.16, 0.06, 0.16, 0.01), this.gunmetal, [tx, 1.06, tz]);
        const s = this.part(inner, "spin", [tx, 1.12, tz]);
        this.add(s, this.cyl(0.03, 0.03, 0.06, 10), this.gunmetal, [0, 0.03, 0]);
        // antena retangular em grade
        this.add(s, this.box(0.05, 0.22, 0.56, 0.006), this.whitePaint, [0.03, 0.14, 0], [0, 0, -0.25]);
        for (let i = 0; i < 6; i++) this.add(s, this.box(0.055, 0.006, 0.54, 0.002), this.gunmetal, [0.03, 0.05 + i * 0.035, 0], [0, 0, -0.25]);
        this.add(inner, this.sphere(0.02, 8, 6), this.lampRed, [tx, 1.4, tz]);
        height = 1.5;
        break;
      }
      case "turret":
      case "inferno":
      case "aa": {
        // casamata de concreto com sacos de areia
        this.add(inner, this.top("pillbox", [[0.38, 0.16], [0.16, 0.38], [-0.16, 0.38], [-0.38, 0.16], [-0.38, -0.16], [-0.16, -0.38], [0.16, -0.38], [0.38, -0.16]], 0.24), conc);
        this.add(inner, this.cyl(0.3, 0.32, 0.04, 20), this.concreteDark, [0, 0.27, 0]);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.2;
          if (i === 2) continue;
          this.sandbagRow(inner, Math.cos(a) * 0.46, Math.sin(a) * 0.46, Math.cos(a + 0.75) * 0.46, Math.sin(a + 0.75) * 0.46, 1);
        }
        const t = this.part(inner, "turret", [0, 0.31, 0]);
        if (kind === "turret") {
          this.add(t, this.top("turHead", [[0.2, 0.08], [0.1, 0.17], [-0.16, 0.17], [-0.2, 0.08], [-0.2, -0.08], [-0.16, -0.17], [0.1, -0.17], [0.2, -0.08]], 0.15), this.camo(team));
          this.insignia(t, team, 0, 0.08, 0.172, 0, 0.9);
          const b = this.part(t, "barrel", [0.19, 0.075, 0]);
          this.add(b, this.cyl(0.02, 0.025, 0.42, 12), this.gunmetal, [0.21, 0, 0], [0, 0, Math.PI / 2]);
          this.add(b, this.box(0.04, 0.035, 0.035, 0.004), this.gunmetal, [0.43, 0, 0]);
          height = 0.75;
        } else if (kind === "inferno") {
          this.add(t, this.sphere(0.17, 16, 10, Math.PI * 2, Math.PI / 2), this.camo(team));
          this.insignia(t, team, 0, 0.07, 0.16, 0, 0.8);
          for (const z of [0.12, -0.12]) this.add(t, this.capsule(0.05, 0.14), this.steel, [-0.15, 0.08, z], [Math.PI / 2, 0, 0]);
          const b = this.part(t, "barrel", [0.15, 0.06, 0]);
          this.add(b, this.cyl(0.025, 0.04, 0.3, 12), this.gunmetal, [0.15, 0, 0], [0, 0, Math.PI / 2]);
          glow = this.mat(`pilot${team}`, "#ffb347", { emissive: "#ff7a00", emissiveIntensity: 1.6 });
          this.add(b, this.sphere(0.02, 8, 6), glow, [0.31, 0, 0]);
          height = 0.7;
        } else {
          this.add(t, this.box(0.26, 0.12, 0.24, 0.02), this.camo(team), [0, 0.06, 0]);
          this.insignia(t, team, 0, 0.07, 0.122, 0, 0.8);
          this.add(t, this.box(0.04, 0.05, 0.3, 0.01), this.gunmetal, [-0.04, 0.12, 0]);
          const b = this.part(t, "barrel", [0.05, 0.12, 0]);
          b.rotation.z = 0.75;
          for (const z of [0.07, -0.07]) {
            this.add(b, this.cyl(0.016, 0.02, 0.5, 10), this.gunmetal, [0.25, 0, z], [0, 0, Math.PI / 2]);
            this.add(b, this.cyl(0.024, 0.024, 0.05, 10), this.gunmetal, [0.47, 0, z], [0, 0, Math.PI / 2]);
          }
          height = 0.9;
        }
        break;
      }
      case "helipad": {
        plinth(1.95, 1.95);
        this.add(inner, this.cyl(0.8, 0.82, 0.04, 36), this.concreteDark, [0, 0.08, 0]);
        this.add(inner, this.torus(0.68, 0.018), this.hazard, [0, 0.102, 0], [Math.PI / 2, 0, 0]);
        for (const x of [-0.16, 0.16]) this.add(inner, this.box(0.06, 0.005, 0.5, 0.002), this.whitePaint, [x, 0.103, 0]);
        this.add(inner, this.box(0.3, 0.005, 0.06, 0.002), this.whitePaint, [0, 0.103, 0]);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          this.add(inner, this.sphere(0.018, 8, 6), this.lampWhite, [Math.cos(a) * 0.82, 0.1, Math.sin(a) * 0.82]);
        }
        // torre de controle
        this.add(inner, this.box(0.24, 0.5, 0.24, 0.01), wall, [-0.78, 0.31, -0.78]);
        this.add(inner, this.box(0.3, 0.14, 0.3, 0.01), this.glass, [-0.78, 0.63, -0.78]);
        this.add(inner, this.box(0.34, 0.03, 0.34, 0.008), conc, [-0.78, 0.715, -0.78]);
        this.add(inner, this.sphere(0.02, 8, 6), this.lampRed, [-0.78, 0.76, -0.78]);
        // biruta
        this.add(inner, this.cyl(0.006, 0.006, 0.4, 5), this.steel, [0.85, 0.26, -0.85]);
        this.add(inner, this.cyl(0.02, 0.035, 0.14, 8, true), this.mat("sock", "#ff7a1a", { roughness: 0.7, side: THREE.DoubleSide }), [0.92, 0.43, -0.85], [0, 0, Math.PI / 2]);
        this.add(inner, this.box(0.4, 0.03, 0.03, 0.005), this.team(team), [-0.78, 0.55, -0.64]);
        height = 0.85;
        break;
      }
    }
    this.bake(root);
    return { root, inner: root.getObjectByName("inner")!, spin: root.getObjectByName("spin") ?? null, turret: root.getObjectByName("turret") ?? null, barrel: root.getObjectByName("barrel") ?? null, glow, height };
  }

  // Usado pelas nascentes de cristal e minério no mapa.
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// Projeção de UV por caixa (escolhe o plano pela normal), em unidades do modelo.
function boxUV(g: THREE.BufferGeometry, scale: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x * scale, z * scale);
    else if (nx >= nz) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true;
}
