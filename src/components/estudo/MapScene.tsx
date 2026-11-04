"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { City, Lot, Rect } from "@/lib/estudo/city";
import { ZONES } from "@/lib/estudo/zoning";
import type { LotMass } from "@/lib/estudo/study";

export interface Layers {
  edificacoes: boolean;
  lotes: boolean;
  zoneamento: boolean;
  app: boolean;
  ruas: boolean;
  status: boolean;
}

export interface MapApi {
  flyToLots: (ids: string[]) => void;
  resetView: () => void;
  snapshot: () => string | null;
}

interface Props {
  city: City;
  selectedIds: string[];
  masses: LotMass[];
  view: "2d" | "3d";
  layers: Layers;
  sun: [number, number, number] | null;
  onPick: (lot: Lot) => void;
  apiRef: RefObject<MapApi | null>;
}

const STATUS_COLORS = {
  desenvolvimento: "#6fae6f",
  andamento: "#d9b44a",
  concluida: "#8a7ad6",
} as const;

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sunLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  buildings: THREE.InstancedMesh;
  buildingIndex: Map<string, number>;
  buildingMatrices: THREE.Matrix4[];
  groups: Record<keyof Layers, THREE.Object3D>;
  selection: THREE.Group;
  massGroup: THREE.Group;
  hover: THREE.LineLoop;
  anim: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t0: number; dur: number } | null;
}

function rectOutline(r: Rect, y: number): THREE.Vector3[] {
  return [
    new THREE.Vector3(r.x0, y, r.z0),
    new THREE.Vector3(r.x1, y, r.z0),
    new THREE.Vector3(r.x1, y, r.z1),
    new THREE.Vector3(r.x0, y, r.z1),
  ];
}

