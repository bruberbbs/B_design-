// Brasões das facções (do guia de identidade "Force One · Zênite · Meridian").
// Desenhados em caminhos SVG para servirem tanto na interface (<svg>) quanto na
// textura 3D do QG (Path2D num canvas).

export type EmblemKind = "zenite" | "meridian";

export interface EmblemShape {
  d: string;
  fill?: string;
  stroke?: string;
  w?: number;
  cap?: "round" | "butt";
}

export const EMBLEM_W = 480;
export const EMBLEM_H = 630;

const OUTER = "M30 105 L240 30 L450 105 L450 360 Q446 512 240 600 Q34 512 30 360 Z";
const INNER = "M66 135 L240 76 L414 135 L414 362 Q410 486 240 556 Q70 486 66 362 Z";

const line = (x0: number, y0: number, x1: number, y1: number) => `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`;

function sunRays() {
  const cx = 240;
  const cy = 336;
  const out: string[] = [];
  for (const deg of [10, 35, 61, 90, 119, 145, 170]) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push(line(cx + c * 126, cy - s * 126, cx + c * 166, cy - s * 166));
  }
  return out.join(" ");
}

export const EMBLEMS: Record<EmblemKind, EmblemShape[]> = {
  // Coalizão Zênite: escudo azul com duas divisas e o ponto de vigia no alto
  zenite: [
    { d: OUTER, fill: "#0c2147", stroke: "#5da8fe", w: 16 },
    { d: INNER, stroke: "#2f5ea8", w: 5 },
    { d: "M223 112 a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0 Z", fill: "#e9f3fd" },
    { d: "M240 175 L357 332 L299 332 L240 253 L181 332 L123 332 Z", fill: "#9bcafe" },
    { d: "M240 292 L357 450 L299 450 L240 371 L181 450 L123 450 Z", fill: "#3a81f5" },
  ],
  // Aliança Meridian: escudo vermelho com o sol do meio-dia sobre o horizonte
  meridian: [
    { d: OUTER, fill: "#3d1112", stroke: "#fe795c", w: 16 },
    { d: INNER, stroke: "#863122", w: 5 },
    { d: sunRays(), stroke: "#feb39d", w: 13, cap: "round" },
    { d: "M143 336 A97 97 0 0 1 337 336 Z", fill: "#fe694b" },
    { d: line(112, 371, 366, 371), stroke: "#feb39d", w: 17, cap: "round" },
    { d: line(151, 412, 327, 412), stroke: "#fe694b", w: 15, cap: "round" },
    { d: line(192, 452, 287, 452), stroke: "#a6402c", w: 15, cap: "round" },
  ],
};

// Desenha o brasão num canvas 2D (escala k sobre o tamanho base 480×630).
export function drawEmblem(ctx: CanvasRenderingContext2D, kind: EmblemKind, k: number) {
  ctx.save();
  ctx.scale(k, k);
  ctx.lineJoin = "round";
  for (const s of EMBLEMS[kind]) {
    const p = new Path2D(s.d);
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill(p);
    }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.w ?? 4;
      ctx.lineCap = s.cap ?? "butt";
      ctx.stroke(p);
    }
  }
  ctx.restore();
}
