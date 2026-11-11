// Geometria da mesa. O jogador local fica sempre em +z olhando para o centro;
// os outros lugares giram em volta no sentido do jogo (anti-horário): o próximo fica à direita.

export const TABLE_RADIUS = 0.86;
export const TABLE_HEIGHT = 0.76;
export const SEAT_RADIUS = 1.24;
export const EYE_HEIGHT = 1.26;

/** Posição relativa do lugar em relação a quem olha: 0 = eu, 1 = próximo a jogar, etc. */
export function relativeSeat(seat: number, mySeat: number, total: number): number {
  return (seat - mySeat + total) % total;
}

/** Ângulo do lugar em volta da mesa (0 = minha cadeira). */
export function seatAngle(relative: number, total: number): number {
  return (relative * 2 * Math.PI) / total;
}

/** Ponto na direção do lugar, a certa distância do centro da mesa. */
export function towardSeat(angle: number, distance: number, height: number): [number, number, number] {
  return [Math.sin(angle) * distance, height, Math.cos(angle) * distance];
}
