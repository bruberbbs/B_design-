// Efeitos sonoros sintetizados (sem arquivos de áudio).

import type { GameEvent } from "./game";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private budget = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private noiseBurst(dur: number, freq: number, type: BiquadFilterType, vol: number, pitchEnd?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (pitchEnd) f.frequency.exponentialRampToValueAtTime(pitchEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, freqEnd?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  click() {
    if (!this.enabled) return;
    this.tone(880, 0.06, "sine", 0.12, 0, 660);
  }

  ui() {
    if (!this.enabled) return;
    this.tone(620, 0.05, "triangle", 0.1);
  }

  // `near(x, z)` devolve 0..1 conforme a distância até a câmera; 0 = não toca.
  handle(events: GameEvent[], near: (x: number, z: number) => number) {
    if (!this.enabled || !this.ctx) return;
    this.budget = 6;
    for (const e of events) {
      if (this.budget <= 0) break;
      switch (e.type) {
        case "fire": {
          const v = near(e.x, e.z);
          if (v <= 0) break;
          this.budget--;
          if (e.weapon === "bullet") this.noiseBurst(0.07, 2400, "bandpass", 0.25 * v);
          else if (e.weapon === "cannon") {
            this.noiseBurst(0.25, 900, "lowpass", 0.5 * v, 120);
            this.tone(110, 0.18, "sine", 0.25 * v, 0, 50);
          } else if (e.weapon === "rocket") this.noiseBurst(0.4, 3000, "bandpass", 0.18 * v, 600);
          else this.noiseBurst(0.35, 500, "lowpass", 0.6 * v, 80);
          break;
        }
        case "impact": {
          const v = near(e.x, e.z);
          if (v <= 0 || e.weapon === "bullet") break;
          this.budget--;
          this.noiseBurst(e.big ? 0.7 : 0.35, e.big ? 700 : 1200, "lowpass", (e.big ? 0.6 : 0.3) * v, 60);
          break;
        }
        case "death": {
          const v = near(e.x, e.z);
          if (v <= 0) break;
          this.budget--;
          if (e.infantry) this.tone(320, 0.18, "triangle", 0.08 * v, 0, 160);
          else {
            this.noiseBurst(0.9, 900, "lowpass", 0.8 * v, 50);
            this.tone(70, 0.5, "sine", 0.4 * v, 0, 30);
          }
          break;
        }
        case "buildingDeath": {
          const v = Math.max(0.4, near(e.x, e.z));
          this.budget--;
          this.noiseBurst(1.6, 600, "lowpass", 0.9 * v, 40);
          this.tone(55, 1.0, "sine", 0.5 * v, 0, 25);
          break;
        }
        case "placed":
          if (e.team !== 0) break;
          this.noiseBurst(0.5, 400, "lowpass", 0.35, 100);
          this.tone(220, 0.12, "square", 0.05, 0.05);
          break;
        case "sold":
          this.tone(520, 0.1, "triangle", 0.12);
          this.tone(780, 0.14, "triangle", 0.12, 0.1);
          break;
        case "unitReady":
          this.tone(660, 0.1, "triangle", 0.14);
          this.tone(990, 0.16, "triangle", 0.14, 0.1);
          break;
        case "structureReady":
          this.tone(523, 0.12, "triangle", 0.16);
          this.tone(659, 0.12, "triangle", 0.16, 0.12);
          this.tone(784, 0.2, "triangle", 0.16, 0.24);
          break;
        case "msg":
          if (e.tone === "warn") {
            this.tone(440, 0.16, "square", 0.06);
            this.tone(330, 0.22, "square", 0.06, 0.18);
          }
          break;
        case "click":
          this.click();
          break;
      }
    }
  }
}
