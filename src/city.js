import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom, paint, pick } from './utils.js';

// City layout: a BLOCKS x BLOCKS grid of blocks with roads between and around them.
export const BLOCKS = 7;
export const BLOCK = 40;
export const ROAD = 14;
export const PITCH = BLOCK + ROAD;
export const HALF = (BLOCKS * PITCH + ROAD) / 2;
export const SIDEWALK_HEIGHT = 0.12;
const SIDEWALK = 4;

// The window texture covers 8 x 8 windows = 32m wide, 28m tall.
const TILE_W = 32;
const TILE_H = 28;

const BUILDING_COLORS = ['#d9d4c7', '#bfc3c9', '#a8604a', '#c9b08f', '#8fa7bf', '#e6e1d6', '#7f8a96', '#b9855f'];

export const roadCenter = (j) => -HALF + j * PITCH + ROAD / 2;
export const blockCenter = (i) => -HALF + i * PITCH + ROAD + BLOCK / 2;

function createWindowTexture() {
  const size = 512;
  const cell = size / 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const random = createRandom(7);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const shade = 40 + random() * 50;
      ctx.fillStyle = random() < 0.12 ? '#fff1c1' : `rgb(${shade * 0.6}, ${shade * 0.85}, ${shade * 1.3})`;
      ctx.fillRect(col * cell + 10, row * cell + 12, cell - 20, cell - 22);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function createBuildingGeometry(width, height, depth, color) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceWidths = [depth, depth, 0, 0, width, width];
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      if (faceWidths[face] === 0) uv.setXY(i, 0.01, 0.01); // roofs: plain wall color
      else uv.setXY(i, (uv.getX(i) * faceWidths[face]) / TILE_W, (uv.getY(i) * height) / TILE_H);
    }
  }
  return paint(geometry, color);
}

// Builds the whole city and returns what the player physics needs to know about it.
export function createCity(scene) {
  const random = createRandom(1337);

  scene.background = new THREE.Color(0x8ec5ff);
  scene.fog = new THREE.Fog(0x8ec5ff, 80, 380);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4036, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  const groundSize = HALF * 2 + 600;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshLambertMaterial({ color: 0x34363c }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Each collider is an axis-aligned box from the ground up to `top`.
  const colliders = [];
  const buildingGeometries = [];
  const sidewalkGeometries = [];
  const middle = Math.floor(BLOCKS / 2);
  let spawn;

  function addBuilding(x, z, width, depth, height) {
    colliders.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, top: height });
    buildingGeometries.push(
      createBuildingGeometry(width, height, depth, pick(random, BUILDING_COLORS)).translate(x, height / 2, z),
    );
  }

  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const cx = blockCenter(i);
      const cz = blockCenter(j);
      sidewalkGeometries.push(new THREE.BoxGeometry(BLOCK, SIDEWALK_HEIGHT, BLOCK).translate(cx, SIDEWALK_HEIGHT / 2, cz));

      // Buildings get taller toward the middle of the city.
      const centerness = 1 - Math.max(Math.abs(i - middle), Math.abs(j - middle)) / (middle + 1);
      const lot = BLOCK - SIDEWALK * 2;

      if (i === middle && j === middle) {
        addBuilding(cx, cz, lot - 4, lot - 4, 60);
        spawn = new THREE.Vector3(cx, 60, cz - 8);
      } else if (random() < 0.3) {
        const size = lot - 2 - random() * 6;
        addBuilding(cx, cz, size, size, 35 + random() * 90 * centerness);
      } else {
        const sub = lot / 2;
        for (const ox of [-1, 1]) {
          for (const oz of [-1, 1]) {
            if (random() < 0.08) continue;
            addBuilding(
              cx + (ox * sub) / 2,
              cz + (oz * sub) / 2,
              sub - 2 - random() * 3,
              sub - 2 - random() * 3,
              10 + random() * (15 + 55 * centerness),
            );
          }
        }
      }
    }
  }

  scene.add(
    new THREE.Mesh(
      mergeGeometries(buildingGeometries),
      new THREE.MeshLambertMaterial({ map: createWindowTexture(), vertexColors: true }),
    ),
    new THREE.Mesh(mergeGeometries(sidewalkGeometries), new THREE.MeshLambertMaterial({ color: 0x9c9c9c })),
  );

  // Dashed yellow center lines, skipping the intersections.
  const roadCenters = Array.from({ length: BLOCKS + 1 }, (_, j) => roadCenter(j));
  const inIntersection = (v) => roadCenters.some((c) => Math.abs(v - c) < ROAD / 2 + 2);
  const dashes = [];
  for (const c of roadCenters) {
    for (let s = -HALF; s < HALF; s += 6) {
      if (inIntersection(s)) continue;
      dashes.push([s, c, 0], [c, s, Math.PI / 2]);
    }
  }
  const dashMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(3, 0.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe8c547, polygonOffset: true, polygonOffsetFactor: -2 }),
    dashes.length,
  );
  const dummy = new THREE.Object3D();
  dashes.forEach(([x, z, angle], i) => {
    dummy.position.set(x, 0.01, z);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    dashMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(dashMesh);

  const inBlock = (v) => {
    const local = v + HALF;
    return local >= 0 && local <= 2 * HALF && local % PITCH >= ROAD;
  };

  return {
    colliders,
    spawn,
    bounds: HALF + 20,
    groundHeightAt: (x, z) => (inBlock(x) && inBlock(z) ? SIDEWALK_HEIGHT : 0),
  };
}
