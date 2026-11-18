// Ordens do jogador. No jogo local vão direto para a simulação; em rede, o convidado as envia ao anfitrião.

import type { BuildingKind, Producer, Team, UnitKind } from "./defs";
import type { Game } from "./game";

export type ItemKind = UnitKind | BuildingKind;

export interface Orders {
  smart(ids: number[], x: number, z: number, target: number | null, attackMove: boolean): void;
  stop(ids: number[]): void;
  queue(kind: ItemKind): boolean;
  cancel(kind: ItemKind): boolean;
  place(tx: number, tz: number): boolean;
  sell(id: number): void;
  repair(id: number): void;
  primary(id: number): void;
}

export function producerOfBuilding(kind: BuildingKind): Producer | null {
  if (kind === "barracks") return "infantry";
  if (kind === "factory") return "vehicle";
  if (kind === "helipad") return "air";
  return null;
}

// Aplica as ordens de um time na simulação (jogo local, ou o anfitrião recebendo do convidado).
export class LocalOrders implements Orders {
  constructor(
    private game: Game,
    private team: Team = 0,
  ) {}

  private own(ids: number[]) {
    return ids.filter((id) => this.game.get(id)?.team === this.team);
  }

  smart(ids: number[], x: number, z: number, target: number | null, attackMove: boolean) {
    this.game.smartCommand(this.team, this.own(ids), x, z, target, attackMove);
  }
  stop(ids: number[]) {
    this.game.issueStop(this.own(ids).filter((id) => this.game.units.has(id)));
  }
  queue(kind: ItemKind) {
    return this.game.queueProduction(this.team, kind);
  }
  cancel(kind: ItemKind) {
    return this.game.cancelProduction(this.team, kind);
  }
  place(tx: number, tz: number) {
    return this.game.placeStructure(this.team, tx, tz);
  }
  sell(id: number) {
    if (this.game.buildings.get(id)?.team === this.team) this.game.sell(id);
  }
  repair(id: number) {
    if (this.game.buildings.get(id)?.team === this.team) this.game.toggleRepair(id);
  }
  primary(id: number) {
    const b = this.game.buildings.get(id);
    const p = b && b.team === this.team ? producerOfBuilding(b.kind) : null;
    if (b && p) this.game.primary[this.team][p] = id;
  }
}
