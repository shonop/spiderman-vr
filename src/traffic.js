import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, HALF, roadCenter } from './city.js';
import { STOP_LINE } from './streets.js';
import { patchMaterial } from './graphics.js';
import { createRandom, paint, pick } from './utils.js';

const LANE_OFFSET = 3.5;
const LANE_EXTENT = HALF + 40;
const CAR_LENGTH = 4.4;
const CARS_PER_LANE = 5;
const YELLOW_TIME = 3; // the end of every green is shown as yellow
const VIEW_DISTANCE = 170; // cars farther than this are lost in the haze, so they aren't drawn

// Traffic lights: roads along x go, all red, roads along z go, all red.
const PHASES = [
  { green: 'x', duration: 10 },
  { green: null, duration: 2.5 },
  { green: 'z', duration: 10 },
  { green: null, duration: 2.5 },
];

const TAXI = '#f2b800';
const CAR_COLORS = ['#b3171d', TAXI, TAXI, '#0d2a4a', '#2a7f75', '#e9ecef', '#1f3a40', '#7a8088', '#151517', '#1d47c2', '#c9c9c4'];

const box = (w, h, d, x, y, z, color) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const wheel = (radius, width, x, z, color) =>
  paint(new THREE.CylinderGeometry(radius, radius, width, 10).rotateX(Math.PI / 2).translate(x, 0.36, z), color);

// Car parts, built facing +x with the wheels on the ground.
function extrude(points, width, bevel, arches = []) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (const point of points.slice(1)) {
    const arch = arches.find((a) => a.after === point);
    shape.lineTo(...point);
    if (arch) shape.absarc(arch.x, 0.36, 0.42, Math.PI, 0, true);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  }).translate(0, 0, -width / 2);
}

function createCarParts() {
  const rearArchStart = [-1.77, 0.34];
  const frontArchStart = [0.93, 0.34];
  const body = extrude(
    [[-2.15, 0.34], rearArchStart, frontArchStart, [2.15, 0.34], [2.22, 0.62], [2.1, 0.86], [0.9, 1.0], [-1.85, 1.02], [-2.2, 0.95], [-2.22, 0.5]],
    1.76,
    0.05,
    [
      { after: rearArchStart, x: -1.35 },
      { after: frontArchStart, x: 1.35 },
    ],
  );
  const paintParts = mergeGeometries([
    paint(body.toNonIndexed(), '#ffffff'),
    box(1.3, 0.07, 1.5, -0.45, 1.49, 0, '#ffffff').toNonIndexed(),
    box(0.12, 0.47, 1.6, -0.45, 1.22, 0, '#ffffff').toNonIndexed(),
    box(0.22, 0.12, 0.08, 0.75, 1.05, 0.95, '#ffffff').toNonIndexed(),
    box(0.22, 0.12, 0.08, 0.75, 1.05, -0.95, '#ffffff').toNonIndexed(),
  ]);

  const glass = extrude([[0.9, 0.98], [0.15, 1.45], [-1.1, 1.47], [-1.82, 1.0]], 1.5, 0.04);

  const detailParts = [
    box(4.0, 0.2, 1.6, 0, 0.32, 0, '#141416'),
    box(0.14, 0.22, 1.86, 2.24, 0.46, 0, '#2a2b2e'),
    box(0.14, 0.22, 1.86, -2.25, 0.46, 0, '#2a2b2e'),
    box(0.05, 0.18, 0.9, 2.25, 0.7, 0, '#0e0e10'),
    box(0.03, 0.12, 0.5, 2.32, 0.46, 0, '#f1f1ea'),
    box(0.03, 0.12, 0.5, -2.33, 0.46, 0, '#f1f1ea'),
  ];
  for (const [x, z] of [[1.35, 0.86], [1.35, -0.86], [-1.35, 0.86], [-1.35, -0.86]]) {
    detailParts.push(wheel(0.36, 0.26, x, z, '#18181a'), wheel(0.21, 0.28, x, z, '#a3a8ad'));
  }

  const lights = mergeGeometries([
    box(0.06, 0.12, 0.38, 2.21, 0.75, 0.6, '#fffbe8'),
    box(0.06, 0.12, 0.38, 2.21, 0.75, -0.6, '#fffbe8'),
    box(0.06, 0.13, 0.42, -2.26, 0.8, 0.62, '#d1141c'),
    box(0.06, 0.13, 0.42, -2.26, 0.8, -0.62, '#d1141c'),
  ]);

  return {
    paint: paintParts,
    glass,
    details: mergeGeometries(detailParts),
    lights,
    taxiSign: mergeGeometries([box(0.28, 0.2, 0.62, -0.45, 1.63, 0, '#f6e7a6'), box(0.3, 0.04, 0.66, -0.45, 1.54, 0, '#2a2b2e')]),
    shadow: new THREE.PlaneGeometry(5.2, 2.5).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
  };
}

