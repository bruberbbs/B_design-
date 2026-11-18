// Gera ícones das unidades e construções renderizando os próprios modelos 3D.

import * as THREE from "three";
import { BUILDINGS, UNITS, type BuildingKind, type FactionInfo, type UnitKind } from "../defs";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ModelKit } from "./models";

// Chaves: "<tipo>" com as cores do jogador e "e:<tipo>" com as do inimigo.
export function renderThumbnails(colors: [FactionInfo, FactionInfo], size = 112): Record<string, string> {
  const out: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight("#eef6ff", "#7a6f58", 1.1));
  const sun = new THREE.DirectionalLight("#fff2dc", 3.0);
  sun.position.set(-3, 6, -4);
  scene.add(sun);
  const kit = new ModelKit(
    () => {},
    (t) => colors[t],
  );
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  const dir = new THREE.Vector3(-0.55, 0.62, 0.55).normalize();

  const shoot = (obj: THREE.Object3D, radius: number, y: number) => {
    scene.add(obj);
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.updateProjectionMatrix();
    const target = new THREE.Vector3(0, y, 0);
    cam.position.copy(target).addScaledVector(dir, 20);
    cam.lookAt(target);
    renderer.render(scene, cam);
    const url = canvas.toDataURL("image/png");
    scene.remove(obj);
    return url;
  };

  for (const team of [0, 1] as const) {
    const prefix = team === 0 ? "" : "e:";
    for (const k of Object.keys(UNITS) as UnitKind[]) {
      const m = kit.unit(k, team);
      m.body.rotation.y = 0.5;
      const r = k === "exo" ? 0.52 : UNITS[k].infantry ? 0.44 : k === "colosso" ? 0.95 : k === "heavy" || k === "heli" || k === "tufao" || k === "caca" ? 0.72 : 0.6;
      out[prefix + k] = shoot(m.root, r, UNITS[k].air ? 0 : UNITS[k].infantry ? 0.3 : 0.27);
    }
    for (const k of Object.keys(BUILDINGS) as BuildingKind[]) {
      const m = kit.building(k, team);
      const d = BUILDINGS[k];
      out[prefix + k] = shoot(m.root, Math.max(d.w, d.h) * 0.62 + 0.15, d.w === 1 ? 0.3 : 0.5);
    }
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
