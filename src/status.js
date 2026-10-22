import * as THREE from 'three';

const FONT = '"Arial Black", Impact, "Segoe UI", sans-serif';
const WIDTH = 1024;
const HEIGHT = 256;

function canvasTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { ctx: canvas.getContext('2d'), texture };
}

// Things stuck to the player's view: a small panel near the top (messages, objective, health)
// and a red glow around the edges when they get hit. Works the same in the headset and on desktop.
export function createStatus(camera) {
  const overlay = (geometry, map, z, order) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
    );
    mesh.position.z = z;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    camera.add(mesh);
    return mesh;
  };

  const { ctx, texture } = canvasTexture(WIDTH, HEIGHT);
  const panel = overlay(new THREE.PlaneGeometry(0.5, 0.125), texture, -0.8, 50);
  panel.position.y = 0.23;

  const glow = canvasTexture(256, 256);
  const gradient = glow.ctx.createRadialGradient(128, 128, 50, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 20, 20, 0)');
  gradient.addColorStop(1, 'rgba(255, 20, 20, 0.9)');
  glow.ctx.fillStyle = gradient;
  glow.ctx.fillRect(0, 0, 256, 256);
  const vignette = overlay(new THREE.PlaneGeometry(0.7, 0.7), glow.texture, -0.22, 49);
  vignette.visible = false;

  let drawn = '';
  let flashAmount = 0;

  function text(value, y, size, color) {
    ctx.font = `${size}px ${FONT}`;
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(value, WIDTH / 2, y, WIDTH - 40);
    ctx.fillStyle = color;
    ctx.fillText(value, WIDTH / 2, y, WIDTH - 40);
  }

  // message: big yellow headline, objective: smaller white line, health: 0..1 or null to hide the bar.
  function set({ message = '', objective = '', health = null }) {
    const key = `${message}|${objective}|${health === null ? '-' : Math.round(health * 100)}`;
    if (key === drawn) return;
    drawn = key;
    panel.visible = !!(message || objective || health !== null);

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (message) text(message, 70, 80, '#ffd23f');
    else if (objective) text(objective, 75, 54, '#ffffff');

    if (health !== null) {
      const [x, y, w, h] = [192, 168, 640, 46];
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 14);
      ctx.fill();
      ctx.fillStyle = health > 0.5 ? '#3ddc84' : health > 0.25 ? '#ffb020' : '#ff3b3f';
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(0, w * health), h, 9);
      ctx.fill();
      ctx.textAlign = 'right';
      ctx.font = `40px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('HP', x - 22, y + h / 2 + 2);
    }
    texture.needsUpdate = true;
  }

  function flash(amount) {
    flashAmount = Math.min(1, flashAmount + amount);
  }

  function update(dt) {
    flashAmount = Math.max(0, flashAmount - dt * 1.8);
    vignette.visible = flashAmount > 0;
    vignette.material.opacity = flashAmount;
  }

  function hide() {
    set({});
    flashAmount = 0;
    vignette.visible = false;
  }

  return { set, flash, update, hide };
}
