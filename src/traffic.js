import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, HALF, ROAD, roadCenter } from './city.js';
import { createRandom, paint, pick } from './utils.js';

const LANE_OFFSET = 3.5;
const LANE_EXTENT = HALF + 40;
const CAR_LENGTH = 4.4;
const CARS_PER_LANE = 5;

// Traffic lights: roads along x go, all red, roads along z go, all red.
const PHASES = [
  { green: 'x', duration: 10 },
  { green: null, duration: 2.5 },
  { green: 'z', duration: 10 },
  { green: null, duration: 2.5 },
];

const CAR_COLORS = ['#d62828', '#f2c200', '#f2c200', '#003049', '#2a9d8f', '#e9ecef', '#264653', '#6c757d', '#1a1a1a', '#1d4ed8'];

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

// Cars that drive in lanes and stop at red lights.
export function createTraffic(scene) {
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

  const carMesh = new THREE.InstancedMesh(createCarGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), carCount);
  carMesh.frustumCulled = false;
  for (let i = 0; i < carCount; i++) carMesh.setColorAt(i, color.set(pick(random, CAR_COLORS)));
  scene.add(carMesh);

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

  return { update: updateCars };
}
