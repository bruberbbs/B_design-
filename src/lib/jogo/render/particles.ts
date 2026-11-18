// Partículas suaves (fogo, fumaça, faíscas, poeira) desenhadas como pontos redondos.

import * as THREE from "three";

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uScale);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, uSoft, d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
`;

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  color: THREE.ColorRepresentation;
  color1?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

export class ParticleSystem {
  points: THREE.Points;
  private max: number;
  private count = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private alpha0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  material: THREE.ShaderMaterial;
  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max * 2);
    this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.aPos);
    g.setAttribute("aColor", this.aCol);
    g.setAttribute("aSize", this.aSize);
    g.setAttribute("aAlpha", this.aAlpha);
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 40 }, uSoft: { value: additive ? 0.0 : 0.2 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  emit(p: ParticleSpec) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    this.tmpA.set(p.color);
    this.tmpB.set(p.color1 ?? p.color);
    this.col0.set([this.tmpA.r, this.tmpA.g, this.tmpA.b], i * 3);
    this.col1.set([this.tmpB.r, this.tmpB.g, this.tmpB.b], i * 3);
    this.life[i] = 0;
    this.maxLife[i] = p.life;
    this.size[i * 2] = p.size0;
    this.size[i * 2 + 1] = p.size1;
    this.alpha0[i] = p.alpha ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
  }

  private copy(from: number, to: number) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.col0[to * 3 + k] = this.col0[from * 3 + k];
      this.col1[to * 3 + k] = this.col1[from * 3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size[to * 2] = this.size[from * 2];
    this.size[to * 2 + 1] = this.size[from * 2 + 1];
    this.alpha0[to] = this.alpha0[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
  }

  update(dt: number, scale: number) {
    this.material.uniforms.uScale.value = scale;
    let i = 0;
    while (i < this.count) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        this.count--;
        if (i !== this.count) this.copy(this.count, i);
        continue;
      }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      i++;
    }
    const P = this.aPos.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const S = this.aSize.array as Float32Array;
    const A = this.aAlpha.array as Float32Array;
    for (let j = 0; j < this.count; j++) {
      const t = this.life[j] / this.maxLife[j];
      P[j * 3] = this.pos[j * 3];
      P[j * 3 + 1] = this.pos[j * 3 + 1];
      P[j * 3 + 2] = this.pos[j * 3 + 2];
      for (let k = 0; k < 3; k++) C[j * 3 + k] = this.col0[j * 3 + k] + (this.col1[j * 3 + k] - this.col0[j * 3 + k]) * t;
      S[j] = this.size[j * 2] + (this.size[j * 2 + 1] - this.size[j * 2]) * t;
      A[j] = this.alpha0[j] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.count);
  }
}
