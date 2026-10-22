import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, BLOCK, SIDEWALK_HEIGHT, ROAD, roadCenter, blockCenter } from './city.js';
import { createRandom, paint } from './utils.js';

// Distances from an intersection's center, along the road.
export const CROSSWALK_START = ROAD / 2 + 0.3;
export const CROSSWALK_END = CROSSWALK_START + 3;
export const STOP_LINE = CROSSWALK_END + 0.7;

const WHITE = '#e9e8e2';
const YELLOW = '#e6b62e';

const box = (w, h, d, x, y, z, color) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const cylinder = (rTop, rBottom, h, segments, x, y, z, color) =>
  paint(new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(x, y, z), color);

// Lane lines, crosswalks and stop lines, all merged into one flat mesh lying on the asphalt.
function createMarkings() {
  const quads = [];
  // `along` runs down the road, `across` from one curb to the other.
  const quad = (axis, along, across, lengthAlong, widthAcross, color) => {
    const [x, z, sx, sz] = axis === 'x' ? [along, across, lengthAlong, widthAcross] : [across, along, widthAcross, lengthAlong];
    quads.push(paint(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(x, 0.012, z), color));
  };

  for (const axis of ['x', 'z']) {
    for (let j = 0; j <= BLOCKS; j++) {
      const c = roadCenter(j);
      for (let i = 0; i < BLOCKS; i++) {
        const a = roadCenter(i);
        const b = roadCenter(i + 1);
        const lineLength = b - a - 2 * (STOP_LINE + 0.5);
        const mid = (a + b) / 2;

        quad(axis, mid, c - 0.15, lineLength, 0.12, YELLOW);
        quad(axis, mid, c + 0.15, lineLength, 0.12, YELLOW);
        quad(axis, mid, c - ROAD / 2 + 0.8, lineLength, 0.15, WHITE);
        quad(axis, mid, c + ROAD / 2 - 0.8, lineLength, 0.15, WHITE);

        for (const [end, sign] of [[a, 1], [b, -1]]) {
          const crossCenter = end + sign * (CROSSWALK_START + CROSSWALK_END) / 2;
          for (let s = -6.3; s <= 6.3; s += 1.05) quad(axis, crossCenter, c + s, 3, 0.55, WHITE);

          // Traffic drives on the right, so the cars stopping at this end use one half of the road.
          const dir = -sign;
          const half = axis === 'x' ? dir : -dir;
          quad(axis, end + sign * STOP_LINE, c + half * 3.5, 0.45, ROAD / 2 - 0.6, WHITE);
        }
      }
    }
  }

  const mesh = new THREE.Mesh(
    mergeGeometries(quads),
    new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

// Street lamp, built with its arm reaching toward +z (the road).
function createLampGeometry() {
  return mergeGeometries([
    cylinder(0.16, 0.2, 0.7, 10, 0, 0.35, 0, '#2c312e'),
    cylinder(0.07, 0.1, 7, 10, 0, 3.5, 0, '#2c312e'),
    box(0.08, 0.08, 1.9, 0, 6.95, 0.95, '#2c312e'),
    box(0.45, 0.16, 0.8, 0, 6.88, 1.75, '#2c312e'),
    box(0.36, 0.03, 0.62, 0, 6.79, 1.75, '#fff6dc'),
  ]);
}

function createTreeGeometry() {
  const leaves = (radius, x, y, z, sy) =>
    paint(new THREE.IcosahedronGeometry(radius, 1).scale(1, sy, 1).translate(x, y, z), '#6c9c45');
  return mergeGeometries([
    cylinder(0.11, 0.17, 3.4, 7, 0, 1.7, 0, '#5a4433').toNonIndexed(),
    leaves(1.9, 0, 4.5, 0, 0.85),
    leaves(1.4, 0.8, 3.8, 0.5, 0.8),
  ]);
}

// Hydrants and trash cans: small things that make the sidewalk feel lived in.
function addSmallProps(geometries, x, z, ox, oz) {
  const y = SIDEWALK_HEIGHT;
  geometries.push(
    cylinder(0.13, 0.15, 0.62, 10, x + ox * 5, y + 0.31, z + oz * 5, '#b52a1f'),
    cylinder(0.15, 0.15, 0.12, 10, x + ox * 5, y + 0.66, z + oz * 5, '#b52a1f'),
    box(0.4, 0.08, 0.08, x + ox * 5, y + 0.42, z + oz * 5, '#b52a1f'),
    cylinder(0.27, 0.24, 0.9, 12, x - ox * 4, y + 0.45, z - oz * 4, '#3c4a3f'),
    cylinder(0.3, 0.3, 0.06, 12, x - ox * 4, y + 0.92, z - oz * 4, '#2a332c'),
  );
}

export function createStreets(scene) {
  const random = createRandom(555);
  scene.add(createMarkings());

  const lamps = [];
  const trees = [];
  const props = [];
  const edge = BLOCK / 2;

  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const cx = blockCenter(i);
      const cz = blockCenter(j);
      // The four sides of the block: outward direction (toward the road) and along-the-curb direction.
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [ax, az] = [-nz, nx];
        const at = (fromCurb, along) => [cx + nx * (edge - fromCurb) + ax * along, cz + nz * (edge - fromCurb) + az * along];
        lamps.push({ position: at(0.6, 0), yaw: Math.atan2(nx, nz) });
        for (const along of [-11, 11]) trees.push({ position: at(1, along + (random() - 0.5) * 2), yaw: random() * Math.PI * 2 });
        const [px, pz] = at(0.7, 0);
        addSmallProps(props, px, pz, ax, az);
      }
    }
  }

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  function instanced(geometry, items, scaleOf) {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }), items.length);
    items.forEach(({ position: [x, z], yaw }, k) => {
      const s = scaleOf();
      matrix.compose(new THREE.Vector3(x, SIDEWALK_HEIGHT, z), rotation.setFromAxisAngle(UP, yaw), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(k, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  instanced(createLampGeometry(), lamps, () => 1);
  const treeMesh = instanced(createTreeGeometry(), trees, () => 0.85 + random() * 0.35);
  trees.forEach((_, k) => {
    const shade = 0.75 + random() * 0.4;
    treeMesh.setColorAt(k, color.setRGB(shade * (0.85 + random() * 0.25), shade, shade * 0.85));
  });

  const propMesh = new THREE.Mesh(mergeGeometries(props), new THREE.MeshLambertMaterial({ vertexColors: true }));
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  scene.add(propMesh);
}
