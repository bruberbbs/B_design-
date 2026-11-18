"use client";

import { useState } from "react";
import type { Difficulty } from "@/lib/jogo/defs";
import { GameView } from "./GameView";
import { StartScreen } from "./Overlays";

export function JogoApp() {
  const [session, setSession] = useState<{ difficulty: Difficulty; key: number } | null>(null);
  if (!session) return <StartScreen onStart={(difficulty) => setSession({ difficulty, key: Date.now() })} />;
  return (
    <GameView
      key={session.key}
      difficulty={session.difficulty}
      onRestart={() => setSession({ difficulty: session.difficulty, key: Date.now() })}
      onMenu={() => setSession(null)}
    />
  );
}
