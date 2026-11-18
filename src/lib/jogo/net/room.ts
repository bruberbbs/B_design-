// Salas em rede: conexão direta entre dois aparelhos (WebRTC via PeerJS).
// O servidor público do PeerJS só apresenta os aparelhos; os dados da partida vão direto de um para o outro.

import type { DataConnection, Peer, PeerOptions } from "peerjs";

const ID_PREFIX = "forceone-v1-";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sem letras/números parecidos (O/0, I/1, L)

export function randomCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

// Servidor de sinalização: o público do PeerJS, ou um próprio via variáveis de ambiente.
function peerOptions(): PeerOptions {
  const host = process.env.NEXT_PUBLIC_PEER_HOST;
  if (!host) return { debug: 0 };
  return {
    host,
    port: Number(process.env.NEXT_PUBLIC_PEER_PORT ?? 443),
    path: process.env.NEXT_PUBLIC_PEER_PATH ?? "/",
    secure: process.env.NEXT_PUBLIC_PEER_SECURE !== "false",
    debug: 0,
  };
}

async function newPeer(id?: string): Promise<Peer> {
  const { Peer } = await import("peerjs");
  return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
}

type Listener = (msg: unknown) => void;

// Canal com o outro aparelho. Mensagens que chegam sem ninguém ouvindo ficam guardadas.
export class Room {
  private listeners = new Set<Listener>();
  private closeListeners = new Set<() => void>();
  private pending: unknown[] = [];
  private closed = false;
  private lastSeen = performance.now();
  private watchdog: number;
  private onPageHide = () => this.close();

  constructor(
    readonly code: string,
    readonly role: "host" | "guest",
    private peer: Peer,
    private conn: DataConnection,
  ) {
    conn.on("data", (d) => {
      this.lastSeen = performance.now();
      if ((d as { t?: string })?.t === "bye") return this.handleClose();
      if (this.listeners.size === 0) this.pending.push(d);
      else for (const l of this.listeners) l(d);
    });
    const end = () => this.handleClose();
    conn.on("close", end);
    conn.on("error", end);
    peer.on("error", (e) => {
      if (e.type !== "peer-unavailable") end();
    });
    // a conexão direta continua mesmo se o servidor de apresentação cair
    peer.on("disconnected", () => {
      if (!this.closed) {
        try {
          peer.reconnect();
        } catch {
          // ignora
        }
      }
    });
    // vigia: o outro lado manda ping a cada 2 s; 10 s de silêncio = conexão perdida
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastSeen > 10000) this.handleClose();
    }, 1000);
    window.addEventListener("pagehide", this.onPageHide);
    const pc = (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
    if (pc) {
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") end();
      });
    }
  }

  get isOpen() {
    return !this.closed && this.conn.open;
  }

  send(msg: unknown) {
    if (!this.isOpen) return;
    try {
      this.conn.send(msg);
    } catch {
      this.handleClose();
    }
  }

  onMessage(fn: Listener) {
    this.listeners.add(fn);
    if (this.pending.length) {
      const p = this.pending;
      this.pending = [];
      for (const m of p) fn(m);
    }
    return () => {
      this.listeners.delete(fn);
    };
  }

  onClose(fn: () => void) {
    this.closeListeners.add(fn);
    if (this.closed) fn();
    return () => {
      this.closeListeners.delete(fn);
    };
  }

  private handleClose() {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.watchdog);
    window.removeEventListener("pagehide", this.onPageHide);
    for (const l of this.closeListeners) l();
  }

  close() {
    if (!this.closed && this.conn.open) {
      try {
        this.conn.send({ t: "bye" });
      } catch {
        // ignora
      }
    }
    this.handleClose();
    try {
      this.conn.close();
    } catch {
      // ignora
    }
    this.peer.destroy();
  }
}

export interface HostingRoom {
  code: string;
  guest: Promise<Room>;
  cancel(): void;
}

// Cria uma sala e espera o adversário. Se o código já existir, sorteia outro.
export async function createRoom(): Promise<HostingRoom> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const peer = await newPeer(ID_PREFIX + code);
    const opened = await new Promise<"ok" | "taken" | Error>((resolve) => {
      peer.once("open", () => resolve("ok"));
      peer.once("error", (e) => resolve(e.type === "unavailable-id" ? "taken" : new Error(e.type)));
    });
    if (opened === "taken") {
      peer.destroy();
      continue;
    }
    if (opened instanceof Error) {
      peer.destroy();
      throw opened;
    }
    let cancelled = false;
    const guest = new Promise<Room>((resolve, reject) => {
      peer.on("connection", (conn) => {
        if (cancelled) return conn.close();
        conn.on("open", () => {
          // só um adversário por sala: para de aceitar novos
          peer.removeAllListeners("connection");
          peer.on("connection", (other) => other.close());
          resolve(new Room(code, "host", peer, conn));
        });
      });
      peer.on("error", (e) => {
        if (e.type !== "peer-unavailable") reject(new Error(e.type));
      });
    });
    return {
      code,
      guest,
      cancel: () => {
        cancelled = true;
        peer.destroy();
      },
    };
  }
  throw new Error("no-code");
}

export interface JoiningRoom {
  room: Promise<Room>;
  cancel(): void;
}

// Entra numa sala. Pode ser cancelado a qualquer momento, sem deixar conexão pendurada no anfitrião.
export function joinRoom(code: string, timeoutMs = 15000): JoiningRoom {
  let peer: Peer | null = null;
  let cancelled = false;
  let timer = 0;
  const room = new Promise<Room>((resolve, reject) => {
    const fail = (err: string) => {
      window.clearTimeout(timer);
      peer?.destroy();
      reject(new Error(err));
    };
    timer = window.setTimeout(() => fail("timeout"), timeoutMs);
    newPeer().then((p) => {
      peer = p;
      if (cancelled) return p.destroy();
      p.once("error", (e) => fail(e.type));
      p.once("open", () => {
        if (cancelled) return;
        const conn = p.connect(ID_PREFIX + code, { reliable: true, serialization: "json" });
        conn.once("open", () => {
          window.clearTimeout(timer);
          if (cancelled) {
            conn.close();
            return;
          }
          resolve(new Room(code, "guest", p, conn));
        });
        conn.once("error", () => fail("connection"));
      });
    }, () => fail("browser-incompatible"));
  });
  return {
    room,
    cancel: () => {
      cancelled = true;
      window.clearTimeout(timer);
      peer?.destroy();
    },
  };
}

export function roomErrorText(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "peer-unavailable") return "Sala não encontrada. Confira o código ou peça um novo.";
  if (m === "timeout") return "O outro aparelho não respondeu. Tentem de novo, de preferência na mesma rede Wi-Fi.";
  if (m === "network" || m === "server-error" || m === "socket-error" || m === "socket-closed")
    return "Sem acesso ao servidor de salas. Verifique a internet.";
  if (m === "browser-incompatible") return "Este navegador não suporta jogo em rede.";
  return "Não foi possível conectar. Tente de novo.";
}
