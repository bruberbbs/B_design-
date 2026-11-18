// Trilha sonora adaptativa, composta e sintetizada em tempo real (Web Audio, sem arquivos).
// Cada facção tem seu tema; a intensidade (calmo → tensão → batalha) acompanha a partida.

import type { Faction } from "./defs";
import type { Game, GameEvent } from "./game";

export type Intensity = 0 | 1 | 2;

interface LeadNote {
  step: number; // em semicolcheias, dentro de 2 compassos (0..31)
  midi: number;
  len: number;
}

interface Theme {
  bpm: number;
  chords: number[][]; // 8 compassos, notas MIDI do acorde (voicing médio)
  bass: number[]; // fundamental de cada compasso
  motifs: [LeadNote[], LeadNote[]]; // dois motivos de 2 compassos
  arp: number[]; // índices de notas do acorde (semicolcheias); -1 = pausa
  bright: boolean;
}

const n = (step: number, midi: number, len: number): LeadNote => ({ step, midi, len });

const THEMES: Record<Faction, Theme> = {
  // Ré maior: heroico e luminoso.
  aurora: {
    bpm: 104,
    chords: [
      [62, 66, 69], // D
      [59, 62, 66], // Bm
      [55, 59, 62, 66], // Gmaj7
      [57, 61, 64], // A
      [62, 66, 69], // D
      [54, 57, 61], // F#m
      [55, 59, 62], // G
      [57, 62, 64], // Asus4
    ],
    bass: [38, 35, 31, 33, 38, 42, 43, 45],
    motifs: [
      [n(0, 69, 4), n(4, 66, 2), n(6, 69, 2), n(8, 71, 6), n(14, 69, 2), n(16, 74, 4), n(20, 73, 2), n(22, 71, 2), n(24, 69, 8)],
      [n(0, 67, 4), n(4, 71, 2), n(6, 74, 2), n(8, 73, 6), n(14, 71, 2), n(16, 69, 4), n(20, 71, 2), n(22, 73, 2), n(24, 76, 8)],
    ],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3],
    bright: true,
  },
  // Dó menor com toques frígios: sombrio e marcial.
  escarlate: {
    bpm: 92,
    chords: [
      [60, 63, 67], // Cm
      [56, 60, 63], // Ab
      [58, 62, 65], // Bb
      [60, 63, 67], // Cm
      [60, 63, 67], // Cm
      [61, 65, 68], // Db
      [56, 60, 63], // Ab
      [55, 59, 62], // G
    ],
    bass: [36, 32, 34, 36, 36, 37, 32, 31],
    motifs: [
      [n(0, 72, 3), n(3, 67, 3), n(6, 75, 2), n(8, 74, 4), n(12, 72, 4), n(16, 68, 6), n(22, 67, 2), n(24, 72, 8)],
      [n(0, 70, 3), n(3, 65, 3), n(6, 74, 2), n(8, 72, 4), n(12, 70, 4), n(16, 67, 6), n(22, 68, 2), n(24, 67, 8)],
    ],
    arp: [0, -1, 0, 2, -1, 0, 3, -1, 0, -1, 0, 2, -1, 1, 3, 2],
    bright: false,
  },
};

// Bateria por intensidade (16 semicolcheias). k = bumbo, s = caixa, h = chimbal, t = tom.
const DRUMS: Record<Intensity, { k: number[]; s: number[]; h: number[]; hv: number }> = {
  0: { k: [0, 8], s: [], h: [4, 12], hv: 0.35 },
  1: { k: [0, 6, 8], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14], hv: 0.5 },
  2: { k: [0, 3, 6, 8, 11], s: [4, 12, 15], h: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], hv: 0.55 },
};

