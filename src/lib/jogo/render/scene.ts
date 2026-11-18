// Cena 3D: câmera isométrica, terreno, névoa de guerra, entidades e efeitos.

import * as THREE from "three";
import { AIR_ALT, BUILDINGS, UNITS, type BuildingKind, type Team } from "../defs";
import type { Building, Entity, Game, GameEvent, Unit } from "../game";
import { BIOMES, type Biome } from "../biomes";
import { mulberry32, Terrain } from "../map";
import { ModelKit, type BuildingModel, type UnitModel } from "./models";
import { ParticleSystem } from "./particles";

const SHROUD = new THREE.Color("#0a0e18");
const VIEW_H = 15; // altura visível (em tiles) com zoom 1
const ELEVATION = THREE.MathUtils.degToRad(52);
const CAM_DIR = new THREE.Vector3(-Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2);

interface UnitView {
  kind: "unit";
  model: UnitModel;
  ring: THREE.Mesh;
  bar: THREE.Group;
  fill: THREE.Mesh;
  cargoBar: THREE.Mesh | null;
  barW: number;
  blob: THREE.Mesh;
}

interface BuildingView {
  kind: "building";
  model: BuildingModel;
  ring: THREE.Mesh;
  bar: THREE.Group;
  fill: THREE.Mesh;
  barW: number;
  smoke: number;
}

type View = UnitView | BuildingView;

interface Ping {
  mesh: THREE.Mesh;
  t: number;
}

