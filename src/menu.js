import * as THREE from 'three';

const PANEL_WIDTH = 1.6;
const PANEL_HEIGHT = 1.15;
const PIXELS_PER_METER = 640;
const BUTTON_WIDTH = 0.9;
const BUTTON_HEIGHT = 0.22;
const FONT = '"Arial Black", Impact, "Segoe UI", sans-serif';

function createTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function drawWeb(ctx, cx, cy, radius) {
  const spokes = 12;
  const rings = 6;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  for (let k = 0; k < spokes; k++) {
    const angle = (k / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  for (let r = 1; r <= rings; r++) {
    const ring = (radius * r) / rings;
    ctx.beginPath();
    for (let k = 0; k <= spokes; k++) {
      const angle = (k / spokes) * Math.PI * 2;
      const x = cx + Math.cos(angle) * ring;
      const y = cy + Math.sin(angle) * ring;
      if (k === 0) {
        ctx.moveTo(x, y);
      } else {
        const mid = ((k - 0.5) / spokes) * Math.PI * 2;
        ctx.quadraticCurveTo(cx + Math.cos(mid) * ring * 0.85, cy + Math.sin(mid) * ring * 0.85, x, y);
      }
    }
    ctx.stroke();
  }
}

function createPanelTexture(title, subtitle) {
  return createTexture(PANEL_WIDTH * PIXELS_PER_METER, PANEL_HEIGHT * PIXELS_PER_METER, (ctx, w, h) => {
    const outline = () => {
      ctx.beginPath();
      ctx.roundRect(6, 6, w - 12, h - 12, 44);
    };
    outline();
    ctx.fillStyle = 'rgba(10, 14, 36, 0.9)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    drawWeb(ctx, w, 0, 560);
    drawWeb(ctx, 0, h, 440);
    ctx.restore();
    outline();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#e62429';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `110px ${FONT}`;
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#0d1b4c';
    ctx.strokeText(title, w / 2, 130, w - 80);
    ctx.fillStyle = '#e62429';
    ctx.fillText(title, w / 2, 130, w - 80);
    if (subtitle) {
      ctx.font = `44px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(subtitle, w / 2, 225);
    }
  });
}

function createButtonTexture(label, hovered) {
  return createTexture(512, 128, (ctx, w, h) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 28);
    ctx.fillStyle = hovered ? '#ff3b3f' : '#b81d24';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `56px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, w / 2, h / 2 + 3);
  });
}

// A floating menu panel in the world. Works with the VR controller rays and with the mouse.
export function createMenu({ onPlay }) {
  const root = new THREE.Group();
  const panelGeometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
  const buttonGeometry = new THREE.PlaneGeometry(BUTTON_WIDTH, BUTTON_HEIGHT);
  const pages = {};
  let current = null;

  function addPage(name, title, subtitle, buttons) {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(panelGeometry, new THREE.MeshBasicMaterial({ map: createPanelTexture(title, subtitle), transparent: true, toneMapped: false })),
    );
    const meshes = buttons.map(({ label, y, onClick }) => {
      const normal = createButtonTexture(label, false);
      const hover = createButtonTexture(label, true);
      const mesh = new THREE.Mesh(buttonGeometry, new THREE.MeshBasicMaterial({ map: normal, transparent: true, toneMapped: false }));
      mesh.position.set(0, y, 0.01);
      mesh.renderOrder = 1;
      mesh.userData = { normal, hover, onClick };
      group.add(mesh);
      return mesh;
    });
    root.add(group);
    pages[name] = { group, buttons: meshes };
  }

  function show(name) {
    for (const [key, page] of Object.entries(pages)) page.group.visible = key === name;
    current = pages[name];
  }

  addPage('main', 'SPIDER-MAN', 'WEB SLINGER VR', [
    { label: 'PLAY', y: 0, onClick: onPlay },
    { label: 'SETTINGS', y: -0.3, onClick: () => show('settings') },
  ]);
  addPage('settings', 'SETTINGS', null, [{ label: 'BACK', y: -0.38, onClick: () => show('main') }]);
  show('main');

  return {
    root,
    show,
    // Returns the button a ray points at, if any.
    pick(raycaster) {
      if (!root.visible) return null;
      const hit = raycaster.intersectObjects(current.buttons, false)[0];
      return hit ? { button: hit.object, distance: hit.distance } : null;
    },
    setHovered(hovered) {
      for (const button of current.buttons) {
        const on = hovered.has(button);
        button.material.map = on ? button.userData.hover : button.userData.normal;
        button.scale.setScalar(on ? 1.06 : 1);
      }
    },
  };
}
