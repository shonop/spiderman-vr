import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, BLOCK, HALF, ROAD, SIDEWALK_HEIGHT, roadCenter, blockCenter } from './city.js';
import { createRandom, paint, pick } from './utils.js';

const LANE_OFFSET = 3.5;
const LANE_EXTENT = HALF + 40;
const CAR_LENGTH = 4.4;
const CARS_PER_LANE = 5;
const PEOPLE_PER_BLOCK = 6;
const WALK_PATH = BLOCK - 4; // people walk a square loop 2m in from the curb

// Traffic lights: roads along x go, all red, roads along z go, all red.
const PHASES = [
  { green: 'x', duration: 10 },
  { green: null, duration: 2.5 },
  { green: 'z', duration: 10 },
  { green: null, duration: 2.5 },
];

const CAR_COLORS = ['#d62828', '#f2c200', '#f2c200', '#003049', '#2a9d8f', '#e9ecef', '#264653', '#6c757d', '#1a1a1a', '#1d4ed8'];
const SKIN_TONES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

function createCarGeometry() {
  const parts = [
    paint(new THREE.BoxGeometry(4.2, 0.75, 1.9).translate(0, 0.6, 0), '#ffffff'),
    paint(new THREE.BoxGeometry(2.3, 0.65, 1.7).translate(-0.3, 1.3, 0), '#2a3038'),
  ];
  for (const [x, z] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) {
    parts.push(paint(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12).rotateX(Math.PI / 2).translate(x, 0.36, z), '#111111'));
  }
  return mergeGeometries(parts);
}

function createPersonGeometry() {
  return mergeGeometries([
    paint(new THREE.BoxGeometry(0.16, 0.85, 0.18).translate(-0.1, 0.425, 0), '#2b3040'),
    paint(new THREE.BoxGeometry(0.16, 0.85, 0.18).translate(0.1, 0.425, 0), '#2b3040'),
    paint(new THREE.BoxGeometry(0.46, 0.62, 0.26).translate(0, 1.17, 0), '#ffffff'),
    paint(new THREE.BoxGeometry(0.12, 0.6, 0.14).translate(-0.3, 1.15, 0), '#ffffff'),
    paint(new THREE.BoxGeometry(0.12, 0.6, 0.14).translate(0.3, 1.15, 0), '#ffffff'),
  ]);
}

// Cars that drive in lanes and stop at red lights, and people walking around the blocks.
export function createTraffic(scene) {
  const random = createRandom(42);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const intersections = Array.from({ length: BLOCKS + 1 }, (_, j) => roadCenter(j));

  // ---- Cars ----
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

  const carMesh = new THREE.InstancedMesh(createCarGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), carCount);
  carMesh.frustumCulled = false;
  for (let i = 0; i < carCount; i++) carMesh.setColorAt(i, color.set(pick(random, CAR_COLORS)));
  scene.add(carMesh);

  // ---- People ----
  const people = [];
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      for (let k = 0; k < PEOPLE_PER_BLOCK; k++) {
        people.push({
          cx: blockCenter(i),
          cz: blockCenter(j),
          t: random() * 4 * WALK_PATH,
          dir: random() < 0.5 ? 1 : -1,
          speed: 1.1 + random() * 0.6,
          phase: random() * Math.PI * 2,
        });
      }
    }
  }

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const bodyMesh = new THREE.InstancedMesh(createPersonGeometry(), material, people.length);
  const headMesh = new THREE.InstancedMesh(
    paint(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.66, 0), '#ffffff'),
    material,
    people.length,
  );
  bodyMesh.frustumCulled = headMesh.frustumCulled = false;
  people.forEach((_, i) => {
    bodyMesh.setColorAt(i, color.setHSL(random(), 0.6, 0.5));
    headMesh.setColorAt(i, color.set(pick(random, SKIN_TONES)));
  });
  scene.add(bodyMesh, headMesh);

  let phase = 0;
  let phaseTime = 0;

  function updateCars(dt, player) {
    phaseTime += dt;
    if (phaseTime > PHASES[phase].duration) {
      phaseTime = 0;
      phase = (phase + 1) % PHASES.length;
    }
    const green = PHASES[phase].green;

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
            const toStopLine = c * dir - ROAD / 2 - 1 - front;
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
        dummy.updateMatrix();
        carMesh.setMatrixAt(car.index, dummy.matrix);
      }
    }
    carMesh.instanceMatrix.needsUpdate = true;
  }

  function updatePeople(dt) {
    const loop = 4 * WALK_PATH;
    const half = WALK_PATH / 2;
    people.forEach((person, i) => {
      person.t = (person.t + person.dir * person.speed * dt + loop) % loop;
      person.phase += person.speed * dt * 5;

      const side = Math.floor(person.t / WALK_PATH);
      const u = person.t - side * WALK_PATH;
      let x, z, dx, dz;
      if (side === 0) [x, z, dx, dz] = [-half + u, -half, 1, 0];
      else if (side === 1) [x, z, dx, dz] = [half, -half + u, 0, 1];
      else if (side === 2) [x, z, dx, dz] = [half - u, half, -1, 0];
      else [x, z, dx, dz] = [-half, half - u, 0, -1];

      dummy.position.set(person.cx + x, SIDEWALK_HEIGHT + Math.abs(Math.sin(person.phase)) * 0.05, person.cz + z);
      dummy.rotation.set(0, Math.atan2(dx * person.dir, dz * person.dir), 0);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      headMesh.setMatrixAt(i, dummy.matrix);
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    update(dt, playerPosition) {
      updateCars(dt, playerPosition);
      updatePeople(dt);
    },
  };
}
