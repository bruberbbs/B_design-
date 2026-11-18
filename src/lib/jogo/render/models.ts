// Modelos 3D arredondados, montados com primitivas. Unidades olham para +x.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TEAM_COLORS, type BuildingKind, type Team, type UnitKind } from "../defs";

export type MatPatcher = (m: THREE.Material) => void;

export interface UnitModel {
  root: THREE.Group;
  body: THREE.Group;
  turret: THREE.Object3D | null;
  barrel: THREE.Object3D | null;
  cargo: THREE.Object3D | null;
  height: number;
}

export interface BuildingModel {
  root: THREE.Group;
  inner: THREE.Group;
  spin: THREE.Object3D | null;
  turret: THREE.Object3D | null;
  barrel: THREE.Object3D | null;
  glow: THREE.MeshStandardMaterial | null;
  height: number;
}

export class ModelKit {
  private geos = new Map<string, THREE.BufferGeometry>();
  private mats = new Map<string, THREE.Material>();

  constructor(private patch: MatPatcher) {}

  geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geos.get(key);
    if (!g) {
      g = make();
      this.geos.set(key, g);
    }
    return g as T;
  }

  rbox(w: number, h: number, d: number, r = 0.05) {
    return this.geo(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)));
  }

  sphere(r: number, ws = 16, hs = 12, phiLen = Math.PI * 2, thetaLen = Math.PI) {
    return this.geo(`sp${r},${ws},${hs},${phiLen},${thetaLen}`, () => new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen));
  }

  cyl(rt: number, rb: number, h: number, seg = 16) {
    return this.geo(`cy${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  }

  capsule(r: number, len: number) {
    return this.geo(`ca${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 12));
  }

  torus(r: number, t: number) {
    return this.geo(`to${r},${t}`, () => new THREE.TorusGeometry(r, t, 8, 24));
  }

  mat(key: string, color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const k = `${key}|${color}`;
    let m = this.mats.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, ...opts });
      this.patch(m);
      this.mats.set(k, m);
    }
    return m as THREE.MeshStandardMaterial;
  }

  team(team: Team, shade: "main" | "dark" | "light") {
    return this.mat(`team${shade}`, TEAM_COLORS[team][shade], { roughness: 0.45 });
  }

  get steel() {
    return this.mat("steel", "#d6dae1", { roughness: 0.4, metalness: 0.2 });
  }
  get darkSteel() {
    return this.mat("dsteel", "#545b66", { roughness: 0.5, metalness: 0.25 });
  }
  get tread() {
    return this.mat("tread", "#2c3037", { roughness: 0.8 });
  }
  get white() {
    return this.mat("white", "#f4f1e8", { roughness: 0.6 });
  }
  get concrete() {
    return this.mat("concrete", "#c3bcae", { roughness: 0.85 });
  }
  get skin() {
    return this.mat("skin", "#f1c7a0", { roughness: 0.7 });
  }
  get glass() {
    return this.mat("glass", "#9be7ff", { roughness: 0.15, metalness: 0.3, emissive: "#2aa6d8", emissiveIntensity: 0.35 });
  }
  get gold() {
    return this.mat("gold", "#f6c445", { roughness: 0.35, metalness: 0.35 });
  }
  get crystal() {
    return this.mat("crystal", "#5ff0d0", { roughness: 0.2, metalness: 0.1, emissive: "#19b89a", emissiveIntensity: 0.55 });
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // ------------------------------------------------------------ unidades

  unit(kind: UnitKind, team: Team): UnitModel {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    let turret: THREE.Object3D | null = null;
    let barrel: THREE.Object3D | null = null;
    let cargo: THREE.Object3D | null = null;
    let height = 0.5;
    const main = this.team(team, "main");
    const dark = this.team(team, "dark");
    const light = this.team(team, "light");

    const soldier = (rocket: boolean) => {
      body.add(this.mesh(this.capsule(0.055, 0.1), this.tread, 0, 0.09, 0.045));
      body.add(this.mesh(this.capsule(0.055, 0.1), this.tread, 0, 0.09, -0.045));
      body.add(this.mesh(this.capsule(0.085, 0.1), main, 0, 0.24, 0));
      body.add(this.mesh(this.sphere(0.065), this.skin, 0.01, 0.37, 0));
      const helmet = this.mesh(this.sphere(0.075, 16, 8, Math.PI * 2, Math.PI / 2), dark, 0.0, 0.385, 0);
      body.add(helmet);
      if (rocket) {
        const tube = this.mesh(this.cyl(0.04, 0.04, 0.36, 12), this.darkSteel, 0.02, 0.36, -0.09);
        tube.rotation.z = Math.PI / 2;
        body.add(tube);
        body.add(this.mesh(this.sphere(0.042), main, 0.2, 0.36, -0.09));
      } else {
        const gun = this.mesh(this.rbox(0.26, 0.04, 0.04, 0.015), this.darkSteel, 0.13, 0.24, -0.07);
        body.add(gun);
      }
      height = 0.45;
    };

    switch (kind) {
      case "rifle":
        soldier(false);
        break;
      case "rocket":
        soldier(true);
        break;
      case "scout": {
        body.add(this.mesh(this.rbox(0.62, 0.16, 0.38, 0.07), main, 0, 0.17, 0));
        body.add(this.mesh(this.rbox(0.26, 0.12, 0.3, 0.06), this.glass, 0.02, 0.29, 0));
        for (const [x, z] of [
          [0.2, 0.2],
          [-0.2, 0.2],
          [0.2, -0.2],
          [-0.2, -0.2],
        ]) {
          const wh = this.mesh(this.cyl(0.085, 0.085, 0.07, 14), this.tread, x, 0.085, z);
          wh.rotation.x = Math.PI / 2;
          body.add(wh);
        }
        const t = new THREE.Group();
        t.position.set(-0.12, 0.35, 0);
        t.add(this.mesh(this.sphere(0.07), dark, 0, 0, 0));
        const b = new THREE.Group();
        const bm = this.mesh(this.cyl(0.022, 0.022, 0.22, 8), this.darkSteel, 0.11, 0.02, 0);
        bm.rotation.z = Math.PI / 2;
        b.add(bm);
        t.add(b);
        body.add(t);
        turret = t;
        barrel = b;
        height = 0.5;
        break;
      }
      case "tank":
      case "heavy": {
        const s = kind === "heavy" ? 1.25 : 1;
        for (const z of [0.21 * s, -0.21 * s]) {
          body.add(this.mesh(this.rbox(0.82 * s, 0.17 * s, 0.17 * s, 0.08 * s), this.tread, 0, 0.09 * s, z));
        }
        body.add(this.mesh(this.rbox(0.74 * s, 0.17 * s, 0.4 * s, 0.07 * s), main, 0, 0.22 * s, 0));
        body.add(this.mesh(this.rbox(0.2 * s, 0.05 * s, 0.42 * s, 0.025 * s), light, 0.28 * s, 0.3 * s, 0));
        const t = new THREE.Group();
        t.position.set(-0.04 * s, 0.35 * s, 0);
        const dome = this.mesh(this.sphere(0.19 * s, 18, 12), dark, 0, 0, 0);
        dome.scale.set(1.1, 0.6, 1);
        t.add(dome);
        t.add(this.mesh(this.cyl(0.05 * s, 0.05 * s, 0.05 * s, 12), light, -0.05 * s, 0.11 * s, 0.05 * s));
        const b = new THREE.Group();
        const offs = kind === "heavy" ? [0.06 * s, -0.06 * s] : [0];
        for (const z of offs) {
          const bm = this.mesh(this.cyl(0.035 * s, 0.04 * s, 0.42 * s, 10), this.darkSteel, 0.33 * s, 0.01, z);
          bm.rotation.z = Math.PI / 2;
          b.add(bm);
          b.add(this.mesh(this.sphere(0.045 * s, 10, 8), this.darkSteel, 0.54 * s, 0.01, z));
        }
        t.add(b);
        body.add(t);
        turret = t;
        barrel = b;
        height = 0.55 * s;
        break;
      }
      case "artillery": {
        for (const z of [0.2, -0.2]) body.add(this.mesh(this.rbox(0.78, 0.15, 0.15, 0.07), this.tread, 0, 0.08, z));
        body.add(this.mesh(this.rbox(0.7, 0.15, 0.38, 0.06), main, 0, 0.2, 0));
        const t = new THREE.Group();
        t.position.set(-0.12, 0.3, 0);
        t.add(this.mesh(this.rbox(0.36, 0.16, 0.3, 0.07), dark, 0, 0.04, 0));
        const b = new THREE.Group();
        b.position.set(0.1, 0.08, 0);
        b.rotation.z = 0.5;
        const bm = this.mesh(this.cyl(0.04, 0.05, 0.62, 10), this.darkSteel, 0.31, 0, 0);
        bm.rotation.z = Math.PI / 2;
        b.add(bm);
        b.add(this.mesh(this.torus(0.05, 0.018), light, 0.6, 0, 0));
        t.add(b);
        body.add(t);
        turret = t;
        barrel = b;
        height = 0.6;
        break;
      }
      case "harvester": {
        for (const z of [0.25, -0.25]) body.add(this.mesh(this.rbox(0.9, 0.18, 0.18, 0.08), this.tread, 0, 0.1, z));
        body.add(this.mesh(this.rbox(0.92, 0.18, 0.56, 0.08), this.gold, 0, 0.25, 0));
        body.add(this.mesh(this.rbox(0.28, 0.24, 0.5, 0.09), main, 0.3, 0.44, 0));
        body.add(this.mesh(this.rbox(0.08, 0.13, 0.42, 0.04), this.glass, 0.44, 0.47, 0));
        const bin = this.mesh(this.rbox(0.56, 0.2, 0.52, 0.08), dark, -0.16, 0.43, 0);
        body.add(bin);
        const c = new THREE.Group();
        for (const [x, z, s] of [
          [-0.25, 0.1, 1],
          [-0.08, -0.1, 0.8],
          [-0.2, -0.12, 0.9],
          [-0.05, 0.12, 0.7],
        ]) {
          const g = this.mesh(this.geo("gem", () => new THREE.OctahedronGeometry(0.1, 0)), this.crystal, x, 0.55, z);
          g.scale.setScalar(s);
          g.rotation.set(0.4, x * 3, 0.2);
          c.add(g);
        }
        body.add(c);
        cargo = c;
        const scoop = this.mesh(this.rbox(0.14, 0.12, 0.6, 0.05), this.darkSteel, 0.52, 0.14, 0);
        body.add(scoop);
        body.add(this.mesh(this.cyl(0.04, 0.05, 0.22, 10), this.darkSteel, -0.3, 0.62, -0.18));
        height = 0.7;
        break;
      }
    }
    return { root, body, turret, barrel, cargo, height };
  }

  // ------------------------------------------------------------ construções

  building(kind: BuildingKind, team: Team): BuildingModel {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    let spin: THREE.Object3D | null = null;
    let turret: THREE.Object3D | null = null;
    let barrel: THREE.Object3D | null = null;
    let glow: THREE.MeshStandardMaterial | null = null;
    let height = 1;
    const main = this.team(team, "main");
    const dark = this.team(team, "dark");
    const light = this.team(team, "light");
    const pad = (pw: number, ph: number) => inner.add(this.mesh(this.rbox(pw, 0.12, ph, 0.06), this.concrete, 0, 0.06, 0));

    switch (kind) {
      case "hq": {
        pad(2.9, 2.9);
        inner.add(this.mesh(this.rbox(2.3, 0.75, 2.1, 0.22), this.white, -0.05, 0.48, -0.1));
        inner.add(this.mesh(this.rbox(2.36, 0.12, 2.16, 0.06), main, -0.05, 0.62, -0.1));
        const dome = this.mesh(this.sphere(0.72, 24, 14, Math.PI * 2, Math.PI / 2), main, -0.15, 0.85, -0.2);
        inner.add(dome);
        inner.add(this.mesh(this.torus(0.72, 0.06), dark, -0.15, 0.86, -0.2).rotateX(Math.PI / 2));
        inner.add(this.mesh(this.rbox(0.7, 0.42, 0.14, 0.08), dark, 0, 0.32, 0.95));
        inner.add(this.mesh(this.rbox(0.5, 0.06, 0.6, 0.03), this.glass, 0.65, 0.86, 0.45));
        const mast = new THREE.Group();
        mast.position.set(0.75, 0.85, -0.75);
        mast.add(this.mesh(this.cyl(0.03, 0.04, 0.8, 8), this.darkSteel, 0, 0.4, 0));
        mast.add(this.mesh(this.sphere(0.07), this.mat("beacon", "#ffef8a", { emissive: "#ffd23a", emissiveIntensity: 1 }), 0, 0.82, 0));
        inner.add(mast);
        const flag = this.mesh(this.rbox(0.36, 0.22, 0.02, 0.01), main, 0.93, 1.45, -0.75);
        inner.add(flag);
        height = 1.6;
        break;
      }
      case "power": {
        pad(1.9, 1.9);
        for (const [x, z] of [
          [-0.42, -0.35],
          [0.38, -0.42],
        ]) {
          inner.add(this.mesh(this.cyl(0.3, 0.4, 0.95, 20), this.white, x, 0.6, z));
          inner.add(this.mesh(this.torus(0.33, 0.04), main, x, 0.65, z).rotateX(Math.PI / 2));
          inner.add(this.mesh(this.cyl(0.24, 0.24, 0.02, 20), this.darkSteel, x, 1.08, z));
        }
        const core = this.mat(`core${team}`, "#ffe27a", { emissive: "#ffb300", emissiveIntensity: 0.9 });
        glow = core;
        const c = this.mesh(this.sphere(0.24), core, 0.15, 0.38, 0.45);
        inner.add(c);
        inner.add(this.mesh(this.torus(0.26, 0.05), dark, 0.15, 0.38, 0.45).rotateX(Math.PI / 2));
        inner.add(this.mesh(this.rbox(0.5, 0.26, 0.4, 0.08), main, -0.45, 0.25, 0.5));
        height = 1.2;
        break;
      }
      case "refinery": {
        pad(2.9, 2.9);
        inner.add(this.mesh(this.cyl(0.62, 0.62, 0.9, 24), this.gold, -0.55, 0.57, -0.55));
        inner.add(this.mesh(this.sphere(0.62, 24, 12, Math.PI * 2, Math.PI / 2), this.gold, -0.55, 1.02, -0.55));
        inner.add(this.mesh(this.torus(0.63, 0.05), main, -0.55, 0.75, -0.55).rotateX(Math.PI / 2));
        inner.add(this.mesh(this.rbox(1.2, 0.7, 1.0, 0.18), this.white, 0.65, 0.45, -0.45));
        inner.add(this.mesh(this.rbox(1.24, 0.1, 1.04, 0.05), main, 0.65, 0.7, -0.45));
        const crystalCol = this.mesh(this.cyl(0.18, 0.18, 0.5, 16), this.crystal, 0.65, 0.95, -0.45);
        inner.add(crystalCol);
        const pipe = this.mesh(this.cyl(0.07, 0.07, 1.1, 10), this.darkSteel, 0.05, 0.5, -0.5);
        pipe.rotation.z = Math.PI / 2;
        inner.add(pipe);
        // doca na frente
        inner.add(this.mesh(this.rbox(1.0, 0.08, 1.0, 0.04), dark, 0, 0.13, 0.85));
        inner.add(this.mesh(this.rbox(0.9, 0.03, 0.12, 0.015), this.mat("stripe", "#ffd84a"), 0, 0.18, 0.4));
        height = 1.6;
        break;
      }
      case "barracks": {
        pad(1.9, 1.9);
        const hut = this.mesh(
          this.geo("hut", () => new THREE.CylinderGeometry(0.62, 0.62, 1.4, 24, 1, false, 0, Math.PI)),
          main,
          0,
          0.12,
          -0.05,
        );
        hut.rotation.z = Math.PI / 2;
        hut.rotation.y = Math.PI / 2;
        inner.add(hut);
        inner.add(this.mesh(this.rbox(0.36, 0.4, 0.06, 0.05), dark, 0, 0.32, 0.66));
        for (const [x, z] of [
          [-0.75, 0.75],
          [-0.55, 0.82],
          [0.62, 0.78],
          [0.78, 0.6],
        ]) {
          const sb = this.mesh(this.capsule(0.07, 0.12), this.mat("sand", "#c8a874"), x, 0.17, z);
          sb.rotation.z = Math.PI / 2;
          sb.rotation.y = Math.atan2(z, x);
          inner.add(sb);
        }
        const flagPole = this.mesh(this.cyl(0.02, 0.02, 0.9, 6), this.darkSteel, 0.7, 0.55, -0.7);
        inner.add(flagPole);
        inner.add(this.mesh(this.rbox(0.3, 0.18, 0.02, 0.01), light, 0.86, 0.9, -0.7));
        height = 1.0;
        break;
      }
      case "factory": {
        pad(2.9, 2.9);
        inner.add(this.mesh(this.rbox(2.5, 0.65, 2.2, 0.15), this.white, 0, 0.42, -0.2));
        const roof = this.mesh(
          this.geo("roof", () => new THREE.CylinderGeometry(1.1, 1.1, 2.2, 28, 1, false, 0, Math.PI)),
          main,
          0,
          0.74,
          -0.2,
        );
        roof.rotation.z = Math.PI / 2;
        roof.rotation.y = Math.PI / 2;
        roof.scale.set(0.45, 1, 1.1);
        inner.add(roof);
        inner.add(this.mesh(this.rbox(1.2, 0.62, 0.08, 0.05), this.darkSteel, 0, 0.42, 0.92));
        for (let i = 0; i < 4; i++) inner.add(this.mesh(this.rbox(1.16, 0.025, 0.02, 0.01), this.tread, 0, 0.2 + i * 0.13, 0.965));
        inner.add(this.mesh(this.cyl(0.13, 0.16, 0.9, 14), this.darkSteel, -0.95, 1.0, -0.95));
        inner.add(this.mesh(this.torus(0.15, 0.04), main, -0.95, 1.42, -0.95).rotateX(Math.PI / 2));
        inner.add(this.mesh(this.rbox(0.9, 0.06, 0.12, 0.02), this.mat("stripe", "#ffd84a"), 0, 0.15, 1.25));
        height = 1.5;
        break;
      }
      case "radar": {
        pad(1.9, 1.9);
        inner.add(this.mesh(this.rbox(1.3, 0.5, 1.3, 0.15), this.white, 0, 0.35, 0));
        inner.add(this.mesh(this.rbox(1.34, 0.08, 1.34, 0.04), main, 0, 0.5, 0));
        inner.add(this.mesh(this.cyl(0.08, 0.12, 0.5, 10), this.darkSteel, 0, 0.8, 0));
        const s = new THREE.Group();
        s.position.set(0, 1.05, 0);
        const dish = this.mesh(this.sphere(0.55, 24, 10, Math.PI * 2, Math.PI / 3.2), this.steel, 0, 0, 0);
        dish.rotation.z = Math.PI / 2 + 0.5;
        dish.position.set(-0.3, 0.1, 0);
        dish.material = this.mat("dish", "#e6e9ee", { side: THREE.DoubleSide, roughness: 0.35, metalness: 0.25 });
        this.patch(dish.material as THREE.Material);
        s.add(dish);
        s.add(this.mesh(this.sphere(0.07), main, 0.12, 0.16, 0));
        inner.add(s);
        spin = s;
        height = 1.5;
        break;
      }
      case "turret": {
        inner.add(this.mesh(this.cyl(0.42, 0.48, 0.3, 20), this.concrete, 0, 0.15, 0));
        inner.add(this.mesh(this.torus(0.42, 0.05), dark, 0, 0.3, 0).rotateX(Math.PI / 2));
        const t = new THREE.Group();
        t.position.set(0, 0.42, 0);
        const dome = this.mesh(this.sphere(0.3, 20, 12), main, 0, 0, 0);
        dome.scale.set(1, 0.75, 1);
        t.add(dome);
        const b = new THREE.Group();
        const bm = this.mesh(this.cyl(0.05, 0.06, 0.5, 10), this.darkSteel, 0.38, 0.03, 0);
        bm.rotation.z = Math.PI / 2;
        b.add(bm);
        b.add(this.mesh(this.sphere(0.06, 10, 8), this.darkSteel, 0.62, 0.03, 0));
        t.add(b);
        inner.add(t);
        turret = t;
        barrel = b;
        height = 0.8;
        break;
      }
    }
    return { root, inner, spin, turret, barrel, glow, height };
  }
}