// Traffic signal: a pole on the corner with an arm reaching over the lane, facing local +z.
function createSignalGeometry() {
  const parts = [
    box(0.32, 0.25, 0.32, 0, 0.12, 0, '#2a2d2b'),
    paint(new THREE.CylinderGeometry(0.09, 0.11, 5.7, 10).translate(0, 2.85, 0), '#2f3330'),
    box(4.9, 0.12, 0.12, -2.45, 5.55, 0, '#2f3330'),
    box(0.44, 1.25, 0.3, -4.6, 5.0, 0, '#1d1f1c'),
    box(0.75, 1.55, 0.04, -4.6, 5.0, -0.17, '#111211'),
  ];
  for (const y of [5.37, 5.0, 4.63]) parts.push(box(0.36, 0.04, 0.2, -4.6, y + 0.15, 0.24, '#1d1f1c'));
  return mergeGeometries(parts.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry)));
}

const BULB_HEIGHTS = { red: 5.37, yellow: 5.0, green: 4.63 };
const BULB_ON = {
  red: new THREE.Color(5, 0.35, 0.2),
  yellow: new THREE.Color(4.5, 2.6, 0.2),
  green: new THREE.Color(0.3, 4, 1.6),
};
const BULB_OFF = new THREE.Color(0.07, 0.07, 0.06);