interface Delayed {
  at: number;
  fn: () => void;
}

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  target = new THREE.Vector3(10, 0, 50);
  zoom = 1.12;
  private game: Game;
  private biome: Biome;
  private liquidTiles: number[] = [];
  private liquidTex: THREE.CanvasTexture | null = null;
  private ambientAcc = 0;
  private kit: ModelKit;
  private ghostKit: ModelKit;
  private fogData: Uint8Array<ArrayBuffer>;
  private fogCur: Float32Array;
  private fogTex: THREE.DataTexture;
  private fogUniforms: { uFogTex: { value: THREE.Texture }; uMapSize: { value: THREE.Vector2 } };
  private views = new Map<number, View>();
  private projViews = new Map<number, THREE.Object3D>();
  private sun: THREE.DirectionalLight;
  private terrainCanvas: HTMLCanvasElement;
  private terrainTex: THREE.CanvasTexture;
  private oreMesh: THREE.InstancedMesh | null = null;
  private oreTiles: number[] = [];
  private oreVersion = -1;
  private spires: THREE.Object3D[] = [];
  private fire: ParticleSystem;
  private smoke: ParticleSystem;
  private pings: Ping[] = [];
  private arrowMesh: THREE.Mesh;
  private arrowPos = new Float32Array(48 * 9 * 3);
  private arrowCol = new Float32Array(48 * 9 * 3);
  private dragArrow: { x0: number; z0: number; x1: number; z1: number; attack: boolean } | null = null;
  private delayed: Delayed[] = [];
  private ghost: THREE.Group | null = null;
  private ghostKey = "";
  private ghostTiles: THREE.Mesh[] = [];
  private rallyFlag: THREE.Group;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private clock = 0;
  private width = 1;
  private height = 1;
  private water: THREE.Mesh;
  private ringGeo = new Map<string, THREE.BufferGeometry>();
  private barBg = new THREE.MeshBasicMaterial({ color: "#10141c", depthTest: false, transparent: true, opacity: 0.85 });
  private barGeo = new THREE.PlaneGeometry(1, 1);
  private ringMats: Record<string, THREE.MeshBasicMaterial> = {
    own: new THREE.MeshBasicMaterial({ color: "#7dffa8", transparent: true, opacity: 0.95, depthWrite: false }),
    enemy: new THREE.MeshBasicMaterial({ color: "#ff6b5e", transparent: true, opacity: 0.95, depthWrite: false }),
  };
  private scorchQueue: { x: number; z: number; r: number }[] = [];
  private padQueue: { tx: number; tz: number; w: number; h: number }[] = [];
  private blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private blobMat: THREE.MeshBasicMaterial;
  private scorchTimer = 0;

  constructor(canvas: HTMLCanvasElement, game: Game, opts: { lowPower: boolean }) {
    this.game = game;
    this.biome = BIOMES[game.map.biome];
    const { w, h } = game.map;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowPower, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.biome.exposure * 1.04;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = SHROUD;

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);

    // névoa de guerra (textura 1 texel por tile, filtrada para bordas suaves)
    this.fogData = new Uint8Array(w * h * 4);
    this.fogCur = new Float32Array(w * h);
    this.fogTex = new THREE.DataTexture(this.fogData, w, h, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.wrapS = THREE.ClampToEdgeWrapping;
    this.fogTex.wrapT = THREE.ClampToEdgeWrapping;
    this.fogTex.needsUpdate = true;
    this.fogUniforms = { uFogTex: { value: this.fogTex }, uMapSize: { value: new THREE.Vector2(w, h) } };

    const patch = (m: THREE.Material) => this.fogify(m);
    // sombra macia sob as unidades
    const bc = document.createElement("canvas");
    bc.width = bc.height = 64;
    const bctx = bc.getContext("2d")!;
    const grad = bctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, 64, 64);
    this.blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), color: "#1a2030", transparent: true, depthWrite: false, opacity: 0.85 });
    const colorsOf = (t: Team) => game.colors(t);
    this.kit = new ModelKit(patch, colorsOf);
    this.ghostKit = new ModelKit((m) => {
      m.transparent = true;
      m.opacity = 0.55;
      m.depthWrite = false;
    }, colorsOf);

    // luzes
    // luz clara de dia ensolarado, com sombras suaves e azuladas (visual de brinquedo)
    const hemi = new THREE.HemisphereLight(this.biome.hemi[0], this.biome.hemi[1], this.biome.hemi[2] * 1.12);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(this.biome.sun[0], this.biome.sun[1] * 1.15);
    this.sun.castShadow = true;
    const sm = opts.lowPower ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.sun.shadow.intensity = 0.78;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // terreno
    this.terrainCanvas = document.createElement("canvas");
    this.terrainTex = this.paintTerrain();
    this.buildTerrain();
    this.water = this.buildWater();
    this.buildProps();
    this.buildOre();

    this.fire = new ParticleSystem(2500, true);
    this.smoke = new ParticleSystem(2500, false);
    this.scene.add(this.smoke.points);
    this.scene.add(this.fire.points);

    // setas de ordem desenhadas no chão
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.BufferAttribute(this.arrowPos, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute("color", new THREE.BufferAttribute(this.arrowCol, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setDrawRange(0, 0);
    this.arrowMesh = new THREE.Mesh(
      ag,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.arrowMesh.frustumCulled = false;
    this.arrowMesh.renderOrder = 3;
    this.scene.add(this.arrowMesh);

    this.rallyFlag = this.makeFlag();
    this.rallyFlag.visible = false;
    this.scene.add(this.rallyFlag);

    // centraliza no conjunto base + unidades iniciais
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const u of game.units.values()) {
      if (u.team !== 0) continue;
      cx += u.x;
      cz += u.z;
      n++;
    }
    for (const b of game.buildings.values()) {
      if (b.team !== 0) continue;
      cx += (b.tx + b.w / 2) * 3;
      cz += (b.tz + b.h / 2) * 3;
      n += 3;
    }
    if (n > 0) this.target.set(cx / n, 0, cz / n);
    else this.target.set(game.map.starts[0].x + 2, 0, game.map.starts[0].z + 1);
    this.updateFog(1, true);
  }

  // ------------------------------------------------------------ névoa no shader

  private fogify(m: THREE.Material) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFogTex = this.fogUniforms.uFogTex;
      shader.uniforms.uMapSize = this.fogUniforms.uMapSize;
      shader.vertexShader =
        "varying vec2 vFogXZ;\n" +
        shader.vertexShader.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec4 fogWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fogWp = instanceMatrix * fogWp;
          #endif
          fogWp = modelMatrix * fogWp;
          vFogXZ = fogWp.xz;`,
        );
      shader.fragmentShader =
        "uniform sampler2D uFogTex;\nuniform vec2 uMapSize;\nvarying vec2 vFogXZ;\n" +
        shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          float fv = texture2D(uFogTex, vFogXZ / uMapSize).r;
          vec2 inMap = step(vec2(0.0), vFogXZ) * step(vFogXZ, uMapSize);
          fv *= inMap.x * inMap.y;
          vec3 lit = gl_FragColor.rgb * mix(0.45, 1.0, clamp(fv * 2.0 - 1.0, 0.0, 1.0));
          gl_FragColor.rgb = mix(vec3(0.039, 0.055, 0.094), lit, smoothstep(0.02, 0.5, fv));`,
        );
    };
    m.customProgramCacheKey = () => "fog-v1";
  }

  updateFog(dt: number, instant = false) {
    const ts = this.game.teams[0];
    const n = this.fogCur.length;
    const k = instant ? 1 : Math.min(1, dt * 6);
    let changed = false;
    for (let i = 0; i < n; i++) {
      const target = ts.visible[i] ? 1 : ts.explored[i] ? 0.5 : 0;
      const cur = this.fogCur[i];
      if (cur !== target) {
        let nv = cur + (target - cur) * k;
        if (Math.abs(nv - target) < 0.01) nv = target;
        this.fogCur[i] = nv;
        this.fogData[i * 4] = Math.round(nv * 255);
        changed = true;
      }
    }
    if (changed) this.fogTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ terreno

  private paintTerrain() {
    const { w, h, terrain, shade, oreMax } = this.game.map;
    const px = 16;
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    const sctx = small.getContext("2d")!;
    const img = sctx.createImageData(w, h);
    const B = this.biome;
    const grassA = new THREE.Color(B.ground[0]);
    const grassB = new THREE.Color(B.ground[1]);
    const sand = new THREE.Color(B.secondary);
    const rock = new THREE.Color(B.rock);
    const bed = new THREE.Color(B.bed);
    const oreTint = new THREE.Color(B.oreTint);
    const tmp = new THREE.Color();
    for (let i = 0; i < w * h; i++) {
      const t = terrain[i];
      if (t === Terrain.Sand) tmp.copy(sand);
      else if (t === Terrain.Water) tmp.copy(bed);
      else if (t === Terrain.Rock) tmp.copy(rock);
      else {
        tmp.copy(grassA).lerp(grassB, shade[i]);
        if (t === Terrain.Tree) tmp.multiplyScalar(0.88);
      }
      if (oreMax[i] > 0) tmp.lerp(oreTint, 0.35);
      img.data[i * 4] = tmp.r * 255;
      img.data[i * 4 + 1] = tmp.g * 255;
      img.data[i * 4 + 2] = tmp.b * 255;
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const c = this.terrainCanvas;
    c.width = w * px;
    c.height = h * px;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // amplia em 2 etapas para um degradê mais macio
    const mid = document.createElement("canvas");
    mid.width = w * 4;
    mid.height = h * 4;
    const mctx = mid.getContext("2d")!;
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(small, 0, 0, mid.width, mid.height);
    ctx.drawImage(mid, 0, 0, c.width, c.height);

    // detalhes: tufos, flores e pedrinhas
    const rnd = mulberry32(99);
    for (let i = 0; i < w * h; i++) {
      const t = terrain[i];
      const x = (i % w) * px;
      const z = Math.floor(i / w) * px;
      const n = t === Terrain.Grass || t === Terrain.Tree ? 4 : t === Terrain.Sand ? 2 : 0;
      for (let k = 0; k < n; k++) {
        const ox = x + rnd() * px;
        const oz = z + rnd() * px;
        if (t === Terrain.Sand) {
          ctx.fillStyle = rnd() < 0.5 ? "rgba(120,100,70,0.22)" : "rgba(255,255,240,0.3)";
          ctx.beginPath();
          ctx.arc(ox, oz, 1 + rnd(), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = rnd() < 0.5 ? B.speck[0] : B.speck[1];
          ctx.beginPath();
          ctx.ellipse(ox, oz, 1.6 + rnd() * 1.4, 0.8 + rnd() * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
          if (B.flowers && rnd() < 0.015) {
            ctx.fillStyle = B.flowers[Math.floor(rnd() * B.flowers.length)];
            ctx.beginPath();
            ctx.arc(ox, oz, 1.1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    // ondulações de duna (deserto) e rachaduras incandescentes (vulcão)
    if (B.ripples) {
      ctx.strokeStyle = B.ripples;
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 900; k++) {
        const x = rnd() * c.width;
        const z = rnd() * c.height;
        const i = Math.floor(z / px) * w + Math.floor(x / px);
        if (terrain[i] !== Terrain.Grass) continue;
        ctx.beginPath();
        ctx.arc(x, z + 14, 16 + rnd() * 10, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
      }
    }
    if (B.cracks) {
      ctx.strokeStyle = B.cracks;
      ctx.lineCap = "round";
      for (let k = 0; k < 260; k++) {
        let x = rnd() * c.width;
        let z = rnd() * c.height;
        const i = Math.floor(z / px) * w + Math.floor(x / px);
        if (terrain[i] !== Terrain.Grass && terrain[i] !== Terrain.Sand) continue;
        ctx.lineWidth = 0.8 + rnd() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, z);
        let a = rnd() * Math.PI * 2;
        for (let sgm = 0; sgm < 4; sgm++) {
          a += (rnd() - 0.5) * 1.4;
          x += Math.cos(a) * (5 + rnd() * 8);
          z += Math.sin(a) * (5 + rnd() * 8);
          ctx.lineTo(x, z);
        }
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private blurGrid(src: Float32Array, w: number, h: number, passes: number) {
    let a = src;
    for (let p = 0; p < passes; p++) {
      const b = new Float32Array(w * h);
      for (let z = 0; z < h; z++)
        for (let x = 0; x < w; x++) {
          let s = 0;
          let n = 0;
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = Math.min(w - 1, Math.max(0, x + dx));
              const zz = Math.min(h - 1, Math.max(0, z + dz));
              s += a[zz * w + xx];
              n++;
            }
          b[z * w + x] = s / n;
        }
      a = b;
    }
    return a;
  }

  private buildTerrain() {
    const { w, h, terrain } = this.game.map;
    const wm = new Float32Array(w * h);
    const rm = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      wm[i] = terrain[i] === Terrain.Water ? 1 : 0;
      rm[i] = terrain[i] === Terrain.Rock ? 1 : 0;
    }
    const wb = this.blurGrid(wm, w, h, 2);
    const rb = this.blurGrid(rm, w, h, 1);
    const sample = (g: Float32Array, x: number, z: number) => {
      const fx = Math.min(w - 1.001, Math.max(0, x - 0.5));
      const fz = Math.min(h - 1.001, Math.max(0, z - 0.5));
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const tx = fx - x0;
      const tz = fz - z0;
      const a = g[z0 * w + x0];
      const b = g[z0 * w + x0 + 1];
      const c = g[(z0 + 1) * w + x0];
      const d = g[(z0 + 1) * w + x0 + 1];
      return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    };
    const seg = 2;
    const geo = new THREE.PlaneGeometry(w, h, w * seg, h * seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(w / 2, 0, h / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const water = sample(wb, x, z);
      const rock = sample(rb, x, z);
      const y = -Math.pow(water, 0.8) * 0.45 + rock * 0.22;
      pos.setY(i, y);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.terrainTex, roughness: 0.95, metalness: 0 });
    this.fogify(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildWater() {
    const { w, h } = this.game.map;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const L = this.biome.liquid;
    geo.translate(w / 2, L.level, h / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: L.color,
      roughness: L.roughness,
      metalness: 0.1,
      transparent: L.opacity < 1,
      opacity: L.opacity,
      emissive: L.emissive,
      emissiveIntensity: L.emissiveIntensity,
    });
    for (let i = 0; i < this.game.map.terrain.length; i++) if (this.game.map.terrain[i] === Terrain.Water) this.liquidTiles.push(i);
    if (L.texture) {
      const tex = this.liquidTexture(L.texture);
      mat.map = tex;
      mat.color.set("#ffffff");
      if (L.texture === "lava") {
        mat.emissiveMap = tex;
        mat.emissive.set("#ffffff");
      }
      this.liquidTex = tex;
    }
    this.fogify(mat);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // Textura procedural do líquido: lava com crosta e veios, ou gelo rachado.
  private liquidTexture(kind: "lava" | "ice") {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    const rnd = mulberry32(kind === "lava" ? 13 : 21);
    if (kind === "lava") {
      const g = ctx.createLinearGradient(0, 0, 512, 512);
      g.addColorStop(0, "#ff8a2a");
      g.addColorStop(0.5, "#ff5a14");
      g.addColorStop(1, "#ff9a3a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
      // manchas de crosta resfriada, suaves (repetidas nas bordas para a textura encaixar)
      for (let k = 0; k < 26; k++) {
        const x = rnd() * 512;
        const y = rnd() * 512;
        const r = 40 + rnd() * 70;
        const dark = `rgba(${70 + rnd() * 30},${22 + rnd() * 12},10,`;
        for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512], [512, 512], [-512, -512], [512, -512], [-512, 512]]) {
          const gr = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          gr.addColorStop(0, dark + "0.8)");
          gr.addColorStop(0.55, dark + "0.55)");
          gr.addColorStop(1, dark + "0)");
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // veios incandescentes, poucos e finos
      ctx.strokeStyle = "rgba(255,225,110,0.55)";
      ctx.lineCap = "round";
      for (let k = 0; k < 22; k++) {
        let x = rnd() * 512;
        let y = rnd() * 512;
        ctx.lineWidth = 1 + rnd() * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        let a = rnd() * Math.PI * 2;
        for (let s = 0; s < 6; s++) {
          a += (rnd() - 0.5) * 0.9;
          x += Math.cos(a) * 18;
          y += Math.sin(a) * 18;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#d6f1fb";
      ctx.fillRect(0, 0, 512, 512);
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(150,200,225,0.25)";
        ctx.beginPath();
        ctx.ellipse(rnd() * 512, rnd() * 512, 30 + rnd() * 60, 12 + rnd() * 30, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      for (let k = 0; k < 45; k++) {
        let x = rnd() * 512;
        let y = rnd() * 512;
        ctx.lineWidth = 0.6 + rnd() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        let a = rnd() * Math.PI * 2;
        for (let s = 0; s < 6; s++) {
          a += (rnd() - 0.5) * 1.6;
          x += Math.cos(a) * 18;
          y += Math.sin(a) * 18;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(kind === "lava" ? 3.5 : 6, kind === "lava" ? 3.5 : 6);
    tex.anisotropy = 4;
    return tex;
  }

  private buildProps() {
    const { w, h, terrain } = this.game.map;
    const rnd = mulberry32(5);
    const trees: { x: number; z: number; s: number; pine: boolean }[] = [];
    const rocks: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const z = Math.floor(i / w);
      if (terrain[i] === Terrain.Tree) {
        const n = rnd() < 0.5 ? 1 : 2;
        for (let k = 0; k < n; k++)
          trees.push({ x: x + 0.5 + (rnd() - 0.5) * 0.5, z: z + 0.5 + (rnd() - 0.5) * 0.5, s: 0.75 + rnd() * 0.45, pine: rnd() < 0.3 });
      } else if (terrain[i] === Terrain.Rock) {
        const n = 2 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) rocks.push({ x: x + 0.2 + rnd() * 0.6, z: z + 0.2 + rnd() * 0.6, s: 0.35 + rnd() * 0.35 });
      }
    }
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    if (this.biome.trees !== "temperate") {
      this.buildBiomeTrees(trees, rnd);
    } else {
      const trunkMat = new THREE.MeshStandardMaterial({ color: "#8a5a3b", roughness: 0.9 });
      const crownMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75 });
      this.fogify(trunkMat);
      this.fogify(crownMat);
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 8), trunkMat, trees.length);
      const round = trees.filter((t) => !t.pine);
      const pines = trees.filter((t) => t.pine);
      const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.34, 2), crownMat, round.length * 2);
      const pineGeo = new THREE.ConeGeometry(0.3, 0.7, 10);
      const pineMesh = new THREE.InstancedMesh(pineGeo, crownMat, pines.length * 2);
      trees.forEach((t, i) => {
        dummy.position.set(t.x, 0.2 * t.s, t.z);
        dummy.scale.setScalar(t.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
      });
      round.forEach((t, i) => {
        dummy.position.set(t.x, 0.55 * t.s, t.z);
        dummy.scale.set(t.s, t.s * 0.95, t.s);
        dummy.updateMatrix();
        crowns.setMatrixAt(i * 2, dummy.matrix);
        col.setHSL(0.27 + rnd() * 0.08, 0.5, 0.36 + rnd() * 0.1);
        crowns.setColorAt(i * 2, col);
        dummy.position.set(t.x + 0.08, 0.82 * t.s, t.z - 0.05);
        dummy.scale.setScalar(t.s * 0.62);
        dummy.updateMatrix();
        crowns.setMatrixAt(i * 2 + 1, dummy.matrix);
        col.offsetHSL(0, 0, 0.07);
        crowns.setColorAt(i * 2 + 1, col);
      });
      pines.forEach((t, i) => {
        dummy.position.set(t.x, 0.6 * t.s, t.z);
        dummy.scale.setScalar(t.s);
        dummy.updateMatrix();
        pineMesh.setMatrixAt(i * 2, dummy.matrix);
        col.setHSL(0.36 + rnd() * 0.05, 0.45, 0.3 + rnd() * 0.06);
        pineMesh.setColorAt(i * 2, col);
        dummy.position.set(t.x, 0.92 * t.s, t.z);
        dummy.scale.setScalar(t.s * 0.7);
        dummy.updateMatrix();
        pineMesh.setMatrixAt(i * 2 + 1, dummy.matrix);
        col.offsetHSL(0, 0, 0.06);
        pineMesh.setColorAt(i * 2 + 1, col);
      });
      for (const m of [trunks, crowns, pineMesh]) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        this.scene.add(m);
      }
    }

    const rockMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, flatShading: false });
    this.fogify(rockMat);
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 1), rockMat, rocks.length);
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, 0.12 + r.s * 0.2, r.z);
      dummy.scale.set(r.s * (0.9 + rnd() * 0.5), r.s * (0.6 + rnd() * 0.4), r.s * (0.9 + rnd() * 0.5));
      dummy.rotation.set(rnd(), rnd() * 6, rnd());
      dummy.updateMatrix();
      rockMesh.setMatrixAt(i, dummy.matrix);
      const rc = this.biome.rockColor;
      col.setHSL(rc.h, rc.s + rnd() * 0.06, rc.l + rnd() * rc.lv);
      rockMesh.setColorAt(i, col);
    });
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    this.scene.add(rockMesh);

    // nascentes de cristal
    const gem = new THREE.OctahedronGeometry(0.2, 0);
    for (const s of this.game.map.spires) {
      const g = new THREE.Group();
      g.position.set(s.x + 0.5, 0, s.z + 0.5);
      for (let k = 0; k < 5; k++) {
        const m = this.kit.mesh(gem, this.kit.crystal);
        const a = (k / 5) * Math.PI * 2;
        const r = k === 0 ? 0 : 0.18;
        m.position.set(Math.cos(a) * r, k === 0 ? 0.5 : 0.25, Math.sin(a) * r);
        m.scale.set(k === 0 ? 1.1 : 0.7, k === 0 ? 2.6 : 1.5, k === 0 ? 1.1 : 0.7);
        m.rotation.set((Math.random() - 0.5) * 0.5, a, (Math.random() - 0.5) * 0.5);
        g.add(m);
      }
      this.spires.push(g);
      this.scene.add(g);
    }
  }

  // Vegetação de cada bioma, em malhas instanciadas.
  private buildBiomeTrees(trees: { x: number; z: number; s: number }[], rnd: () => number) {
    const style = this.biome.trees;
    const { w, terrain } = this.game.map;
    type Inst = { p: [number, number, number]; r?: [number, number, number]; s: [number, number, number]; c: string | THREE.Color };
    const groups = new Map<string, { geo: THREE.BufferGeometry; items: Inst[] }>();
    const add = (key: string, geo: () => THREE.BufferGeometry, item: Inst) => {
      let g = groups.get(key);
      if (!g) {
        g = { geo: geo(), items: [] };
        groups.set(key, g);
      }
      g.items.push(item);
    };
    const nearLiquid = (x: number, z: number) => {
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++) {
          const xx = Math.floor(x) + dx;
          const zz = Math.floor(z) + dz;
          if (xx >= 0 && zz >= 0 && xx < w && zz < w && terrain[zz * w + xx] === Terrain.Water) return true;
        }
      return false;
    };
    const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l);
    for (const t of trees) {
      const s = t.s;
      if (style === "desert") {
        if (nearLiquid(t.x, t.z)) {
          // palmeira: tronco inclinado e folhas caídas em leque
          const tilt = (rnd() - 0.5) * 0.35;
          const tz = (rnd() - 0.5) * 0.35;
          add("palmTrunk", () => new THREE.CylinderGeometry(0.035, 0.06, 1, 7), { p: [t.x + tilt * 0.45 * s, 0.5 * s, t.z + tz * 0.45 * s], r: [tz, 0, -tilt], s: [s, s, s], c: "#a07a4e" });
          const top: [number, number] = [t.x + tilt * 0.9 * s, t.z + tz * 0.9 * s];
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + rnd();
            add("palmLeaf", () => new THREE.SphereGeometry(1, 10, 6), {
              p: [top[0] + Math.cos(a) * 0.24 * s, 0.97 * s, top[1] + Math.sin(a) * 0.24 * s],
              r: [0, -a, -0.4],
              s: [0.32 * s, 0.03 * s, 0.09 * s],
              c: hsl(0.27 + rnd() * 0.06, 0.55, 0.32 + rnd() * 0.08),
            });
          }
        } else {
          // cacto
          const g = hsl(0.3 + rnd() * 0.04, 0.38, 0.38 + rnd() * 0.08);
          add("cactus", () => new THREE.CapsuleGeometry(0.1, 0.4, 4, 10), { p: [t.x, 0.3 * s, t.z], s: [s, s, s], c: g });
          const arms = 1 + Math.floor(rnd() * 2);
          for (let k = 0; k < arms; k++) {
            const side = k === 0 ? 1 : -1;
            const a = rnd() * Math.PI;
            const ox = Math.cos(a) * 0.15 * side * s;
            const oz = Math.sin(a) * 0.15 * side * s;
            add("cactusArm", () => new THREE.CapsuleGeometry(0.06, 0.16, 4, 8), { p: [t.x + ox, (0.38 + k * 0.08) * s, t.z + oz], s: [s, s, s], c: g });
            add("cactusJoint", () => new THREE.SphereGeometry(0.065, 8, 6), { p: [t.x + ox * 0.6, (0.28 + k * 0.08) * s, t.z + oz * 0.6], s: [s, s, s], c: g });
          }
        }
      } else if (style === "snow") {
        // pinheiro nevado: três cones verdes e ponta branca
        add("snowTrunk", () => new THREE.CylinderGeometry(0.05, 0.07, 0.3, 7), { p: [t.x, 0.15 * s, t.z], s: [s, s, s], c: "#6b4b36" });
        const base = hsl(0.38 + rnd() * 0.04, 0.35, 0.24 + rnd() * 0.06);
        for (let k = 0; k < 3; k++) {
          const c = base.clone().lerp(new THREE.Color("#ffffff"), k * 0.18);
          add("snowCone", () => new THREE.ConeGeometry(0.32, 0.5, 10), { p: [t.x, (0.42 + k * 0.24) * s, t.z], s: [s * (1 - k * 0.24), s, s * (1 - k * 0.24)], c });
        }
        add("snowCap", () => new THREE.ConeGeometry(0.14, 0.22, 10), { p: [t.x, 1.02 * s, t.z], s: [s, s, s], c: "#f6fbff" });
      } else {
        // árvore calcinada: tronco escuro com galhos secos
        const c = hsl(0.05, 0.12, 0.13 + rnd() * 0.06);
        const lean = (rnd() - 0.5) * 0.25;
        add("deadTrunk", () => new THREE.CylinderGeometry(0.03, 0.07, 0.9, 6), { p: [t.x, 0.45 * s, t.z], r: [0, 0, lean], s: [s, s, s], c });
        for (let k = 0; k < 3; k++) {
          const a = rnd() * Math.PI * 2;
          add("deadBranch", () => new THREE.CylinderGeometry(0.012, 0.025, 0.4, 5), {
            p: [t.x + Math.cos(a) * 0.12 * s, (0.55 + k * 0.12) * s, t.z + Math.sin(a) * 0.12 * s],
            r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9],
            s: [s, s, s],
            c,
          });
        }
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 });
    this.fogify(mat);
    const dummy = new THREE.Object3D();
    for (const g of groups.values()) {
      const m = new THREE.InstancedMesh(g.geo, mat, g.items.length);
      g.items.forEach((it, i) => {
        dummy.position.set(...it.p);
        dummy.rotation.set(...(it.r ?? [0, rnd() * 6, 0]));
        dummy.scale.set(...it.s);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, it.c instanceof THREE.Color ? it.c : new THREE.Color(it.c));
      });
      m.castShadow = true;
      m.receiveShadow = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.scene.add(m);
    }
  }

  // Clima: neve caindo, poeira no vento ou brasas subindo da lava.
  private ambientParticles(dt: number) {
    const kind = this.biome.ambient;
    if (kind === "none") return;
    const R = this.viewHeight * 0.85;
    const tx = this.target.x;
    const tz = this.target.z;
    const rate = kind === "snow" ? 70 : kind === "dust" ? 22 : 30;
    this.ambientAcc += dt * rate;
    while (this.ambientAcc >= 1) {
      this.ambientAcc--;
      const x = tx + (Math.random() - 0.5) * 2 * R;
      const z = tz + (Math.random() - 0.5) * 2 * R;
      if (kind === "snow") {
        this.smoke.emit({ x, y: 4 + Math.random() * 2.5, z, vx: 0.35, vy: -0.95, vz: 0.12, life: 5.5, size0: 0.07, size1: 0.05, color: "#ffffff", alpha: 0.85 });
      } else if (kind === "dust") {
        this.smoke.emit({ x, y: 0.2 + Math.random() * 1.3, z, vx: 1.1 + Math.random() * 0.6, vy: 0.05, vz: 0.4, life: 3.5, size0: 0.12, size1: 0.45, color: "#e9cd96", alpha: 0.2 });
      } else if (this.liquidTiles.length) {
        // brasas de uma lava próxima à câmera
        const i = this.liquidTiles[Math.floor(Math.random() * this.liquidTiles.length)];
        const lx = (i % this.game.map.w) + Math.random();
        const lz = Math.floor(i / this.game.map.w) + Math.random();
        if (Math.abs(lx - tx) > R * 1.3 || Math.abs(lz - tz) > R * 1.3) continue;
        this.fire.emit({ x: lx, y: 0.05, z: lz, vx: (Math.random() - 0.5) * 0.3, vy: 0.6 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 0.3, life: 1.6 + Math.random(), size0: 0.07, size1: 0.02, color: "#ffd27a", color1: "#ff3d00" });
        if (Math.random() < 0.15) this.smoke.emit({ x: lx, y: 0.2, z: lz, vy: 0.5, life: 3, size0: 0.3, size1: 1.0, color: "#3a2a24", color1: "#6a5a54", alpha: 0.35 });
      }
    }
  }

  private buildOre() {
    const { oreMax } = this.game.map;
    for (let i = 0; i < oreMax.length; i++) if (oreMax[i] > 0) this.oreTiles.push(i);
    const mat = this.kit.mat("oreGem", "#ffd75e", { roughness: 0.25, metalness: 0.2, emissive: "#c98a00", emissiveIntensity: 0.35 });
    this.oreMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), mat, this.oreTiles.length * 3);
    this.oreMesh.castShadow = true;
    this.oreMesh.receiveShadow = true;
    const col = new THREE.Color();
    const rnd = mulberry32(42);
    this.oreTiles.forEach((_, j) => {
      for (let k = 0; k < 3; k++) {
        col.setHSL(0.11 + rnd() * 0.05, 0.85, 0.55 + rnd() * 0.1);
        this.oreMesh!.setColorAt(j * 3 + k, col);
      }
    });
    if (this.oreMesh.instanceColor) this.oreMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.oreMesh);
    this.updateOre();
  }

  private updateOre() {
    if (!this.oreMesh) return;
    const { ore, oreMax, w } = this.game.map;
    const dummy = new THREE.Object3D();
    const offs = [
      [0.3, 0.32],
      [0.7, 0.45],
      [0.42, 0.74],
    ];
    this.oreTiles.forEach((i, j) => {
      const x = i % w;
      const z = Math.floor(i / w);
      const frac = oreMax[i] > 0 ? ore[i] / oreMax[i] : 0;
      for (let k = 0; k < 3; k++) {
        const vis = frac > k / 3 ? Math.min(1, (frac - k / 3) * 3) : 0;
        const s = vis * (0.9 + ((i * 7 + k * 3) % 5) * 0.12);
        dummy.position.set(x + offs[k][0], 0.08 + s * 0.06, z + offs[k][1]);
        dummy.rotation.set(0.3 * k, i * 0.7 + k, 0.2);
        dummy.scale.set(s, s * 1.5, s);
        dummy.updateMatrix();
        this.oreMesh!.setMatrixAt(j * 3 + k, dummy.matrix);
      }
    });
    this.oreMesh.instanceMatrix.needsUpdate = true;
  }

  private makeFlag() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), new THREE.MeshBasicMaterial({ color: "#e8edf5" }));
    pole.position.y = 0.35;
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ color: this.game.colors(0).main, side: THREE.DoubleSide }));
    flag.position.set(0.15, 0.6, 0);
    g.add(flag);
    return g;
  }

  // ------------------------------------------------------------ câmera

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.updateCamera();
  }

  get viewHeight() {
    // telas em retrato mostram menos altura para não ficar minúsculo
    const portrait = this.height > this.width;
    return (portrait ? VIEW_H * 1.15 : VIEW_H) / this.zoom;
  }

  updateCamera() {
    const { w, h } = this.game.map;
    this.target.x = Math.max(0, Math.min(w, this.target.x));
    this.target.z = Math.max(0, Math.min(h, this.target.z));
    const aspect = this.width / this.height;
    const vh = this.viewHeight;
    this.camera.left = (-vh * aspect) / 2;
    this.camera.right = (vh * aspect) / 2;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    this.camera.position.copy(this.target).addScaledVector(CAM_DIR, 60);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    const sz = Math.max(vh * aspect, vh) * 0.9 + 4;
    const sc = this.sun.shadow.camera;
    sc.left = -sz;
    sc.right = sz;
    sc.top = sz;
    sc.bottom = -sz;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();
    this.sun.position.set(this.target.x - 10, 26, this.target.z - 16);
    this.sun.target.position.copy(this.target);
  }

  setZoom(z: number, anchorPx?: { x: number; y: number }) {
    const before = anchorPx ? this.screenToWorld(anchorPx.x, anchorPx.y) : null;
    this.zoom = Math.max(0.55, Math.min(2.2, z));
    this.updateCamera();
    if (before && anchorPx) {
      const after = this.screenToWorld(anchorPx.x, anchorPx.y);
      if (after) {
        this.target.x += before.x - after.x;
        this.target.z += before.z - after.z;
        this.updateCamera();
      }
    }
  }

  panPixels(dx: number, dy: number) {
    const a = this.screenToWorld(this.width / 2, this.height / 2);
    const b = this.screenToWorld(this.width / 2 + dx, this.height / 2 + dy);
    if (!a || !b) return;
    this.target.x -= b.x - a.x;
    this.target.z -= b.z - a.z;
    this.updateCamera();
  }

  focus(x: number, z: number) {
    this.target.set(x, 0, z);
    this.updateCamera();
  }

  screenToWorld(px: number, py: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
    return { x: p.x, z: p.z };
  }

  worldToScreen(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) * 0.5 * this.width, y: (1 - v.y) * 0.5 * this.height };
  }

  viewCorners() {
    return [
      this.screenToWorld(0, 0),
      this.screenToWorld(this.width, 0),
      this.screenToWorld(this.width, this.height),
      this.screenToWorld(0, this.height),
    ];
  }

  // Entidade sob o cursor/dedo.
  // Só o que está exatamente sob o cursor/dedo (sem tolerância).
  pickExact(px: number, py: number): number | null {
    return this.pick(px, py, 10);
  }

  pick(px: number, py: number, tolerance: number): number | null {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const roots: THREE.Object3D[] = [];
    for (const v of this.views.values()) if (v.model.root.visible) roots.push(v.model.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.eid === undefined) o = o.parent;
      if (o) return o.userData.eid as number;
    }
    // tolerância em tela para unidades pequenas
    let best: number | null = null;
    let bd = tolerance;
    for (const u of this.game.units.values()) {
      const v = this.views.get(u.id);
      if (!v || !v.model.root.visible) continue;
      const s = this.worldToScreen(u.x, UNITS[u.kind].air ? AIR_ALT : 0.2, u.z);
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < bd) {
        bd = d;
        best = u.id;
      }
    }
    return best;
  }

  unitsInRect(x0: number, y0: number, x1: number, y1: number, team: Team) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const out: number[] = [];
    for (const u of this.game.units.values()) {
      if (u.team !== team) continue;
      const s = this.worldToScreen(u.x, UNITS[u.kind].air ? AIR_ALT : 0.2, u.z);
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) out.push(u.id);
    }
    return out;
  }

  unitsOnScreen(team: Team) {
    return this.unitsInRect(0, 0, this.width, this.height, team);
  }

  // ------------------------------------------------------------ entidades

  private ringFor(key: string, make: () => THREE.BufferGeometry) {
    let g = this.ringGeo.get(key);
    if (!g) {
      g = make();
      this.ringGeo.set(key, g);
    }
    return g;
  }

  private makeBar(width: number) {
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(this.barGeo, this.barBg);
    bg.scale.set(width + 0.04, 0.09, 1);
    bg.renderOrder = 10;
    bar.add(bg);
    const fill = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: "#5be37d", depthTest: false, transparent: true }));
    fill.scale.set(width, 0.055, 1);
    fill.position.z = 0.001;
    fill.renderOrder = 11;
    bar.add(fill);
    bar.visible = false;
    this.scene.add(bar);
    return { bar, fill };
  }

  private createUnitView(u: Unit): UnitView {
    const model = this.kit.unit(u.kind, u.team);
    model.root.userData.eid = u.id;
    this.scene.add(model.root);
    const r = UNITS[u.kind].radius;
    const ring = new THREE.Mesh(
      this.ringFor(`u${r}`, () => new THREE.RingGeometry(r * 1.3, r * 1.3 + 0.075, 36).rotateX(-Math.PI / 2)),
      u.team === 0 ? this.ringMats.own : this.ringMats.enemy,
    );
    ring.position.y = 0.03;
    ring.visible = false;
    ring.renderOrder = 2;
    model.root.add(ring);
    const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    blob.scale.setScalar(r * (UNITS[u.kind].infantry ? 3.2 : 2.9));
    blob.position.y = 0.022;
    blob.renderOrder = 1;
    model.root.add(blob);
    const barW = UNITS[u.kind].infantry ? 0.42 : 0.7;
    const { bar, fill } = this.makeBar(barW);
    let cargoBar: THREE.Mesh | null = null;
    if (u.kind === "harvester") {
      cargoBar = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: "#ffd24a", depthTest: false, transparent: true }));
      cargoBar.position.y = -0.09;
      cargoBar.renderOrder = 11;
      bar.add(cargoBar);
    }
    return { kind: "unit", model, ring, bar, fill, cargoBar, barW, blob };
  }

  private createBuildingView(b: Building): BuildingView {
    const model = this.kit.building(b.kind, b.team);
    model.root.userData.eid = b.id;
    model.root.position.set(b.tx + b.w / 2, 0, b.tz + b.h / 2);
    this.scene.add(model.root);
    this.padQueue.push({ tx: b.tx, tz: b.tz, w: b.w, h: b.h });
    const key = `b${b.w}x${b.h}`;
    const ring = new THREE.Mesh(
      this.ringFor(key, () => {
        const hw = b.w / 2 + 0.05;
        const hh = b.h / 2 + 0.05;
        const r = 0.3;
        const outer = new THREE.Shape();
        const rr = (s: THREE.Shape | THREE.Path, x: number, y: number, ww: number, hh2: number, rad: number) => {
          s.moveTo(x + rad, y);
          s.lineTo(x + ww - rad, y);
          s.quadraticCurveTo(x + ww, y, x + ww, y + rad);
          s.lineTo(x + ww, y + hh2 - rad);
          s.quadraticCurveTo(x + ww, y + hh2, x + ww - rad, y + hh2);
          s.lineTo(x + rad, y + hh2);
          s.quadraticCurveTo(x, y + hh2, x, y + hh2 - rad);
          s.lineTo(x, y + rad);
          s.quadraticCurveTo(x, y, x + rad, y);
        };
        rr(outer, -hw, -hh, hw * 2, hh * 2, r);
        const hole = new THREE.Path();
        rr(hole, -hw + 0.06, -hh + 0.06, hw * 2 - 0.12, hh * 2 - 0.12, r - 0.05);
        outer.holes.push(hole);
        return new THREE.ShapeGeometry(outer, 6).rotateX(-Math.PI / 2);
      }),
      b.team === 0 ? this.ringMats.own : this.ringMats.enemy,
    );
    ring.position.y = 0.16;
    ring.visible = false;
    model.root.add(ring);
    const barW = Math.max(0.7, b.w * 0.75);
    const { bar, fill } = this.makeBar(barW);
    return { kind: "building", model, ring, bar, fill, barW, smoke: 0 };
  }

  private disposeView(v: View) {
    this.scene.remove(v.model.root);
    this.scene.remove(v.bar);
    (v.fill.material as THREE.Material).dispose();
    if (v.kind === "unit" && v.cargoBar) (v.cargoBar.material as THREE.Material).dispose();
  }

  private updateBar(v: View, e: Entity, y: number, show: boolean) {
    v.bar.visible = show;
    if (!show) return;
    const c = this.game.center(e);
    v.bar.position.set(c.x, y, c.z);
    v.bar.quaternion.copy(this.camera.quaternion);
    const ratio = Math.max(0, e.hp / e.maxHp);
    v.fill.scale.x = v.barW * ratio;
    v.fill.position.x = (-v.barW * (1 - ratio)) / 2;
    const m = v.fill.material as THREE.MeshBasicMaterial;
    m.color.set(ratio > 0.6 ? "#5be37d" : ratio > 0.3 ? "#ffd04a" : "#ff5a4a");
    if (v.kind === "unit" && v.cargoBar && e.type === "unit") {
      const cr = e.cargo / 1000;
      v.cargoBar.visible = cr > 0;
      v.cargoBar.scale.set(v.barW * cr, 0.04, 1);
      v.cargoBar.position.x = (-v.barW * (1 - cr)) / 2;
    }
  }

  private syncEntities(dt: number) {
    const g = this.game;
    const seen = new Set<number>();
    const t = this.clock;
    for (const u of g.units.values()) {
      seen.add(u.id);
      let v = this.views.get(u.id) as UnitView | undefined;
      if (!v) {
        v = this.createUnitView(u);
        this.views.set(u.id, v);
      }
      const visible = u.team === 0 || g.isVisible(0, u.x, u.z);
      const m = v.model;
      m.root.visible = visible;
      m.root.position.set(u.x, 0, u.z);
      m.body.rotation.y = -u.angle;
      const d = UNITS[u.kind];
      let barY = m.height + 0.18;
      if (d.air) {
        // decolagem suave, flutuação e inclinação ao voar
        const k = Math.min(1, Math.max(0, (g.time - u.bornAt) / 1.3));
        const alt = (0.3 + (AIR_ALT - 0.3) * (1 - Math.pow(1 - k, 3))) + Math.sin(t * 2.2 + u.id) * 0.05;
        m.root.position.y = alt;
        v.ring.position.y = -alt + 0.03;
        v.blob.position.y = -alt + 0.022;
        const tilt = u.moving ? -0.18 : 0;
        m.body.rotation.z += (tilt - m.body.rotation.z) * Math.min(1, dt * 4);
        const spin = dt * (u.kind === "drone" ? 45 : 30);
        m.rotors.forEach((r, i) => {
          if (u.kind === "heli" && i === 0) r.rotation.z += spin;
          else r.rotation.y += spin;
        });
        barY = alt + m.height + 0.2;
      } else if (d.infantry) {
        const ph = t * 12 + u.id;
        m.body.position.y = u.moving ? Math.abs(Math.sin(ph)) * 0.03 : 0;
        const swing = u.moving ? Math.sin(ph) * 0.65 : 0;
        if (m.legs[0]) m.legs[0].rotation.z = swing;
        if (m.legs[1]) m.legs[1].rotation.z = -swing;
      } else if (u.moving) {
        m.body.position.y = Math.sin(t * 22 + u.id) * 0.006;
        if (Math.random() < dt * 8) {
          this.smoke.emit({
            x: u.x - Math.cos(u.angle) * d.radius,
            y: 0.08,
            z: u.z - Math.sin(u.angle) * d.radius,
            vy: 0.2,
            life: 0.7,
            size0: 0.12,
            size1: 0.35,
            color: "#cdb98e",
            alpha: 0.35,
          });
        }
      }
      if (m.turret) m.turret.rotation.y = -(u.turret - u.angle);
      if (m.barrel) m.barrel.position.x = -u.recoil * 0.07;
      if (m.cargo) {
        m.cargo.visible = u.cargo > 0;
        m.cargo.scale.setScalar(0.4 + 0.6 * Math.min(1, u.cargo / 1000));
      }
      const sel = g.selected.has(u.id);
      v.ring.visible = sel;
      this.updateBar(v, u, barY, visible && (sel || u.hp < u.maxHp));
    }
    for (const b of g.buildings.values()) {
      seen.add(b.id);
      let v = this.views.get(b.id) as BuildingView | undefined;
      if (!v) {
        v = this.createBuildingView(b);
        this.views.set(b.id, v);
      }
      const visible = g.entityVisibleTo(0, b);
      const m = v.model;
      m.root.visible = visible;
      const age = g.time - b.bornAt;
      if (age < 1.4) {
        const k = Math.max(0, age / 1.4);
        const s = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
        m.inner.scale.set(1, Math.max(0.02, s), 1);
        if (visible && Math.random() < dt * 20) {
          this.smoke.emit({
            x: b.tx + Math.random() * b.w,
            y: 0.1,
            z: b.tz + Math.random() * b.h,
            vx: (Math.random() - 0.5) * 0.6,
            vy: 0.4,
            vz: (Math.random() - 0.5) * 0.6,
            life: 0.9,
            size0: 0.2,
            size1: 0.6,
            color: "#e2d6b8",
            alpha: 0.5,
          });
        }
      } else {
        m.inner.scale.set(1, 1, 1);
      }
      const powered = !g.teams[b.team].lowPower;
      if (m.spin && powered) m.spin.rotation.y += dt * 1.2;
      if (m.glow) m.glow.emissiveIntensity = powered ? 0.7 + Math.sin(t * 3) * 0.3 : 0.1;
      if (m.turret) m.turret.rotation.y = -b.turret;
      if (m.barrel) m.barrel.position.x = -b.recoil * 0.08;
      const sel = g.selected.has(b.id);
      v.ring.visible = sel;
      this.updateBar(v, b, m.height + 0.35, visible && (sel || b.hp < b.maxHp));
      // fumaça quando danificado
      const ratio = b.hp / b.maxHp;
      if (visible && ratio < 0.55) {
        v.smoke -= dt;
        if (v.smoke <= 0) {
          v.smoke = ratio < 0.25 ? 0.08 : 0.18;
          const x = b.tx + b.w * (0.3 + Math.random() * 0.4);
          const z = b.tz + b.h * (0.3 + Math.random() * 0.4);
          this.smoke.emit({ x, y: m.height * 0.7, z, vx: 0.15, vy: 0.7, vz: -0.1, life: 2.2, size0: 0.25, size1: 0.9, color: "#3d3d42", color1: "#8b8b90", alpha: 0.55 });
          if (ratio < 0.3) this.fire.emit({ x, y: m.height * 0.6, z, vy: 0.6, life: 0.5, size0: 0.25, size1: 0.05, color: "#ffb347", color1: "#ff4d1a", alpha: 0.9 });
        }
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.disposeView(v);
        this.views.delete(id);
      }
    }

    // ponto de reunião da fábrica selecionada
    this.rallyFlag.visible = false;
    for (const id of g.selected) {
      const b = g.buildings.get(id);
      if (b && b.team === 0 && b.rally) {
        this.rallyFlag.visible = true;
        this.rallyFlag.position.set(b.rally.x, 0, b.rally.z);
        this.rallyFlag.children[1].rotation.y = Math.sin(t * 4) * 0.25;
      }
    }
  }

  private syncProjectiles() {
    const seen = new Set<number>();
    for (const p of this.game.projectiles) {
      seen.add(p.id);
      let o = this.projViews.get(p.id);
      if (!o) {
        const color = p.kind === "rocket" ? "#ffe9a8" : p.kind === "shell" ? "#2f3238" : p.kind === "flame" ? "#ffb347" : "#ffd27a";
        const size = p.kind === "shell" ? 0.09 : p.kind === "rocket" ? 0.06 : p.kind === "flame" ? 0.08 : 0.055;
        const mat = new THREE.MeshBasicMaterial({ color });
        o = new THREE.Mesh(this.kit.sphere(size, 8, 6), mat);
        if (p.kind === "rocket") o.scale.set(2.2, 1, 1);
        this.projViews.set(p.id, o);
        this.scene.add(o);
      }
      const vis = this.game.isVisible(0, p.x, p.z);
      o.visible = vis;
      o.position.set(p.x, p.y, p.z);
      o.rotation.y = -Math.atan2(p.tz - p.sz, p.tx - p.sx);
      if (vis && (p.kind === "rocket" || p.kind === "shell")) {
        this.smoke.emit({ x: p.x, y: p.y, z: p.z, life: 0.6, size0: 0.08, size1: 0.28, color: "#d8d8d8", alpha: 0.5 });
        if (p.kind === "rocket") this.fire.emit({ x: p.x, y: p.y, z: p.z, life: 0.12, size0: 0.14, size1: 0.02, color: "#ffcf6b", alpha: 1 });
      }
      if (vis && p.kind === "flame") {
        // jato de fogo: várias bolhas que crescem e somem
        for (let i = 0; i < 3; i++)
          this.fire.emit({
            x: p.x + (Math.random() - 0.5) * 0.12,
            y: p.y + (Math.random() - 0.5) * 0.08,
            z: p.z + (Math.random() - 0.5) * 0.12,
            vy: 0.4,
            life: 0.3,
            size0: 0.12,
            size1: 0.32,
            color: "#ffe28a",
            color1: "#ff4d12",
            alpha: 0.9,
          });
      }
    }
    for (const [id, o] of this.projViews) {
      if (!seen.has(id)) {
        this.scene.remove(o);
        ((o as THREE.Mesh).material as THREE.Material).dispose();
        this.projViews.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ efeitos

  explosion(x: number, z: number, size: number, y = 0.2) {
    const nFire = Math.round(8 + size * 14);
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.5 + Math.random()) * size * 2.2;
      this.fire.emit({
        x: x + (Math.random() - 0.5) * size * 0.4,
        y: y + Math.random() * 0.2,
        z: z + (Math.random() - 0.5) * size * 0.4,
        vx: Math.cos(a) * sp,
        vy: 0.6 + Math.random() * 1.6 * size,
        vz: Math.sin(a) * sp,
        drag: 3.5,
        life: 0.35 + Math.random() * 0.35,
        size0: 0.35 * size + 0.15,
        size1: 0.05,
        color: "#fff1a8",
        color1: "#ff5a1f",
      });
    }
    for (let i = 0; i < Math.round(5 + size * 8); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * size * 1.2;
      this.smoke.emit({
        x,
        y: y + 0.1,
        z,
        vx: Math.cos(a) * sp,
        vy: 0.4 + Math.random() * 0.8,
        vz: Math.sin(a) * sp,
        drag: 1.5,
        life: 1.2 + Math.random() * 1.2,
        size0: 0.25 * size + 0.1,
        size1: 0.9 * size + 0.3,
        color: "#4a4a4f",
        color1: "#a5a5aa",
        alpha: 0.6,
      });
    }
    for (let i = 0; i < Math.round(size * 10); i++) {
      const a = Math.random() * Math.PI * 2;
      this.fire.emit({
        x,
        y: y + 0.1,
        z,
        vx: Math.cos(a) * (1.5 + Math.random() * 2),
        vy: 2 + Math.random() * 2.5,
        vz: Math.sin(a) * (1.5 + Math.random() * 2),
        gravity: 9,
        life: 0.6 + Math.random() * 0.4,
        size0: 0.06,
        size1: 0.03,
        color: "#ffd36b",
        color1: "#ff6a00",
      });
    }
  }

  private muzzle(x: number, y: number, z: number, tx: number, tz: number, big: boolean) {
    this.fire.emit({ x, y, z, life: 0.08, size0: big ? 0.45 : 0.22, size1: 0.1, color: "#fff4b8", color1: "#ffa53a" });
    if (big) {
      const a = Math.atan2(tz - z, tx - x);
      for (let i = 0; i < 3; i++)
        this.smoke.emit({ x, y, z, vx: Math.cos(a) * 0.6, vy: 0.3, vz: Math.sin(a) * 0.6, life: 0.6, size0: 0.15, size1: 0.45, color: "#bfbfc4", alpha: 0.45, drag: 2 });
    }
  }

  private tracer(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const k = (i + Math.random()) / n;
      this.fire.emit({ x: x + (tx - x) * k, y: y + (ty - y) * k, z: z + (tz - z) * k, life: 0.09, size0: 0.1, size1: 0.03, color: "#fff6b8", color1: "#ffb020" });
    }
    this.fire.emit({ x: tx + (Math.random() - 0.5) * 0.2, y: ty, z: tz + (Math.random() - 0.5) * 0.2, life: 0.1, size0: 0.1, size1: 0.02, color: "#ffe08a" });
  }

  // feixe de laser: linha brilhante de partículas e faísca no alvo
  private beam(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
    const len = Math.hypot(tx - x, tz - z, ty - y);
    const n = Math.max(6, Math.round(len * 7));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      this.fire.emit({ x: x + (tx - x) * k, y: y + (ty - y) * k, z: z + (tz - z) * k, life: 0.22, size0: 0.16, size1: 0.04, color: "#e6fdff", color1: "#24c8ff" });
    }
    this.fire.emit({ x, y, z, life: 0.2, size0: 0.4, size1: 0.1, color: "#ffffff", color1: "#38d9ff" });
    this.fire.emit({ x: tx, y: ty, z: tz, life: 0.3, size0: 0.55, size1: 0.1, color: "#ffffff", color1: "#38d9ff" });
    for (let i = 0; i < 6; i++)
      this.fire.emit({ x: tx, y: ty, z: tz, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, gravity: 8, life: 0.4, size0: 0.05, size1: 0.02, color: "#bff6ff" });
  }

  private flameBurst(x: number, y: number, z: number) {
    for (let i = 0; i < 8; i++)
      this.fire.emit({
        x: x + (Math.random() - 0.5) * 0.5,
        y: Math.max(0.1, y - 0.1),
        z: z + (Math.random() - 0.5) * 0.5,
        vy: 0.6 + Math.random() * 0.6,
        life: 0.45 + Math.random() * 0.3,
        size0: 0.2,
        size1: 0.4,
        color: "#ffd56b",
        color1: "#ff3d0d",
        alpha: 0.9,
      });
    this.smoke.emit({ x, y: 0.4, z, vy: 0.5, life: 1.2, size0: 0.2, size1: 0.6, color: "#3d3d42", alpha: 0.45 });
  }

  // estouro de flak: nuvem escura com clarão
  private flakBurst(x: number, y: number, z: number) {
    this.fire.emit({ x, y, z, life: 0.12, size0: 0.5, size1: 0.1, color: "#fff2b0", color1: "#ff9a3a" });
    for (let i = 0; i < 5; i++)
      this.smoke.emit({
        x: x + (Math.random() - 0.5) * 0.3,
        y: y + (Math.random() - 0.5) * 0.3,
        z: z + (Math.random() - 0.5) * 0.3,
        vy: 0.1,
        life: 1 + Math.random() * 0.6,
        size0: 0.2,
        size1: 0.55,
        color: "#3a3a40",
        color1: "#77777e",
        alpha: 0.65,
        drag: 2,
      });
  }

  ping(x: number, z: number, attack: boolean) {
    const mesh = new THREE.Mesh(
      this.ringFor("ping", () => new THREE.RingGeometry(0.3, 0.38, 32).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: attack ? "#ff6b5e" : "#7dffa8", transparent: true, depthWrite: false }),
    );
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    this.pings.push({ mesh, t: 0 });
  }

  private scorch(x: number, z: number, r: number) {
    this.scorchQueue.push({ x, z, r });
  }

  private flushScorch(dt: number) {
    this.scorchTimer -= dt;
    if (this.scorchTimer > 0 || (this.scorchQueue.length === 0 && this.padQueue.length === 0)) return;
    this.scorchTimer = 0.5;
    const ctx = this.terrainCanvas.getContext("2d")!;
    // pátio de concreto sob as construções, com faixas de sinalização
    for (const p of this.padQueue) {
      const m = 0.45;
      const x = (p.tx - m) * 16;
      const z = (p.tz - m) * 16;
      const w = (p.w + m * 2) * 16;
      const h = (p.h + m * 2) * 16;
      ctx.save();
      ctx.fillStyle = "rgba(70,70,64,0.22)";
      ctx.beginPath();
      ctx.roundRect(x - 3, z - 2, w + 6, h + 6, 10);
      ctx.fill();
      ctx.fillStyle = "#d9d5c8";
      ctx.beginPath();
      ctx.roundRect(x, z, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(120,114,100,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "rgba(240,190,40,0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.roundRect(x + 4, z + 4, w - 8, h - 8, 5);
      ctx.stroke();
      ctx.restore();
    }
    this.padQueue = [];
    for (const s of this.scorchQueue) {
      const px = s.x * 16;
      const pz = s.z * 16;
      const rad = s.r * 16;
      const g = ctx.createRadialGradient(px, pz, 0, px, pz, rad);
      g.addColorStop(0, "rgba(40,32,24,0.55)");
      g.addColorStop(0.6, "rgba(60,48,32,0.25)");
      g.addColorStop(1, "rgba(60,48,32,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, pz, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    this.scorchQueue = [];
    this.terrainTex.needsUpdate = true;
  }

  handleEvents(events: GameEvent[]) {
    const g = this.game;
    for (const e of events) {
      switch (e.type) {
        case "fire": {
          if (!g.isVisible(0, e.x, e.z) && !g.isVisible(0, e.tx, e.tz)) break;
          if (e.weapon === "bullet") {
            this.muzzle(e.x, e.y, e.z, e.tx, e.tz, false);
            this.tracer(e.x, e.y, e.z, e.tx, e.ty, e.tz);
          } else if (e.weapon === "laser") this.beam(e.x, e.y, e.z, e.tx, e.ty, e.tz);
          else if (e.weapon === "flame") this.fire.emit({ x: e.x, y: e.y, z: e.z, life: 0.15, size0: 0.3, size1: 0.1, color: "#fff0a0", color1: "#ff7a1a" });
          else this.muzzle(e.x, e.y, e.z, e.tx, e.tz, e.weapon !== "rocket");
          break;
        }
        case "impact":
          if (!g.isVisible(0, e.x, e.z)) break;
          if (e.weapon === "flak") {
            this.flakBurst(e.x, e.y, e.z);
            break;
          }
          if (e.weapon === "flame") {
            this.flameBurst(e.x, e.y, e.z);
            break;
          }
          this.explosion(e.x, e.z, e.big ? 0.75 : e.weapon === "cannon" ? 0.35 : 0.45, Math.max(0.15, e.y - 0.1));
          if (e.big) this.scorch(e.x, e.z, 0.7);
          break;
        case "death":
          if (!g.isVisible(0, e.x, e.z)) break;
          if (e.infantry) {
            for (let i = 0; i < 8; i++)
              this.smoke.emit({ x: e.x, y: 0.2, z: e.z, vx: (Math.random() - 0.5) * 1.2, vy: 0.5 + Math.random(), vz: (Math.random() - 0.5) * 1.2, life: 0.8, size0: 0.12, size1: 0.35, color: "#8a7c66", alpha: 0.6, drag: 2 });
          } else if (e.air) {
            // explode no ar, destroços caem e estouram no chão
            this.explosion(e.x, e.z, 0.7 + e.size, e.y);
            for (let i = 0; i < 10; i++)
              this.smoke.emit({
                x: e.x,
                y: e.y,
                z: e.z,
                vx: (Math.random() - 0.5) * 1.6,
                vy: Math.random() * 1.5,
                vz: (Math.random() - 0.5) * 1.6,
                gravity: 6,
                life: 0.9,
                size0: 0.12,
                size1: 0.08,
                color: "#2b2b30",
                alpha: 0.9,
              });
            const { x, z } = e;
            this.delayed.push({
              at: this.clock + 0.55,
              fn: () => {
                this.explosion(x, z, 0.6, 0.2);
                this.scorch(x, z, 0.8);
              },
            });
          } else {
            this.explosion(e.x, e.z, 0.9 + e.size, 0.3);
            this.scorch(e.x, e.z, 0.9);
          }
          break;
        case "buildingDeath": {
          const n = Math.max(3, e.w * e.h);
          for (let i = 0; i < n; i++) {
            const x = e.x + (Math.random() - 0.5) * e.w * 0.8;
            const z = e.z + (Math.random() - 0.5) * e.h * 0.8;
            this.delayed.push({ at: this.clock + i * 0.12, fn: () => this.explosion(x, z, 1.1, 0.4) });
          }
          this.scorch(e.x, e.z, Math.max(e.w, e.h) * 0.8);
          break;
        }
        case "sold":
          for (let i = 0; i < 20; i++)
            this.smoke.emit({ x: e.x + (Math.random() - 0.5) * e.w, y: 0.2, z: e.z + (Math.random() - 0.5) * e.h, vy: 0.6, life: 1.2, size0: 0.3, size1: 0.8, color: "#e2d6b8", alpha: 0.5 });
          break;
      }
    }
  }

  // ------------------------------------------------------------ fantasma de construção

  setDragArrow(a: { x0: number; z0: number; x1: number; z1: number; attack: boolean } | null) {
    this.dragArrow = a;
  }

  // Agrupa as tropas selecionadas por destino e desenha uma seta por grupo.
  private updateArrows() {
    const g = this.game;
    const arrows: { x0: number; z0: number; x1: number; z1: number; attack: boolean }[] = [];
    if (this.dragArrow) arrows.push(this.dragArrow);
    const groups = new Map<string, { sx: number; sz: number; dx: number; dz: number; n: number; attack: boolean }>();
    for (const id of g.selected) {
      const u = g.units.get(id);
      if (!u || u.team !== 0) continue;
      let dest: { x: number; z: number } | null = null;
      let attack = false;
      const t = g.get(u.targetId);
      if (u.order === "attack" && t) {
        dest = g.center(t);
        attack = true;
      } else if ((u.order === "move" || u.order === "attackMove") && u.goal) {
        dest = u.goal;
        attack = u.order === "attackMove";
      }
      if (!dest) continue;
      const key = `${attack ? 1 : 0}:${Math.round(dest.x / 2.5)},${Math.round(dest.z / 2.5)}`;
      const gr = groups.get(key) ?? { sx: 0, sz: 0, dx: 0, dz: 0, n: 0, attack };
      gr.sx += u.x;
      gr.sz += u.z;
      gr.dx += dest.x;
      gr.dz += dest.z;
      gr.n++;
      groups.set(key, gr);
    }
    for (const gr of groups.values()) arrows.push({ x0: gr.sx / gr.n, z0: gr.sz / gr.n, x1: gr.dx / gr.n, z1: gr.dz / gr.n, attack: gr.attack });
    const P = this.arrowPos;
    const C = this.arrowCol;
    let v = 0;
    const green = new THREE.Color("#5dff8a");
    const red = new THREE.Color("#ff5a4a");
    const put = (x: number, z: number, c: THREE.Color) => {
      P[v * 3] = x;
      P[v * 3 + 1] = 0.09;
      P[v * 3 + 2] = z;
      C[v * 3] = c.r;
      C[v * 3 + 1] = c.g;
      C[v * 3 + 2] = c.b;
      v++;
    };
    for (const a of arrows.slice(0, 48)) {
      const dx = a.x1 - a.x0;
      const dz = a.z1 - a.z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.9) continue;
      const ux = dx / len;
      const uz = dz / len;
      const nx = -uz;
      const nz = ux;
      const c = a.attack ? red : green;
      const w = 0.09;
      const hw = 0.3;
      const head = Math.min(0.6, len * 0.4);
      const sx = a.x0 + ux * 0.45;
      const sz = a.z0 + uz * 0.45;
      const ex = a.x1 - ux * head;
      const ez = a.z1 - uz * head;
      // haste
      put(sx + nx * w, sz + nz * w, c);
      put(sx - nx * w, sz - nz * w, c);
      put(ex + nx * w, ez + nz * w, c);
      put(ex + nx * w, ez + nz * w, c);
      put(sx - nx * w, sz - nz * w, c);
      put(ex - nx * w, ez - nz * w, c);
      // ponta
      put(ex + nx * hw, ez + nz * hw, c);
      put(ex - nx * hw, ez - nz * hw, c);
      put(a.x1, a.z1, c);
    }
    const geo = this.arrowMesh.geometry;
    geo.setDrawRange(0, v);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    const m = this.arrowMesh.material as THREE.MeshBasicMaterial;
    m.opacity = 0.7 + Math.sin(this.clock * 6) * 0.15;
  }

  setGhost(kind: BuildingKind | null, tx: number, tz: number, valid: boolean) {
    if (!kind) {
      if (this.ghost) {
        this.scene.remove(this.ghost);
        this.ghost = null;
        this.ghostKey = "";
      }
      return;
    }
    const d = BUILDINGS[kind];
    if (this.ghostKey !== kind) {
      if (this.ghost) this.scene.remove(this.ghost);
      const grp = new THREE.Group();
      const model = this.ghostKit.building(kind, 0);
      grp.add(model.root);
      this.ghostTiles = [];
      const tileGeo = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
      for (let z = 0; z < d.h; z++)
        for (let x = 0; x < d.w; x++) {
          const t = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ color: "#5bff8d", transparent: true, opacity: 0.4, depthWrite: false }));
          t.position.set(x - d.w / 2 + 0.5, 0.04, z - d.h / 2 + 0.5);
          t.renderOrder = 3;
          grp.add(t);
          this.ghostTiles.push(t);
        }
      this.ghost = grp;
      this.ghostKey = kind;
      this.scene.add(grp);
    }
    this.ghost!.position.set(tx + d.w / 2, 0, tz + d.h / 2);
    for (const t of this.ghostTiles) (t.material as THREE.MeshBasicMaterial).color.set(valid ? "#5bff8d" : "#ff5a4a");
  }

  // ------------------------------------------------------------ quadro

  render(dt: number) {
    this.clock += dt;
    const g = this.game;
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      if (this.delayed[i].at <= this.clock) {
        this.delayed[i].fn();
        this.delayed.splice(i, 1);
      }
    }
    this.updateFog(dt);
    if (g.oreVersion !== this.oreVersion) {
      this.oreVersion = g.oreVersion;
      this.updateOre();
    }
    this.syncEntities(dt);
    this.syncProjectiles();
    this.updateArrows();
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      const k = p.t / 0.6;
      p.mesh.scale.setScalar(1.4 - k);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.pings.splice(i, 1);
      }
    }
    for (const s of this.spires) s.rotation.y += dt * 0.3;
    const LQ = this.biome.liquid;
    (this.water.material as THREE.MeshStandardMaterial).emissiveIntensity = LQ.emissiveIntensity + Math.sin(this.clock * 1.3) * LQ.pulse;
    this.ambientParticles(dt);
    if (this.liquidTex && LQ.texture === "lava") {
      // a lava escorre devagar
      this.liquidTex.offset.x += dt * 0.006;
      this.liquidTex.offset.y += dt * 0.004;
    }
    this.flushScorch(dt);
    const pxPerUnit = (this.renderer.getPixelRatio() * this.height) / this.viewHeight;
    this.fire.update(dt, pxPerUnit);
    this.smoke.update(dt, pxPerUnit);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
