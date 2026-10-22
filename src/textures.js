import * as THREE from 'three';
import { createRandom, pick } from './utils.js';

// Every texture in the game is drawn on a canvas at startup, so there are no image files to load.

export const FLOOR = 3.5; // meters per story

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  return canvas;
}

function toTexture(canvas, srgb = true) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (r, g, b) => `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`;
const gray = (v) => rgb(v * 255, v * 255, v * 255);

// Makes every pixel a little lighter or darker so flat surfaces don't look like plastic.
function addNoise(ctx, amount, random) {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * amount;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

// Draws in meters (y measured up from the bottom of the tile) into a color canvas and a
// half-size reflectivity mask: white is glass that mirrors the sky, black is wall.
function createPainter(width, height, pxPerMeter) {
  const color = makeCanvas(width * pxPerMeter, height * pxPerMeter);
  const mask = makeCanvas((width * pxPerMeter) / 2, (height * pxPerMeter) / 2);
  const c = color.getContext('2d');
  const m = mask.getContext('2d');
  m.fillStyle = '#000';
  m.fillRect(0, 0, mask.width, mask.height);
  const box = (x, y, w, h) => [x * pxPerMeter, (height - y - h) * pxPerMeter, w * pxPerMeter, h * pxPerMeter];
  const toMask = ([x, y, w, h]) => [x / 2, y / 2, w / 2, h / 2];

  return {
    c,
    color,
    mask,
    box,
    rect(x, y, w, h, fill, reflect = 0) {
      const b = box(x, y, w, h);
      c.fillStyle = fill;
      c.fillRect(...b);
      m.fillStyle = gray(reflect);
      m.fillRect(...toMask(b));
    },
    // A darker (or lighter) overlay that fakes depth: shadows under sills, behind railings...
    shade(x, y, w, h, alpha, tint = '0, 0, 0') {
      c.fillStyle = `rgba(${tint}, ${alpha})`;
      c.fillRect(...box(x, y, w, h));
    },
    // Window glass: lighter at the top where it catches the sky.
    glass(x, y, w, h, [r, g, b], reflect) {
      const [X, Y, W, H] = box(x, y, w, h);
      const gradient = c.createLinearGradient(0, Y, 0, Y + H);
      gradient.addColorStop(0, rgb(r * 1.7, g * 1.6, b * 1.45));
      gradient.addColorStop(0.5, rgb(r, g, b));
      gradient.addColorStop(1, rgb(r * 0.72, g * 0.75, b * 0.8));
      c.fillStyle = gradient;
      c.fillRect(X, Y, W, H);
      // A faint diagonal highlight, like light streaking across the pane.
      c.save();
      c.beginPath();
      c.rect(X, Y, W, H);
      c.clip();
      c.fillStyle = 'rgba(255, 255, 255, 0.07)';
      c.beginPath();
      c.moveTo(X + W * 0.15, Y + H);
      c.lineTo(X + W * 0.55, Y);
      c.lineTo(X + W * 0.8, Y);
      c.lineTo(X + W * 0.4, Y + H);
      c.fill();
      c.restore();
      m.fillStyle = gray(reflect);
      m.fillRect(...toMask([X, Y, W, H]));
    },
    text(string, x, y, size, fill) {
      c.fillStyle = fill;
      c.font = `bold ${size * pxPerMeter}px Georgia, 'Times New Roman', serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(string, x * pxPerMeter, (height - y) * pxPerMeter);
    },
  };
}

function finishFacade(painter, width, height, random, noise = 10) {
  addNoise(painter.c, noise, random);
  return { map: toTexture(painter.color), mask: toTexture(painter.mask, false), width, height };
}

const tone = (random, [r, g, b], spread = 0.25) => {
  const k = 1 - spread / 2 + random() * spread;
  return [r * k, g * k, b * k];
};

// Curtain-wall skyscraper: floor-to-ceiling glass panels.
function createGlassFacade(random) {
  const W = 12;
  const H = 4 * FLOOR;
  const p = createPainter(W, H, 64);
  p.rect(0, 0, W, H, '#e9ecef');
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR;
    p.rect(0, y, W, 0.85, '#5b6670', 0.45);
    p.shade(0, y + 0.8, W, 0.05, 0.3);
    for (let i = 0; i < 8; i++) {
      p.glass(i * 1.5 + 0.05, y + 0.9, 1.4, FLOOR - 0.95, tone(random, [36, 60, 82]), 0.9);
      if (random() < 0.2) p.shade(i * 1.5 + 0.05, y + FLOOR - 0.05 - 0.6 - random(), 1.4, 0.8, 0.18, '235, 235, 230');
    }
  }
  return finishFacade(p, W, H, random, 6);
}

// Office block: horizontal ribbon windows between concrete bands.
function createOfficeFacade(random) {
  const W = 16;
  const H = 4 * FLOOR;
  const p = createPainter(W, H, 64);
  p.rect(0, 0, W, H, '#ececec');
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR;
    p.glass(0, y + 1.05, W, 2.05, tone(random, [42, 58, 70], 0.15), 0.75);
    for (let x = 0; x < W; x += 1.6) {
      p.rect(x - 0.03, y + 1.05, 0.06, 2.05, '#8f989f');
      if (random() < 0.25) p.shade(x + 0.05, y + 2.3 + random() * 0.6, 1.5, 0.8, 0.22, '230, 228, 220');
    }
    p.shade(0, y + 2.95, W, 0.15, 0.35);
    p.rect(0, y + 0.97, W, 0.08, '#f8f8f8');
    p.shade(0, y + 0.88, W, 0.09, 0.2);
  }
  for (const x of [0, 8, 16]) {
    p.rect(x - 0.22, 0, 0.44, H, '#dedede');
    p.shade(x + 0.22, 0, 0.08, H, 0.15);
  }
  return finishFacade(p, W, H, random, 8);
}

// Pre-war brick or stone building: framed windows with sills, lintels and curtains.
function createClassicFacade(random) {
  const W = 16;
  const H = 4 * FLOOR;
  const p = createPainter(W, H, 64);
  p.rect(0, 0, W, H, '#c2c2c2');
  // Brick courses.
  for (let y = 0, row = 0; y < H; y += 0.25, row++) {
    p.shade(0, y, W, 0.03, 0.12);
    for (let x = (row % 2) * 0.25; x < W; x += 0.5) p.shade(x, y, 0.03, 0.25, 0.1);
    for (let x = 0; x < W; x += 0.5) if (random() < 0.15) p.shade(x, y + 0.03, 0.47, 0.22, random() * 0.1);
  }
  const curtainColors = ['#efe6d2', '#d9cbb0', '#c8d3d9', '#e8d8d0', '#b9a58b'];
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR;
    p.rect(0, y, W, 0.18, '#dadada');
    p.shade(0, y - 0.07, W, 0.07, 0.25);
    for (let b = 0; b < 4; b++) {
      const cx = 2 + b * 4;
      p.rect(cx - 0.8, y + 0.75, 1.6, 2.5, '#f1f1f1');
      p.glass(cx - 0.62, y + 0.85, 1.24, 2.1, tone(random, [40, 50, 60]), 0.55);
      if (random() < 0.45) {
        const side = random() < 0.5 ? cx - 0.62 : cx + 0.62 - 0.38;
        p.rect(side, y + 0.9, 0.38, 2.0, pick(random, curtainColors));
      }
      p.shade(cx - 0.62, y + 2.83, 1.24, 0.12, 0.4);
      p.shade(cx - 0.62, y + 0.85, 0.09, 2.1, 0.25);
      p.rect(cx - 0.03, y + 0.85, 0.06, 2.1, '#f1f1f1');
      p.rect(cx - 0.62, y + 2.05, 1.24, 0.06, '#f1f1f1');
      p.rect(cx - 0.9, y + 3.0, 1.8, 0.28, '#ffffff');
      p.rect(cx - 0.85, y + 0.66, 1.7, 0.12, '#ffffff');
      p.shade(cx - 0.85, y + 0.56, 1.7, 0.1, 0.3);
    }
  }
  return finishFacade(p, W, H, random, 14);
}

// Apartment block: stacks of balconies with railings, windows with AC units.
function createResidentialFacade(random) {
  const W = 12;
  const H = 4 * FLOOR;
  const p = createPainter(W, H, 64);
  p.rect(0, 0, W, H, '#cfcfcf');
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR;
    for (let b = 0; b < 4; b++) {
      const cx = 1.5 + b * 3;
      if (b % 2 === 0) {
        p.shade(cx - 1.25, y + 0.14, 2.5, FLOOR - 0.14, 0.12);
        p.rect(cx - 0.75, y + 0.14, 1.5, 2.45, '#f4f4f4');
        p.glass(cx - 0.65, y + 0.14, 1.3, 2.35, tone(random, [44, 54, 64]), 0.5);
        p.rect(cx - 0.03, y + 0.14, 0.06, 2.35, '#f4f4f4');
        if (random() < 0.5) p.rect(cx - 0.62, y + 0.2, 0.4, 2.2, pick(random, ['#e9e1cf', '#c9d4dc', '#e3c9b8']));
        p.shade(cx - 1.25, y + 0.14, 2.5, 0.95, 0.15);
        for (let x = cx - 1.22; x < cx + 1.25; x += 0.13) p.rect(x, y + 0.14, 0.025, 0.92, '#3a3d42');
        p.rect(cx - 1.25, y + 1.03, 2.5, 0.06, '#3a3d42');
        p.rect(cx - 1.3, y, 2.6, 0.14, '#f0f0f0');
        p.shade(cx - 1.3, y - 0.14, 2.6, 0.14, 0.3);
        if (random() < 0.4) p.rect(cx + 0.7, y + 0.14, 0.3, 0.35, pick(random, ['#b5523b', '#4f7d3a', '#c78f2e']));
      } else {
        p.rect(cx - 0.82, y + 0.92, 1.64, 1.76, '#f4f4f4');
        p.glass(cx - 0.7, y + 1.0, 1.4, 1.6, tone(random, [44, 54, 64]), 0.5);
        p.rect(cx - 0.03, y + 1.0, 0.06, 1.6, '#f4f4f4');
        p.shade(cx - 0.7, y + 2.48, 1.4, 0.12, 0.35);
        p.rect(cx - 0.9, y + 0.86, 1.8, 0.1, '#ffffff');
        p.shade(cx - 0.9, y + 0.77, 1.8, 0.09, 0.3);
        if (random() < 0.35) {
          p.rect(cx - 0.4, y + 0.3, 0.8, 0.45, '#e6e6e6');
          for (let k = 0; k < 4; k++) p.shade(cx - 0.35, y + 0.36 + k * 0.1, 0.7, 0.03, 0.3);
          p.shade(cx - 0.4, y + 0.22, 0.8, 0.08, 0.3);
        }
      }
    }
  }
  return finishFacade(p, W, H, random, 12);
}

export function createFacades() {
  const random = createRandom(2024);
  return {
    glass: createGlassFacade(random),
    office: createOfficeFacade(random),
    classic: createClassicFacade(random),
    residential: createResidentialFacade(random),
  };
}

const SHOPS = [
  { name: 'CAFE', wall: '#2f4f3e', accent: '#e8dcc0' },
  { name: 'PIZZA', wall: '#7d1d16', accent: '#f3e9d2' },
  { name: 'BOOKS', wall: '#1f2f4f', accent: '#e6c36a' },
  { name: 'DELI', wall: '#3b2a1e', accent: '#f0d9a8' },
  { name: 'PHARMACY', wall: '#e9e9e4', accent: '#1c7a5a' },
  { name: 'BAKERY', wall: '#8a4b22', accent: '#fbe3c0' },
  { name: 'FLOWERS', wall: '#41543a', accent: '#f2c6d0' },
  { name: 'DINER', wall: '#b8bcc2', accent: '#c4302b' },
];

// The ground floor of every downtown building: a row of shops with signs and awnings.
export function createStorefrontTexture() {
  const random = createRandom(77);
  const SHOP = 6;
  const W = SHOPS.length * SHOP;
  const H = 5;
  const p = createPainter(W, H, 48);

  SHOPS.forEach((shop, k) => {
    const x0 = k * SHOP;
    const dark = shop.wall === '#e9e9e4' || shop.wall === '#b8bcc2' ? '#2a2c30' : '#141414';
    p.rect(x0, 0, SHOP, H, shop.wall);
    p.rect(x0, 0, SHOP, 0.45, '#56524c');

    // Shop window with a lit interior and shelves of products.
    const wx = x0 + 0.55;
    const ww = 3.4;
    const [X, Y, Wd, Hd] = p.box(wx, 0.45, ww, 2.55);
    const inside = p.c.createLinearGradient(0, Y, 0, Y + Hd);
    inside.addColorStop(0, '#7a6a55');
    inside.addColorStop(1, '#2a241e');
    p.c.fillStyle = inside;
    p.c.fillRect(X, Y, Wd, Hd);
    p.shade(wx, 2.75, ww, 0.12, 0.5, '255, 240, 200');
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = 0.7 + shelf * 0.6;
      p.shade(wx + 0.2, sy, ww - 0.4, 0.05, 0.5);
      for (let i = 0; i < 9; i++) {
        const hue = Math.floor(random() * 360);
        p.c.fillStyle = `hsl(${hue}, 55%, ${40 + random() * 30}%)`;
        const [px, py, pw, ph] = p.box(wx + 0.25 + i * 0.33, sy + 0.05, 0.22, 0.2 + random() * 0.2);
        p.c.fillRect(px, py, pw, ph);
      }
    }
    p.shade(wx, 0.45, ww, 2.55, 0.12, '120, 160, 200');
    p.rect(wx - 0.08, 0.45, 0.08, 2.6, dark);
    p.rect(wx + ww, 0.45, 0.08, 2.6, dark);
    p.rect(wx - 0.08, 3.0, ww + 0.16, 0.08, dark);
    p.rect(wx + ww / 2 - 0.03, 0.45, 0.06, 2.55, dark);

    // Door.
    p.rect(x0 + 4.35, 0.45, 1.2, 2.65, dark);
    p.glass(x0 + 4.45, 0.55, 1.0, 2.45, [70, 62, 52], 0.4);
    p.rect(x0 + 4.55, 1.6, 0.06, 0.4, '#c9b27a');

    // Striped awning and the shadow it throws on the window.
    p.shade(wx, 2.6, ww, 0.4, 0.35);
    for (let s = 0; s < 12; s++) {
      p.rect(x0 + 0.35 + s * 0.333, 3.1, 0.333, 0.42, s % 2 ? shop.accent : shop.wall === '#e9e9e4' ? shop.accent : '#f2efe6');
    }
    p.shade(x0 + 0.35, 3.1, 4, 0.08, 0.3);

    // Sign with the shop name.
    p.rect(x0 + 0.4, 3.62, SHOP - 0.8, 0.86, dark);
    p.rect(x0 + 0.48, 3.7, SHOP - 0.96, 0.7, shop.wall);
    p.text(shop.name, x0 + SHOP / 2, 4.06, 0.5, shop.accent);

    p.rect(x0, 4.62, SHOP, 0.38, '#d8d3c7');
    p.shade(x0, 4.54, SHOP, 0.08, 0.3);
    p.rect(x0, 0, 0.3, H, dark);
    p.shade(x0 + 0.3, 0, 0.08, H, 0.2);
  });
  return finishFacade(p, W, H, random, 6);
}

function createSurfaceTexture(size, seed, draw) {
  const random = createRandom(seed);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  draw(ctx, size, random);
  return toTexture(canvas);
}

// 8m x 8m of road.
export function createAsphaltTexture() {
  return createSurfaceTexture(512, 5, (ctx, size, random) => {
    ctx.fillStyle = '#4a4c51';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(${random() < 0.5 ? '0, 0, 0' : '255, 255, 255'}, ${0.03 + random() * 0.04})`;
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, 20 + random() * 80, 10 + random() * 40, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(20, 20, 22, 0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      let x = random() * size;
      let y = random() * size;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) ctx.lineTo((x += (random() - 0.5) * 50), (y += (random() - 0.5) * 50));
      ctx.stroke();
    }
    addNoise(ctx, 34, random);
  });
}

// 2m x 2m of sidewalk: four concrete slabs.
export function createPavingTexture() {
  return createSurfaceTexture(256, 6, (ctx, size, random) => {
    const slab = size / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const shade = 178 + random() * 16;
        ctx.fillStyle = rgb(shade, shade * 0.98, shade * 0.94);
        ctx.fillRect(i * slab, j * slab, slab, slab);
      }
    }
    ctx.fillStyle = 'rgba(70, 66, 60, 0.55)';
    for (let k = 0; k <= 2; k++) {
      ctx.fillRect(k * slab - 1, 0, 2, size);
      ctx.fillRect(0, k * slab - 1, size, 2);
    }
    addNoise(ctx, 26, random);
  });
}

// 4m x 4m of gravel roof.
export function createRoofTexture() {
  return createSurfaceTexture(256, 8, (ctx, size, random) => {
    ctx.fillStyle = '#9a9894';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(0, 0, 0, ${random() * 0.06})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 20 + random() * 50, 0, Math.PI * 2);
      ctx.fill();
    }
    addNoise(ctx, 60, random);
  });
}

// Soft dark spot used as a fake shadow under cars and people.
export function createBlobTexture() {
  const size = 128;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
