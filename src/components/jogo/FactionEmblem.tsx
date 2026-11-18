import { EMBLEM_H, EMBLEM_W, EMBLEMS, type EmblemKind } from "@/lib/jogo/emblems";

// Brasão da facção em SVG (mesmo desenho pintado no topo do QG).
export function FactionEmblem({ kind, className }: { kind: EmblemKind; className?: string }) {
  return (
    <svg viewBox={`0 0 ${EMBLEM_W} ${EMBLEM_H}`} className={className} aria-hidden>
      {EMBLEMS[kind].map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill={s.fill ?? "none"}
          stroke={s.stroke}
          strokeWidth={s.w}
          strokeLinecap={s.cap ?? "butt"}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