function flatRect(r: Rect, y: number, material: THREE.Material) {
  const geo = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

function ribbon(points: [number, number][], width: number, y: number, material: THREE.Material) {
  const pos: number[] = [];
  const idx: number[] = [];
  // reamostra a polilinha com suavização simples para curvas mais orgânicas
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const pts = curve.getSpacedPoints(160);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    pos.push(pts[i].x + n.x, y, pts[i].z + n.z, pts[i].x - n.x, y, pts[i].z - n.z);
    if (i < pts.length - 1) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { mesh: new THREE.Mesh(geo, material), curvePoints: pts };
}

function hatchTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9d3bf";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#7f9474";
  g.lineWidth = 3;
  for (let i = -64; i < 128; i += 12) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textPlane(text: string, length: number, height: number) {
  const c = document.createElement("canvas");
  const fontPx = 48;
  const g = c.getContext("2d")!;
  g.font = `500 ${fontPx}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 20;
  c.width = w;
  c.height = fontPx + 16;
  g.font = `500 ${fontPx}px system-ui, sans-serif`;
  g.fillStyle = "#8b8a85";
  g.textBaseline = "middle";
  g.fillText(text, 10, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const aspect = c.width / c.height;
  const h = Math.min(height, length / aspect);
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

export function MapScene({ city, selectedIds, masses, view, layers, sun, onPick, apiRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneState | null>(null);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // --- criação da cena (uma vez por cidade) ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "block h-full w-full touch-none";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f1f0ec");
    scene.fog = new THREE.Fog("#f1f0ec", 900, 2200);

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.position.set(-120, 520, 620);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.minDistance = 40;
    controls.maxDistance = 1600;
    controls.maxPolarAngle = 1.25;
    controls.target.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight("#ffffff", "#d9d6cc", 1.6);
    scene.add(hemi);
    const sunLight = new THREE.DirectionalLight("#ffffff", 1.8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    const sc = sunLight.shadow.camera;
    sc.left = -800;
    sc.right = 800;
    sc.top = 800;
    sc.bottom = -800;
    sc.near = 10;
    sc.far = 3000;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.6;
    scene.add(sunLight, sunLight.target);

    // chão
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: "#e4e2db" }),
    );
    ground.receiveShadow = true;
    scene.add(ground);

    // quadras (calçadas)
    const blockMat = new THREE.MeshLambertMaterial({ color: "#f6f5f1" });
    for (const b of city.blocks) scene.add(flatRect({ x0: b.x0 - 2, z0: b.z0 - 2, x1: b.x1 + 2, z1: b.z1 + 2 }, 0.04, blockMat));

    // área de preservação
    const tex = hatchTexture();
    const p = city.preservation;
    tex.repeat.set((p.x1 - p.x0) / 18, (p.z1 - p.z0) / 18);
    const presMesh = flatRect(p, 0.07, new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.85 }));
    scene.add(presMesh);

    // camadas
    const groups: SceneState["groups"] = {
      edificacoes: new THREE.Group(),
      lotes: new THREE.Group(),
      zoneamento: new THREE.Group(),
      app: new THREE.Group(),
      ruas: new THREE.Group(),
      status: new THREE.Group(),
    };
    Object.values(groups).forEach((g) => scene.add(g));

    // lotes: contornos
    const linePos: number[] = [];
    for (const l of city.lots) {
      const v = rectOutline(l.rect, 0.1);
      for (let i = 0; i < 4; i++) {
        const a = v[i];
        const b = v[(i + 1) % 4];
        linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const lotLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3)),
      new THREE.LineBasicMaterial({ color: "#c4c2ba" }),
    );
    groups.lotes.add(lotLines);

    // zoneamento: preenchimento colorido
    const zPos: number[] = [];
    const zCol: number[] = [];
    const col = new THREE.Color();
    for (const l of city.lots) {
      col.set(ZONES[l.zone].cor);
      const { x0, z0, x1, z1 } = l.rect;
      const y = 0.09;
      zPos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
      for (let i = 0; i < 6; i++) zCol.push(col.r, col.g, col.b);
    }
    const zGeo = new THREE.BufferGeometry();
    zGeo.setAttribute("position", new THREE.Float32BufferAttribute(zPos, 3));
    zGeo.setAttribute("color", new THREE.Float32BufferAttribute(zCol, 3));
    groups.zoneamento.add(
      new THREE.Mesh(zGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false })),
    );

    // rio e APP
    const appMat = new THREE.MeshBasicMaterial({ color: "#7c9fc4", transparent: true, opacity: 0.32, depthWrite: false });
    const app = ribbon(city.river, city.appWidth * 2, 0.12, appMat);
    groups.app.add(app.mesh);
    const edgeMat = new THREE.LineDashedMaterial({ color: "#4f6f93", dashSize: 3, gapSize: 2 });
    for (const side of [1, -1]) {
      const pts = app.curvePoints.map((pt, i, arr) => {
        const a = arr[Math.max(0, i - 1)];
        const b = arr[Math.min(arr.length - 1, i + 1)];
        const d = new THREE.Vector3().subVectors(b, a).normalize();
        return new THREE.Vector3(pt.x - d.z * city.appWidth * side, 0.14, pt.z + d.x * city.appWidth * side);
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat);
      line.computeLineDistances();
      groups.app.add(line);
    }
    const riverMesh = ribbon(city.river, 9, 0.13, new THREE.MeshLambertMaterial({ color: "#8db1cf" })).mesh;
    scene.add(riverMesh);

    // nomes de ruas
    for (const s of city.streets) {
      const len = s.to - s.from;
      for (const f of [0.22, 0.72]) {
        const label = textPlane(s.name, 70, s.width * 0.42);
        const along = s.from + len * f;
        if (s.orientation === "h") label.position.set(along, 0.06, s.at);
        else {
          label.rotation.y = Math.PI / 2;
          label.position.set(s.at, 0.06, along);
        }
        groups.ruas.add(label);
      }
    }

    // edificações existentes
    const withBuilding = city.lots.filter((l) => l.building);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const buildings = new THREE.InstancedMesh(
      boxGeo,
      new THREE.MeshLambertMaterial({ color: "#fbfbf9" }),
      withBuilding.length,
    );
    buildings.castShadow = true;
    buildings.receiveShadow = true;
    const buildingIndex = new Map<string, number>();
    const buildingMatrices: THREE.Matrix4[] = [];
    withBuilding.forEach((l, i) => {
      const b = l.building!;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3((b.rect.x0 + b.rect.x1) / 2, 0, (b.rect.z0 + b.rect.z1) / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(b.rect.x1 - b.rect.x0, b.height, b.rect.z1 - b.rect.z0),
      );
      buildings.setMatrixAt(i, m);
      buildingIndex.set(l.id, i);
      buildingMatrices.push(m);
    });
    groups.edificacoes.add(buildings);

    // marcadores de status
    const markerGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.6, 24);
    for (const l of city.lots) {
      if (!l.status) continue;
      const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: STATUS_COLORS[l.status] }));
      const h = l.building ? l.building.height : 0;
      m.position.set((l.rect.x0 + l.rect.x1) / 2, h + 1, (l.rect.z0 + l.rect.z1) / 2);
      groups.status.add(m);
    }

    const selection = new THREE.Group();
    const massGroup = new THREE.Group();
    scene.add(selection, massGroup);

    const hover = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(rectOutline({ x0: 0, z0: 0, x1: 1, z1: 1 }, 0.2)),
      new THREE.LineBasicMaterial({ color: "#3b3a36" }),
    );
    hover.visible = false;
    scene.add(hover);

    const state: SceneState = {
      renderer,
      scene,
      camera,
      controls,
      sunLight,
      hemi,
      buildings,
      buildingIndex,
      buildingMatrices,
      groups,
      selection,
      massGroup,
      hover,
      anim: null,
    };
    stateRef.current = state;

    // --- picking ---
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const lotAt = (clientX: number, clientY: number): Lot | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      for (const l of city.lots) {
        const r = l.rect;
        if (hit.x >= r.x0 && hit.x <= r.x1 && hit.z >= r.z0 && hit.z <= r.z1) return l;
      }
      return null;
    };

    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
        const lot = lotAt(e.clientX, e.clientY);
        if (lot) onPickRef.current(lot);
      }
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const lot = lotAt(e.clientX, e.clientY);
      if (lot) {
        hover.geometry.setFromPoints(rectOutline(lot.rect, 0.2));
        hover.visible = true;
        renderer.domElement.style.cursor = "pointer";
      } else {
        hover.visible = false;
        renderer.domElement.style.cursor = "";
      }
    };
    const onLeave = () => {
      hover.visible = false;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    // --- resize ---
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // --- loop ---
    let raf = 0;
    const tick = (t: number) => {
      const a = state.anim;
      if (a) {
        const k = Math.min(1, (t - a.t0) / a.dur);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        controls.target.lerpVectors(a.from, a.to, e);
        camera.position.lerpVectors(a.camFrom, a.camTo, e);
        if (k >= 1) state.anim = null;
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [city]);

  // --- API imperativa ---
  useEffect(() => {
    const animateTo = (target: THREE.Vector3, distance: number) => {
      const s = stateRef.current;
      if (!s) return;
      const dir = new THREE.Vector3().subVectors(s.camera.position, s.controls.target).normalize();
      s.anim = {
        from: s.controls.target.clone(),
        to: target,
        camFrom: s.camera.position.clone(),
        camTo: target.clone().add(dir.multiplyScalar(distance)),
        t0: performance.now(),
        dur: 900,
      };
    };
    apiRef.current = {
      flyToLots: (ids) => {
        const lots = city.lots.filter((l) => ids.includes(l.id));
        if (!lots.length) return;
        const x0 = Math.min(...lots.map((l) => l.rect.x0));
        const x1 = Math.max(...lots.map((l) => l.rect.x1));
        const z0 = Math.min(...lots.map((l) => l.rect.z0));
        const z1 = Math.max(...lots.map((l) => l.rect.z1));
        const size = Math.max(x1 - x0, z1 - z0);
        const dist = Math.max(230, size * 4.5);
        const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
        // desloca o alvo para o lote não ficar escondido atrás do painel
        const s = stateRef.current;
        if (s) {
          const right = new THREE.Vector3().setFromMatrixColumn(s.camera.matrixWorld, 0).setY(0).normalize();
          const forward = new THREE.Vector3().subVectors(s.controls.target, s.camera.position).setY(0);
          if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
          forward.normalize();
          if (window.innerWidth >= 640) center.addScaledVector(right, dist * 0.3);
          else center.addScaledVector(forward, -dist * 0.32);
        }
        animateTo(center, dist);
      },
      resetView: () => animateTo(new THREE.Vector3(0, 0, 0), 820),
      snapshot: () => stateRef.current?.renderer.domElement.toDataURL("image/png") ?? null,
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, city]);

  // --- seleção ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.selection.children.forEach((c) => {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    s.selection.clear();
    for (const id of selectedIds) {
      const lot = city.lots.find((l) => l.id === id);
      if (!lot) continue;
      s.selection.add(
        flatRect(lot.rect, 0.11, new THREE.MeshBasicMaterial({ color: "#2f6b55", transparent: true, opacity: 0.16, depthWrite: false })),
      );
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(rectOutline(lot.rect, 0.22)),
        new THREE.LineBasicMaterial({ color: "#1f5a46" }),
      );
      s.selection.add(outline);
    }
  }, [selectedIds, city]);

  // --- estudo de massa ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.massGroup.children.forEach((c) => {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    s.massGroup.clear();

    // esconde as edificações existentes nos lotes com estudo
    const hidden = new Set(masses.map((m) => m.lotId));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    s.buildingIndex.forEach((i, lotId) => {
      s.buildings.setMatrixAt(i, hidden.has(lotId) ? zero : s.buildingMatrices[i]);
    });
    s.buildings.instanceMatrix.needsUpdate = true;

    for (const m of masses) {
      const w = m.footprint.x1 - m.footprint.x0;
      const d = m.footprint.z1 - m.footprint.z0;
      if (w <= 0 || d <= 0) continue;
      for (let f = 0; f < m.floors; f++) {
        const geo = new THREE.BoxGeometry(w, m.floorHeight - 0.12, d);
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshLambertMaterial({ color: f === 0 ? "#9fabc2" : "#b3bdd1", transparent: true, opacity: 0.95 }),
        );
        mesh.position.set((m.footprint.x0 + m.footprint.x1) / 2, f * m.floorHeight + m.floorHeight / 2, (m.footprint.z0 + m.footprint.z1) / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        s.massGroup.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: "#5d6880" }));
        edges.position.copy(mesh.position);
        s.massGroup.add(edges);
      }
    }
  }, [masses]);

  // --- camadas ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    (Object.keys(layers) as (keyof Layers)[]).forEach((k) => {
      s.groups[k].visible = layers[k];
    });
  }, [layers]);

  // --- 2D / 3D ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const { controls, camera } = s;
    const dist = camera.position.distanceTo(controls.target);
    if (view === "2d") {
      controls.enableRotate = false;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = 0;
      s.anim = {
        from: controls.target.clone(),
        to: controls.target.clone(),
        camFrom: camera.position.clone(),
        camTo: controls.target.clone().add(new THREE.Vector3(0, dist, 0.01)),
        t0: performance.now(),
        dur: 700,
      };
    } else {
      controls.enableRotate = true;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = 1.25;
      const off = new THREE.Vector3(-0.25, 0.75, 0.62).normalize().multiplyScalar(dist);
      s.anim = {
        from: controls.target.clone(),
        to: controls.target.clone(),
        camFrom: camera.position.clone(),
        camTo: controls.target.clone().add(off),
        t0: performance.now(),
        dur: 700,
      };
    }
  }, [view]);

  // --- sol ---
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const dir = sun ?? [-0.45, 0.75, 0.35];
    const v = new THREE.Vector3(...dir);
    const up = Math.max(0, v.y);
    s.sunLight.position.copy(v.clone().multiplyScalar(1200));
    s.sunLight.target.position.set(0, 0, 0);
    s.sunLight.intensity = sun ? (up > 0.02 ? 2.0 : 0) : 1.8;
    s.hemi.intensity = sun ? 1.1 + up * 0.8 : 1.6;
  }, [sun]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
