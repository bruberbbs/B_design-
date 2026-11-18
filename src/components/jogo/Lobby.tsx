"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2, Share2, Wifi, X } from "lucide-react";
import { FACTIONS, OTHER_FACTION, type Faction } from "@/lib/jogo/defs";
import { mapInfo, type MapId } from "@/lib/jogo/map";
import { createRoom, joinRoom, roomErrorText, type HostingRoom, type Room } from "@/lib/jogo/net/room";
import { sendHello, waitHello, type Hello } from "@/lib/jogo/net/sync";

function Shell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0e18] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-10 size-[28rem] rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-[30rem] rounded-full bg-red-500/15 blur-3xl" />
      </div>
      <div className="relative mx-auto flex min-h-full max-w-sm flex-col items-center justify-center px-5 py-10 text-center">
        {children}
        <button onClick={onCancel} className="mt-6 flex items-center gap-1.5 text-sm font-semibold text-white/55 hover:text-white">
          <X className="size-4" /> Cancelar
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ criar sala

interface HostProps {
  faction: Faction;
  mapId: MapId;
  onCancel: () => void;
  onConnected: (room: Room) => void;
}

export function HostLobby({ faction, mapId, onCancel, onConnected }: HostProps) {
  const [st, setSt] = useState<{ status: "creating" | "waiting" | "connected" | "error"; code?: string; qr?: string; url?: string; error?: string }>({
    status: "creating",
  });
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const connectedRef = useRef(onConnected);
  useEffect(() => {
    connectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    let alive = true;
    let hosting: HostingRoom | null = null;
    let handedOff = false;
    createRoom()
      .then(async (h) => {
        if (!alive) return h.cancel();
        hosting = h;
        const url = `${window.location.origin}${window.location.pathname}?sala=${h.code}`;
        const qr = await QRCode.toDataURL(url, { margin: 1, width: 280, color: { dark: "#0a0e18", light: "#ffffff" } });
        if (!alive) return;
        setSt({ status: "waiting", code: h.code, qr, url });
        const room = await h.guest;
        if (!alive) return room.close();
        handedOff = true;
        sendHello(room, mapId, faction);
        setSt((s) => ({ ...s, status: "connected" }));
        window.setTimeout(() => connectedRef.current(room), 900);
      })
      .catch((err) => {
        if (alive) setSt({ status: "error", error: roomErrorText(err) });
      });
    return () => {
      alive = false;
      if (!handedOff) hosting?.cancel();
    };
  }, [faction, mapId, attempt]);

  const share = async () => {
    if (!st.url) return;
    const data = { title: "Force One", text: `Bora jogar Force One! Sala ${st.code}`, url: st.url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      // cancelado: tenta copiar
    }
    try {
      await navigator.clipboard.writeText(st.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // sem área de transferência
    }
  };

  const info = FACTIONS[faction];
  const enemy = FACTIONS[OTHER_FACTION[faction]];

  return (
    <Shell onCancel={onCancel}>
      <p className="text-xs font-semibold uppercase tracking-widest text-white/45">Sua sala</p>
      {st.status === "creating" && (
        <div className="mt-6 flex flex-col items-center gap-3 text-white/70">
          <Loader2 className="size-8 animate-spin" />
          Criando sala…
        </div>
      )}
      {st.status === "error" && (
        <div className="mt-6">
          <p className="text-sm text-red-200">{st.error}</p>
          <button onClick={() => setAttempt((a) => a + 1)} className="mt-4 rounded-2xl bg-sky-500 px-5 py-2.5 font-bold">
            Tentar de novo
          </button>
        </div>
      )}
      {(st.status === "waiting" || st.status === "connected") && st.code && (
        <>
          <div className="mt-2 font-mono text-6xl font-black tracking-[0.25em] sm:text-7xl">{st.code}</div>
          <p className="mt-2 text-sm text-white/60">No outro aparelho, escaneie o QR code ou digite o código em “Em rede → Entrar”.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {st.qr && <img src={st.qr} alt={`QR code da sala ${st.code}`} className="mt-5 size-52 rounded-2xl bg-white p-2" />}
          <button onClick={share} className="mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-semibold ring-1 ring-white/15 hover:bg-white/15">
            {copied ? <Check className="size-4" /> : typeof navigator !== "undefined" && "share" in navigator ? <Share2 className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Link copiado!" : "Compartilhar link"}
          </button>
          <div className="mt-5 w-full rounded-2xl bg-white/5 p-3 text-left text-xs text-white/60 ring-1 ring-white/10">
            <div className="flex justify-between">
              <span>Mapa</span>
              <b className="text-white">{mapInfo(mapId).name}</b>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Você</span>
              <b style={{ color: info.light }}>{info.name}</b>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Adversário</span>
              <b style={{ color: enemy.light }}>{enemy.name}</b>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 text-sm">
            {st.status === "connected" ? (
              <>
                <Wifi className="size-4 text-emerald-300" />
                <span className="font-semibold text-emerald-200">Adversário conectado! Começando…</span>
              </>
            ) : (
              <>
                <Loader2 className="size-4 animate-spin text-white/60" />
                <span className="text-white/60">Aguardando adversário…</span>
              </>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------ entrar na sala

interface JoinProps {
  code: string;
  onCancel: () => void;
  onConnected: (room: Room, hello: Hello) => void;
}

export function JoinLobby({ code, onCancel, onConnected }: JoinProps) {
  const [st, setSt] = useState<{ status: "connecting" | "syncing" | "error"; error?: string }>({ status: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const connectedRef = useRef(onConnected);
  useEffect(() => {
    connectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    // tira o código do endereço para não reentrar ao recarregar
    if (window.location.search.includes("sala=")) window.history.replaceState(null, "", window.location.pathname);
    let alive = true;
    let room: Room | null = null;
    let handedOff = false;
    const joining = joinRoom(code);
    joining.room
      .then(async (r) => {
        room = r;
        if (!alive) return r.close();
        setSt({ status: "syncing" });
        const hello = await Promise.race([waitHello(r), new Promise<null>((res) => window.setTimeout(() => res(null), 10000))]);
        if (!alive) return;
        if (!hello) throw new Error("timeout");
        handedOff = true;
        connectedRef.current(r, hello);
      })
      .catch((err) => {
        if (alive) setSt({ status: "error", error: roomErrorText(err) });
      });
    return () => {
      alive = false;
      if (!handedOff) {
        joining.cancel();
        room?.close();
      }
    };
  }, [code, attempt]);

  return (
    <Shell onCancel={onCancel}>
      <p className="text-xs font-semibold uppercase tracking-widest text-white/45">Entrando na sala</p>
      <div className="mt-2 font-mono text-6xl font-black tracking-[0.25em]">{code}</div>
      {st.status !== "error" ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="size-4 animate-spin" />
          {st.status === "connecting" ? "Conectando ao outro aparelho…" : "Conectado! Recebendo a partida…"}
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-red-200">{st.error}</p>
          <button onClick={() => setAttempt((a) => a + 1)} className="mt-4 rounded-2xl bg-sky-500 px-5 py-2.5 font-bold">
            Tentar de novo
          </button>
        </div>
      )}
    </Shell>
  );
}
