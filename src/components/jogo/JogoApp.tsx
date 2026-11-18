"use client";

import { useState } from "react";
import { primeAudio } from "@/lib/jogo/audio";
import type { Difficulty, Faction } from "@/lib/jogo/defs";
import type { MapId } from "@/lib/jogo/map";
import { GameView } from "./GameView";
import { StartScreen } from "./Overlays";

export function JogoApp() {
  const [session, setSession] = useState<{ difficulty: Difficulty; faction: Faction; mapId: MapId; key: number } | null>(null);
  if (!session)
    return (
      <StartScreen
        onStart={(difficulty, faction, mapId) => {
          // libera o áudio dentro do clique (exigência do Safari/iOS) para a trilha começar já
          primeAudio();
          setSession({ difficulty, faction, mapId, key: Date.now() });
        }}
      />
    );
  return (
    <GameView
      key={session.key}
      difficulty={session.difficulty}
      faction={session.faction}
      mapId={session.mapId}
      onRestart={() => setSession({ ...session, key: Date.now() })}
      onMenu={() => setSession(null)}
    />
  );
}