// Cars that drive in lanes and stop at red lights.
export function createTraffic(scene, { skyMap, blobTexture }) {
  const random = createRandom(42);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const intersections = Array.from({ length: BLOCKS + 1 }, (_, j) => roadCenter(j));

  const lanes = [];
  for (const c of intersections) {
    lanes.push(
      { axis: 'x', dir: 1, fixed: c + LANE_OFFSET, cars: [] },
      { axis: 'x', dir: -1, fixed: c - LANE_OFFSET, cars: [] },
      { axis: 'z', dir: 1, fixed: c - LANE_OFFSET, cars: [] },
      { axis: 'z', dir: -1, fixed: c + LANE_OFFSET, cars: [] },
    );
  }

  let carCount = 0;
  const spacing = (2 * LANE_EXTENT) / CARS_PER_LANE;
  for (const lane of lanes) {
    for (let k = 0; k < CARS_PER_LANE; k++) {
      lane.cars.push({
        index: carCount++,
        s: -LANE_EXTENT + k * spacing + random() * spacing * 0.5,
        speed: 0,
        maxSpeed: 9 + random() * 5,
      });
    }
  }

  const parts = createCarParts();
  const instanced = (geometry, material, count = carCount) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const shiny = (options, reflectivity) =>
    patchMaterial(
      new THREE.MeshLambertMaterial({ ...options, envMap: skyMap, combine: THREE.MixOperation, reflectivity }),
      { fresnel: true },
    );

  const carMeshes = [
    instanced(parts.paint, shiny({ vertexColors: true }, 0.12)),
    instanced(parts.glass, shiny({ color: 0x1b252c }, 0.9)),
    instanced(parts.details, new THREE.MeshLambertMaterial({ vertexColors: true })),
    instanced(parts.lights, new THREE.MeshBasicMaterial({ vertexColors: true })),
    instanced(
      parts.shadow,
      new THREE.MeshBasicMaterial({ map: blobTexture, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    ),
  ];
  // Instance slots go to the cars near the player each frame; a slot's paint color is
  // rewritten whenever a different car takes it.
  const carColors = Array.from({ length: carCount }, () => pick(random, CAR_COLORS));
  carColors.forEach((hex, i) => carMeshes[0].setColorAt(i, color.set(hex)));
  const slotOwners = Array.from({ length: carCount }, (_, i) => i);
  const taxiCount = carColors.filter((hex) => hex === TAXI).length;
  const taxiSigns = instanced(parts.taxiSign, new THREE.MeshBasicMaterial({ vertexColors: true }), taxiCount);

  // One signal per approach, on the far right corner of the intersection as the driver sees it.
  const signals = [];
  for (let i = 0; i <= BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      const center = new THREE.Vector3(intersections[i], 0.12, intersections[j]);
      for (const [axis, dir] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
        // Is there a road for cars to come from?
        const from = (axis === 'x' ? i : j) - dir;
        if (from < 0 || from > BLOCKS) continue;
        const forward = axis === 'x' ? new THREE.Vector3(dir, 0, 0) : new THREE.Vector3(0, 0, dir);
        const right = new THREE.Vector3(-forward.z, 0, forward.x);
        dummy.position.copy(center).addScaledVector(forward, 8.3).addScaledVector(right, 8.3);
        dummy.rotation.set(0, Math.atan2(-forward.x, -forward.z), 0);
        dummy.updateMatrix();
        signals.push({ axis, matrix: dummy.matrix.clone() });
      }
    }
  }
  const poles = instanced(createSignalGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), signals.length);
  poles.castShadow = true;
  signals.forEach((signal, k) => poles.setMatrixAt(k, signal.matrix));

  const bulbs = instanced(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial(), signals.length * 3);
  const local = new THREE.Matrix4();
  signals.forEach((signal, k) => {
    Object.values(BULB_HEIGHTS).forEach((y, b) => {
      local.makeTranslation(-4.6, y, 0.17);
      bulbs.setMatrixAt(k * 3 + b, local.premultiply(signal.matrix));
      bulbs.setColorAt(k * 3 + b, BULB_OFF);
    });
  });

  let phase = 0;
  let phaseTime = 0;
  let shownLights = '';

  function updateSignals() {
    const { green, duration } = PHASES[phase];
    const lightFor = (axis) => (axis !== green ? 'red' : phaseTime > duration - YELLOW_TIME ? 'yellow' : 'green');
    const state = `${lightFor('x')}-${lightFor('z')}`;
    if (state === shownLights) return;
    shownLights = state;
    signals.forEach((signal, k) => {
      const lit = lightFor(signal.axis);
      Object.keys(BULB_HEIGHTS).forEach((name, b) => bulbs.setColorAt(k * 3 + b, name === lit ? BULB_ON[name] : BULB_OFF));
    });
    bulbs.instanceColor.needsUpdate = true;
  }

  function updateCars(dt, player) {
    let visible = 0;
    let taxisVisible = 0;
    phaseTime += dt;
    if (phaseTime > PHASES[phase].duration) {
      phaseTime = 0;
      phase = (phase + 1) % PHASES.length;
    }
    const green = PHASES[phase].green;
    updateSignals();

    for (const lane of lanes) {
      const { cars, dir } = lane;
      cars.sort((a, b) => (a.s - b.s) * dir);

      for (let k = 0; k < cars.length; k++) {
        const car = cars[k];
        const front = car.s * dir + CAR_LENGTH / 2;

        // How many meters this car can drive before it has to stop.
        const ahead = cars[(k + 1) % cars.length];
        let gap = ahead.s * dir - CAR_LENGTH / 2 - front;
        if (k === cars.length - 1) gap += 2 * LANE_EXTENT;
        let room = gap - 3;

        if (lane.axis !== green) {
          for (const c of intersections) {
            const toStopLine = c * dir - STOP_LINE - 0.4 - front;
            if (toStopLine > -0.5 && toStopLine < room) room = toStopLine;
          }
        }

        // Stop for the player when they stand in the lane.
        if (player.y < 3) {
          const across = lane.axis === 'x' ? player.z : player.x;
          const along = (lane.axis === 'x' ? player.x : player.z) * dir;
          if (Math.abs(across - lane.fixed) < 1.8) {
            const toPlayer = along - front - 1.5;
            if (toPlayer > -CAR_LENGTH && toPlayer < room) room = toPlayer;
          }
        }

        room = Math.max(0, room);
        const target = Math.min(car.maxSpeed, room * 1.2);
        car.speed = car.speed < target ? Math.min(target, car.speed + 4 * dt) : Math.max(target, car.speed - 12 * dt);
        car.s += Math.min(car.speed * dt, room) * dir;
        if (car.s * dir > LANE_EXTENT) car.s -= 2 * LANE_EXTENT * dir;

        if (lane.axis === 'x') {
          dummy.position.set(car.s, 0, lane.fixed);
          dummy.rotation.set(0, dir > 0 ? 0 : Math.PI, 0);
        } else {
          dummy.position.set(lane.fixed, 0, car.s);
          dummy.rotation.set(0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
        }
        if ((dummy.position.x - player.x) ** 2 + (dummy.position.z - player.z) ** 2 > VIEW_DISTANCE ** 2) continue;
        dummy.updateMatrix();
        const slot = visible++;
        if (slotOwners[slot] !== car.index) {
          slotOwners[slot] = car.index;
          carMeshes[0].setColorAt(slot, color.set(carColors[car.index]));
          carMeshes[0].instanceColor.needsUpdate = true;
        }
        for (const mesh of carMeshes) mesh.setMatrixAt(slot, dummy.matrix);
        if (carColors[car.index] === TAXI) taxiSigns.setMatrixAt(taxisVisible++, dummy.matrix);
      }
    }
    for (const mesh of carMeshes) {
      mesh.count = visible;
      mesh.instanceMatrix.needsUpdate = true;
    }
    taxiSigns.count = taxisVisible;
    taxiSigns.instanceMatrix.needsUpdate = true;
  }

  return { update: updateCars };
}
