// Ponte entre a cena 3D e a interface: a cena calcula onde cada cabeça aparece na tela
// e a interface desenha ali a etiqueta de nome e o balão de fala.

export interface ScreenAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export const anchors = new Map<number, ScreenAnchor>();
