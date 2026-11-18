// Gera ícones das unidades e construções renderizando os próprios modelos 3D.

import * as THREE from "three";
import { BUILDINGS, UNITS, type BuildingKind, type UnitKind } from "../defs";
import { ModelKit } from "./models";

export function renderThumbnails(size = 112): Record<string, string> {
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
  scene.add(new THREE.HemisphereLight("#eef6ff", "#6b7a52", 1.6));
  const sun = new THREE.DirectionalLight("#fff2dc", 2.4);
  sun.position.set(-3, 6, -4);
  scene.add(sun);
  const kit = new ModelKit(() => {});
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

  for (const k of Object.keys(UNITS) as UnitKind[]) {
    const m = kit.unit(k, 0);
    m.body.rotation.y = 0.5;
    const r = UNITS[k].infantry ? 0.34 : k === "heavy" ? 0.72 : 0.6;
    out[k] = shoot(m.root, r, UNITS[k].infantry ? 0.22 : 0.25);
  }
  for (const k of Object.keys(BUILDINGS) as BuildingKind[]) {
    const m = kit.building(k, 0);
    const d = BUILDINGS[k];
    out[k] = shoot(m.root, Math.max(d.w, d.h) * 0.62 + 0.15, k === "turret" ? 0.3 : 0.5);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
