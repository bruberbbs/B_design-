"use client";

import { useState } from "react";
import type { Difficulty, Faction } from "@/lib/jogo/defs";
import { GameView } from "./GameView";
import { StartScreen } from "./Overlays";

export function JogoApp() {
  const [session, setSession] = useState<{ difficulty: Difficulty; faction: Faction; key: number } | null>(null);
  if (!session) return <StartScreen onStart={(difficulty, faction) => setSession({ difficulty, faction, key: Date.now() })} />;
  return (
    <GameView
      key={session.key}
      difficulty={session.difficulty}
      faction={session.faction}
      onRestart={() => setSession({ ...session, key: Date.now() })}
      onMenu={() => setSession(null)}
    />
  );
}
