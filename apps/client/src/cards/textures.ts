// Arte original das cartas, desenhada em canvas e usada como textura 3D.
import type { Card, Suit } from '@truco/shared';
import { CanvasTexture, SRGBColorSpace } from 'three';

const W = 256;
const H = 368;
const cache = new Map<string, CanvasTexture>();

const FRENCH_SYMBOL: Record<Suit, string> = { ouros: '♦', espadas: '♠', copas: '♥', paus: '♣' };
const FRENCH_COLOR: Record<Suit, string> = { ouros: '#c62828', espadas: '#1b1b1b', copas: '#c62828', paus: '#1b1b1b' };
/** Modo daltônico: um baralho de quatro cores. */
const FOUR_COLOR: Record<Suit, string> = { ouros: '#1565c0', espadas: '#1b1b1b', copas: '#c62828', paus: '#2e7d32' };
const SPANISH_COLOR: Record<Suit, string> = { ouros: '#d99a00', espadas: '#1e5fa8', copas: '#c62828', paus: '#2e7d32' };
const FIGURE: Record<string, string> = { '10': 'Sota', '11': 'Cavalo', '12': 'Rei' };

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = W;
  el.height = H;
  return [el, el.getContext('2d') as CanvasRenderingContext2D];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function finish(el: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(el);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Emblemas do baralho espanhol: moeda, espada, taça e bastão. */
function emblem(g: CanvasRenderingContext2D, suit: Suit, x: number, y: number, s: number): void {
  const color = SPANISH_COLOR[suit];
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  g.strokeStyle = '#3a2a10';
  g.lineWidth = s * 0.06;
  if (suit === 'ouros') {
    g.beginPath();
    g.arc(0, 0, s * 0.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff3c4';
    g.beginPath();
    g.arc(0, 0, s * 0.25, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else if (suit === 'copas') {
    g.beginPath();
    g.moveTo(-s * 0.42, -s * 0.5);
    g.lineTo(s * 0.42, -s * 0.5);
    g.quadraticCurveTo(s * 0.4, s * 0.1, 0, s * 0.12);
    g.quadraticCurveTo(-s * 0.4, s * 0.1, -s * 0.42, -s * 0.5);
    g.fill();
    g.stroke();
    g.fillRect(-s * 0.06, s * 0.1, s * 0.12, s * 0.28);
    g.fillRect(-s * 0.3, s * 0.38, s * 0.6, s * 0.12);
    g.strokeRect(-s * 0.3, s * 0.38, s * 0.6, s * 0.12);
  } else if (suit === 'espadas') {
    g.rotate(-0.35);
    g.fillRect(-s * 0.07, -s * 0.55, s * 0.14, s * 0.8);
    g.strokeRect(-s * 0.07, -s * 0.55, s * 0.14, s * 0.8);
    g.fillStyle = '#d99a00';
    g.fillRect(-s * 0.3, s * 0.22, s * 0.6, s * 0.1);
    g.fillRect(-s * 0.06, s * 0.3, s * 0.12, s * 0.25);
  } else {
    g.rotate(0.5);
    roundRect(g, -s * 0.13, -s * 0.55, s * 0.26, s * 1.1, s * 0.13);
    g.fill();
    g.stroke();
    g.fillStyle = '#7a4a1c';
    for (const dy of [-0.3, 0, 0.3]) {
      g.beginPath();
      g.arc(0, s * dy, s * 0.05, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function corner(g: CanvasRenderingContext2D, draw: () => void): void {
  draw();
  g.save();
  g.translate(W, H);
  g.rotate(Math.PI);
  draw();
  g.restore();
}

function drawFace(card: Card, spanish: boolean, colorblind: boolean): HTMLCanvasElement {
  const [el, g] = canvas();
  // Fundo inteiro pintado: canto transparente viraria preto na textura.
  g.fillStyle = spanish ? '#fbf3dc' : '#fdfdfb';
  g.fillRect(0, 0, W, H);
  roundRect(g, 3, 3, W - 6, H - 6, 22);
  g.strokeStyle = spanish ? '#7a5a1c' : '#bbb';
  g.lineWidth = 5;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  if (card.suit === null) {
    g.fillStyle = '#6a1b9a';
    g.font = 'bold 120px serif';
    g.fillText('★', W / 2, H / 2 - 20);
    g.font = 'bold 34px sans-serif';
    g.fillText('CORINGA', W / 2, H / 2 + 80);
    return el;
  }
  const suit = card.suit;
  if (!spanish) {
    const color = (colorblind ? FOUR_COLOR : FRENCH_COLOR)[suit];
    g.fillStyle = color;
    corner(g, () => {
      g.font = 'bold 62px serif';
      g.fillText(card.rank, 44, 50);
      g.font = '52px serif';
      g.fillText(FRENCH_SYMBOL[suit], 44, 106);
    });
    g.font = '170px serif';
    g.fillText(FRENCH_SYMBOL[suit], W / 2, H / 2 + 8);
    return el;
  }
  g.fillStyle = '#2b1d0e';
  corner(g, () => {
    g.font = 'bold 58px serif';
    g.fillText(card.rank, 42, 48);
    emblem(g, suit, 42, 104, 40);
  });
  emblem(g, suit, W / 2, H / 2 - (FIGURE[card.rank] ? 18 : 0), 130);
  const figure = FIGURE[card.rank];
  if (figure) {
    g.fillStyle = '#2b1d0e';
    g.font = 'bold 34px serif';
    g.fillText(figure, W / 2, H / 2 + 96);
  }
  return el;
}

function drawBack(): HTMLCanvasElement {
  const [el, g] = canvas();
  g.fillStyle = '#7a1f1f';
  g.fillRect(0, 0, W, H);
  roundRect(g, 3, 3, W - 6, H - 6, 22);
  g.save();
  g.clip();
  g.strokeStyle = '#e8c36a';
  g.lineWidth = 3;
  for (let i = -H; i < W + H; i += 28) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + H, H);
    g.moveTo(i + H, 0);
    g.lineTo(i, H);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#e8c36a';
  g.lineWidth = 10;
  roundRect(g, 14, 14, W - 28, H - 28, 16);
  g.stroke();
  g.fillStyle = '#7a1f1f';
  g.beginPath();
  g.arc(W / 2, H / 2, 54, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#e8c36a';
  g.font = 'bold 64px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('T', W / 2, H / 2 + 4);
  return el;
}

export function cardTexture(card: Card | null, spanish: boolean, colorblind: boolean): CanvasTexture {
  const key = card ? `${card.id}|${spanish}|${colorblind}` : 'verso';
  let texture = cache.get(key);
  if (!texture) {
    texture = finish(card ? drawFace(card, spanish, colorblind) : drawBack());
    cache.set(key, texture);
  }
  return texture;
}

const images = new Map<string, string>();

/** A mesma arte da carta 3D como imagem, para mostrar grande na interface. */
export function cardImage(card: Card | null, spanish: boolean, colorblind: boolean): string {
  const key = card ? `${card.id}|${spanish}|${colorblind}` : 'verso';
  let url = images.get(key);
  if (!url) {
    url = (cardTexture(card, spanish, colorblind).image as HTMLCanvasElement).toDataURL('image/png');
    images.set(key, url);
  }
  return url;
}