// Volume de cada camada por intensidade.
const MIX: Record<Intensity, { pad: number; arp: number; bass: number; drums: number; lead: number }> = {
  0: { pad: 1, arp: 0.55, bass: 0.45, drums: 0.4, lead: 0 },
  1: { pad: 0.8, arp: 0.8, bass: 0.9, drums: 0.75, lead: 0.7 },
  2: { pad: 0.65, arp: 1, bass: 1, drums: 1, lead: 0.9 },
};

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private filter: BiquadFilterNode;
  private bus: Record<"pad" | "arp" | "bass" | "drums" | "lead", GainNode>;
  private reverb: GainNode;
  private delay: GainNode;
  private noise: AudioBuffer;
  private distCurve: Float32Array<ArrayBuffer>;
  private theme: Theme;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0; // semicolcheia global
  private intensity: Intensity = 0;
  private pending: Intensity = 0;
  private lowerSince = 0;
  private enabled = true;
  private volume = 0.55;
  private stopped = false;

  constructor(ctx: AudioContext, faction: Faction) {
    this.ctx = ctx;
    this.theme = THEMES[faction];
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 18000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.out.connect(this.filter).connect(comp).connect(ctx.destination);

    // reverberação gerada (ruído com decaimento) e eco
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.6);
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.35;
    this.reverb.connect(conv).connect(this.out);
    const beat = 60 / this.theme.bpm;
    const dl = ctx.createDelay(2);
    dl.delayTime.value = beat * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dlf = ctx.createBiquadFilter();
    dlf.type = "lowpass";
    dlf.frequency.value = 2800;
    this.delay = ctx.createGain();
    this.delay.gain.value = 0.3;
    this.delay.connect(dl).connect(dlf).connect(fb).connect(dl);
    dlf.connect(this.out);

    this.distCurve = new Float32Array(1024);
    for (let i = 0; i < this.distCurve.length; i++) {
      const x = (i / (this.distCurve.length - 1)) * 2 - 1;
      this.distCurve[i] = Math.tanh(x * 3);
    }

    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out);
      return g;
    };
    const m = MIX[0];
    this.bus = { pad: mk(m.pad), arp: mk(m.arp), bass: mk(m.bass), drums: mk(m.drums), lead: mk(m.lead) };
    this.bus.pad.connect(this.reverb);
    this.bus.lead.connect(this.reverb);
    this.bus.lead.connect(this.delay);
    this.bus.arp.connect(this.delay);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private impulse(seconds: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  // ------------------------------------------------------------ controle

  start() {
    if (this.timer !== null || this.stopped) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.fadeTo(this.enabled ? this.volume : 0, 2);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  dispose() {
    this.stopped = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.15);
    window.setTimeout(() => this.out.disconnect(), 1200);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.fadeTo(on ? this.volume : 0, 0.6);
  }

  // Pausa: abafa e abaixa a música.
  setPaused(paused: boolean) {
    const t = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(paused ? 700 : 18000, t, 0.25);
    this.fadeTo(this.enabled ? (paused ? this.volume * 0.5 : this.volume) : 0, 0.4);
  }

  private fadeTo(v: number, secs: number) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(v, t + secs);
  }

  // Sobe de intensidade logo; só desce depois de alguns segundos de calma.
  requestIntensity(level: Intensity, now: number) {
    if (level > this.pending) {
      this.pending = level;
      this.lowerSince = now;
    } else if (level < this.pending) {
      if (now - this.lowerSince > 9) {
        this.pending = level;
        this.lowerSince = now;
      }
    } else {
      this.lowerSince = now;
    }
  }

  get currentIntensity() {
    return this.intensity;
  }

  // Vinheta final: para o laço e toca fanfarra (vitória) ou lamento (derrota).
  ending(victory: boolean, at = this.ctx.currentTime) {
    if (this.stopped) return;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    const t = at + 0.3;
    const root = this.theme.bass[0] + 24;
    const notes = victory ? [0, 4, 7, 12, 16, 19, 24] : [12, 10, 7, 3, 0];
    notes.forEach((iv, i) => {
      const last = i === notes.length - 1;
      this.lead(t + i * 0.16, root + (victory ? iv : iv - 12), last ? 2.4 : 0.3, 0.9);
    });
    const end = t + notes.length * 0.16;
    const chord = victory ? [0, 4, 7, 12] : [0, 3, 7];
    for (const iv of chord) this.pad(end, root - 12 + iv, 3.2, 0.9);
    this.kick(end, 1);
    this.fadeTo(this.enabled ? this.volume : 0, 0.2);
  }

  // ------------------------------------------------------------ sequenciador

  private schedule() {
    const ahead = this.ctx.currentTime + 0.18;
    const sixteenth = 60 / this.theme.bpm / 4;
    while (this.nextTime < ahead) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private playStep(step: number, t: number, s16: number) {
    const th = this.theme;
    const inBar = step % 16;
    const bar = Math.floor(step / 16) % 8;
    if (inBar === 0) {
      // troca de intensidade só no começo do compasso
      if (this.pending !== this.intensity) {
        this.intensity = this.pending;
        const m = MIX[this.intensity];
        for (const k of Object.keys(m) as (keyof typeof m)[]) {
          const g = this.bus[k].gain;
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t);
          g.linearRampToValueAtTime(m[k], t + s16 * 16);
        }
      }
    }
    const level = this.intensity;
    const chord = th.chords[bar];

    // pad: acorde inteiro por compasso
    if (inBar === 0) for (const note of chord) this.pad(t, note, s16 * 16, 0.5);

    // baixo
    this.bassStep(t, th.bass[bar], inBar, level, s16);

    // arpejo
    const ai = th.arp[inBar];
    if (ai >= 0 && (level > 0 || inBar % 2 === 0)) {
      const tones = [...chord, chord[0] + 12, chord[1] + 12];
      const midi = tones[ai % tones.length] + 12;
      this.pluck(t, midi, s16 * (th.bright ? 0.9 : 1.6), level === 0 ? 0.4 : 0.55);
    }

    // melodia: compassos 0-1 e 2-3 de cada frase, só com tensão
    if (level > 0) {
      const phraseBar = bar % 4;
      const motif = th.motifs[phraseBar < 2 ? 0 : 1];
      const local = (phraseBar % 2) * 16 + inBar;
      // na segunda frase a melodia sobe uma oitava em batalha
      const up = bar >= 4 && level === 2 ? 12 : 0;
      for (const ln of motif) if (ln.step === local) this.lead(t, ln.midi + up, ln.len * s16, 0.7);
    }

    // bateria
    const dr = DRUMS[level];
    if (dr.k.includes(inBar)) this.kick(t, inBar === 0 ? 1 : 0.75);
    if (dr.s.includes(inBar)) this.snare(t, inBar === 15 ? 0.35 : 0.8);
    if (dr.h.includes(inBar)) this.hat(t, dr.hv * (inBar % 4 === 2 ? 1 : 0.6), inBar % 8 === 6 && level > 0);
    // virada de tons no fim de cada frase (batalha), e prato no começo
    if (level === 2 && bar % 4 === 3 && inBar >= 12) this.tom(t, [0, 1, 2, 3][inBar - 12]);
    if (level === 2 && bar % 4 === 0 && inBar === 0) this.crash(t);
  }

  // ------------------------------------------------------------ instrumentos

  private env(g: GainNode, t: number, a: number, peak: number, dur: number, rel: number) {
    // silencioso desde já (o ganho padrão é 1 até o primeiro evento)
    g.gain.setValueAtTime(0.0001, Math.min(t, this.ctx.currentTime));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private pad(t: number, midi: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(this.theme.bright ? 1400 : 900, t);
    f.frequency.linearRampToValueAtTime(this.theme.bright ? 2400 : 1300, t + dur * 0.5);
    f.Q.value = 0.7;
    this.env(g, t, dur * 0.3, vol * 0.05, dur + 0.4, dur * 0.5);
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiHz(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.5);
    }
    f.connect(g).connect(this.bus.pad);
  }

  private pluck(t: number, midi: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = this.theme.bright ? "square" : "triangle";
    o.frequency.value = midiHz(midi);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(this.theme.bright ? 3800 : 1600, t);
    f.frequency.exponentialRampToValueAtTime(500, t + dur * 2);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol * 0.07, dur * 2, dur * 1.8);
    o.connect(f).connect(g).connect(this.bus.arp);
    o.start(t);
    o.stop(t + dur * 2 + 0.05);
  }

  private bassStep(t: number, root: number, inBar: number, level: Intensity, s16: number) {
    // padrões: calmo = semínimas longas; tensão = colcheias; batalha = galope
    const pats: Record<Intensity, number[]> = {
      0: [0, 8],
      1: [0, 2, 4, 6, 8, 10, 12, 14],
      2: this.theme.bright ? [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15] : [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14],
    };
    if (!pats[level].includes(inBar)) return;
    const octave = level === 2 && inBar % 8 === 6 ? 12 : 0;
    const len = level === 0 ? s16 * 7 : s16 * 1.6;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = this.theme.bright ? "triangle" : "sawtooth";
    o.frequency.value = midiHz(root + octave);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(this.theme.bright ? 900 : 700, t);
    f.frequency.exponentialRampToValueAtTime(180, t + len);
    const g = ctx.createGain();
    this.env(g, t, 0.008, 0.22, len, len * 0.7);
    if (this.theme.bright) {
      o.connect(f).connect(g).connect(this.bus.bass);
    } else {
      // Meridian: baixo levemente distorcido
      const pre = ctx.createGain();
      pre.gain.value = 1.6;
      const dist = ctx.createWaveShaper();
      dist.curve = this.distCurve;
      o.connect(pre).connect(dist).connect(f);
      f.connect(g).connect(this.bus.bass);
    }
    o.start(t);
    o.stop(t + len + 0.05);
    // sub grave
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = midiHz(root - 12 + octave);
    const sg = ctx.createGain();
    this.env(sg, t, 0.01, 0.18, len, len * 0.6);
    sub.connect(sg).connect(this.bus.bass);
    sub.start(t);
    sub.stop(t + len + 0.05);
  }

  private lead(t: number, midi: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g, t, 0.03, vol * 0.08, dur, Math.min(0.25, dur * 0.4));
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = this.theme.bright ? 3200 : 2200;
    for (const [type, det] of [
      [this.theme.bright ? "square" : "sawtooth", 0],
      ["triangle", 5],
    ] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(midi);
      o.detune.value = det;
      // vibrato suave nas notas longas
      if (dur > 0.4) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.2;
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0, t);
        lg.gain.linearRampToValueAtTime(9, t + dur * 0.6);
        lfo.connect(lg).connect(o.detune);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
      }
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    f.connect(g).connect(this.bus.lead);
  }

  private kick(t: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(this.theme.bright ? 140 : 120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.55 * vol, 0.3, 0.25);
    o.connect(g).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.32);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, q = 0.8) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, dur, dur * 0.9);
    src.connect(f).connect(g).connect(this.bus.drums);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private snare(t: number, vol: number) {
    this.noiseHit(t, 0.18, "bandpass", this.theme.bright ? 2200 : 1600, 0.3 * vol, 0.6);
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.14 * vol, 0.1, 0.08);
    o.connect(g).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, vol: number, open: boolean) {
    this.noiseHit(t, open ? 0.2 : 0.04, "highpass", 8000, 0.12 * vol);
  }

  private tom(t: number, i: number) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    const base = (this.theme.bright ? 220 : 180) - i * 30;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.2);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.35, 0.25, 0.2);
    o.connect(g).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.28);
  }

  private crash(t: number) {
    this.noiseHit(t, 1.4, "highpass", 5000, 0.12, 0.5);
  }
}

// ------------------------------------------------------------ diretor

// Lê a partida e decide a intensidade: tiros visíveis esquentam, ataques à base viram batalha.
export class MusicDirector {
  private heat = 0;

  update(game: Game, events: GameEvent[], dt: number): Intensity {
    this.heat *= Math.exp(-dt / 5);
    for (const e of events) {
      if (e.type === "fire" && (game.isVisible(0, e.x, e.z) || game.isVisible(0, e.tx, e.tz))) {
        this.heat += e.weapon === "bullet" ? 0.25 : 0.8;
      } else if ((e.type === "death" || e.type === "buildingDeath") && game.isVisible(0, e.x, e.z)) {
        this.heat += 1.5;
      }
    }
    const atk = game.teams[0].lastAttackPos;
    if (atk && game.time - atk.t < 6) this.heat = Math.max(this.heat, 9);
    let enemyVisible = false;
    for (const u of game.units.values()) {
      if (u.team !== 0 && game.isVisible(0, u.x, u.z)) {
        enemyVisible = true;
        break;
      }
    }
    if (this.heat > 7) return 2;
    if (this.heat > 1 || enemyVisible) return 1;
    return 0;
  }
}
