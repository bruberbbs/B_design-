"use client";

import { useCallback, useState } from "react";
import { primeAudio } from "@/lib/jogo/audio";
import { OTHER_FACTION, type Difficulty, type Faction } from "@/lib/jogo/defs";
import type { MapId } from "@/lib/jogo/map";
import type { Room } from "@/lib/jogo/net/room";
import { GameView } from "./GameView";
import { HostLobby, JoinLobby } from "./Lobby";
import { StartScreen } from "./Overlays";

type Screen =
  | { s: "menu" }
  | { s: "hosting"; faction: Faction; mapId: MapId }
  | { s: "joining"; code: string }
  | { s: "game"; difficulty: Difficulty; faction: Faction; mapId: MapId; net: { role: "host" | "guest"; room: Room } | null; key: number };

// Abrir o link de uma sala (?sala=ABCD) entra direto nela.
function initialScreen(): Screen {
  const code = new URLSearchParams(window.location.search).get("sala");
  return code && /^[A-Z0-9]{4}$/i.test(code) ? { s: "joining", code: code.toUpperCase() } : { s: "menu" };
}

export function JogoApp() {
  const [screen, setScreen] = useState<Screen>(initialScreen);

  const toMenu = useCallback(() => {
    setScreen((cur) => {
      if (cur.s === "game") cur.net?.room.close();
      return { s: "menu" };
    });
  }, []);

  const onHostConnected = useCallback((room: Room) => {
    setScreen((cur) =>
      cur.s === "hosting" ? { s: "game", difficulty: "normal", faction: cur.faction, mapId: cur.mapId, net: { role: "host", room }, key: Date.now() } : cur,
    );
  }, []);

  const onGuestConnected = useCallback(
    (room: Room, hello: { mapId: MapId; hostFaction: Faction }) =>
      setScreen({ s: "game", difficulty: "normal", faction: OTHER_FACTION[hello.hostFaction], mapId: hello.mapId, net: { role: "guest", room }, key: Date.now() }),
    [],
  );

  switch (screen.s) {
    case "menu":
      return (
        <StartScreen
          onStart={(difficulty, faction, mapId) => {
            // libera o áudio dentro do clique (exigência do Safari/iOS) para a trilha começar já
            primeAudio();
            setScreen({ s: "game", difficulty, faction, mapId, net: null, key: Date.now() });
          }}
          onHost={(faction, mapId) => {
            primeAudio();
            setScreen({ s: "hosting", faction, mapId });
          }}
          onJoin={(code) => {
            primeAudio();
            setScreen({ s: "joining", code });
          }}
        />
      );
    case "hosting":
      return <HostLobby faction={screen.faction} mapId={screen.mapId} onCancel={toMenu} onConnected={onHostConnected} />;
    case "joining":
      return <JoinLobby code={screen.code} onCancel={toMenu} onConnected={onGuestConnected} />;
    case "game":
      return (
        <GameView
          key={screen.key}
          difficulty={screen.difficulty}
          faction={screen.faction}
          mapId={screen.mapId}
          net={screen.net}
          onRestart={() => setScreen({ ...screen, key: Date.now() })}
          onMenu={toMenu}
        />
      );
  }
}
