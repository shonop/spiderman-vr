import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, BLOCK, SIDEWALK_HEIGHT, blockCenter } from './city.js';
import { createRandom, paint, pick } from './utils.js';

const PEOPLE_PER_BLOCK = 6;
const WALK_PATH = BLOCK - 4; // people walk a square loop 2m in from the curb
const STRIDE = 4.5; // walk-cycle radians per meter walked
const LEG_SWING = 0.45;
const ARM_SWING = 0.35;

// Joint positions (meters above the feet) for an average 1.75m person facing +z.
export const HIP = { x: 0.09, y: 0.9 };
export const SHOULDER = { x: 0.22, y: 1.41 };
export const ARM_SPREAD = 0.06; // arms hang slightly away from the body
const VIEW_DISTANCE = 100; // people farther than this are lost in the haze, so they aren't drawn

const SKIN_TONES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'];
const HAIR_COLORS = ['#1b1512', '#3b2416', '#6a4325', '#b88a4a', '#d9b26f', '#8c3b1f', '#9a9a9a'];
const PANTS_COLORS = ['#2b3a55', '#3d5a80', '#1f1f24', '#4a4a4f', '#8a7a5c', '#5b4636', '#26303f'];
const SHIRT_COLORS = ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#2a9d8f', '#e9c46a', '#f4a261', '#6d597a', '#ffffff', '#222222', '#88b04b'];

const white = (geometry) => paint(geometry, '#ffffff');

// Every part is white so the per-person instance color (skin, shirt, ...) shows through.
// Dark vertex colors (eyes, shoes) stay dark whatever the instance color is.
export const PARTS = {
  head: () =>
    mergeGeometries([
      white(new THREE.SphereGeometry(0.105, 14, 10).scale(0.92, 1.1, 1).translate(0, 1.63, 0)),
      white(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8).translate(0, 1.5, 0)),
      white(new THREE.SphereGeometry(0.022, 6, 4).scale(0.8, 1, 1.2).translate(0, 1.615, 0.1)),
      white(new THREE.SphereGeometry(0.022, 6, 4).scale(0.5, 1, 0.8).translate(-0.097, 1.63, 0)),
      white(new THREE.SphereGeometry(0.022, 6, 4).scale(0.5, 1, 0.8).translate(0.097, 1.63, 0)),
      paint(new THREE.SphereGeometry(0.014, 6, 4).translate(-0.035, 1.655, 0.092), '#141414'),
      paint(new THREE.SphereGeometry(0.014, 6, 4).translate(0.035, 1.655, 0.092), '#141414'),
    ]),
  // Hair cap tilted back so the forehead and face stay visible.
  shortHair: () =>
    white(
      new THREE.SphereGeometry(0.114, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)
        .rotateX(-0.4)
        .scale(0.95, 1.12, 1.03)
        .translate(0, 1.64, -0.005),
    ),
  longHair: () =>
    mergeGeometries([
      white(
        new THREE.SphereGeometry(0.116, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)
          .rotateX(-0.4)
          .scale(0.97, 1.12, 1.04)
          .translate(0, 1.64, -0.005),
      ),
      white(new THREE.SphereGeometry(0.1, 10, 6).scale(1.08, 1.7, 0.5).translate(0, 1.5, -0.07)),
    ]),
  torso: () =>
    mergeGeometries([
      white(new THREE.CylinderGeometry(0.18, 0.15, 0.48, 12).scale(1, 1, 0.6).translate(0, 1.2, 0)),
      white(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.8).translate(0, 1.41, 0)),
    ]),
  hips: () => white(new THREE.CylinderGeometry(0.155, 0.16, 0.16, 12).scale(1, 1, 0.65).translate(0, 0.93, 0)),
  // Limbs are built hanging down from their joint at (0, 0, 0) so they can swing.
  leg: () =>
    mergeGeometries([
      white(new THREE.CapsuleGeometry(0.076, 0.7, 3, 8).translate(0, -0.43, 0)),
      paint(new THREE.BoxGeometry(0.1, 0.07, 0.25).translate(0, -0.865, 0.04), '#1c1c1c'),
    ]),
  arm: () => white(new THREE.CapsuleGeometry(0.052, 0.44, 3, 6).translate(0, -0.27, 0)),
  hand: () => white(new THREE.SphereGeometry(0.048, 8, 6).scale(0.8, 1.2, 0.6).translate(0, -0.58, 0)),
};

// People walking around the blocks, with swinging arms and legs.
// Each body part is one InstancedMesh, so ~300 people cost only a handful of draw calls.
export function createPeople(scene, blobTexture) {
  const random = createRandom(99);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  const people = [];
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      for (let k = 0; k < PEOPLE_PER_BLOCK; k++) {
        const walking = random() > 0.15;
        people.push({
          cx: blockCenter(i),
          cz: blockCenter(j),
          t: random() * 4 * WALK_PATH,
          dir: random() < 0.5 ? 1 : -1,
          speed: walking ? 1.1 + random() * 0.6 : 0,
          heading: random() * Math.PI * 2, // used by people standing still
          phase: random() * Math.PI * 2,
          height: 0.92 + random() * 0.16,
          width: 0.9 + random() * 0.25,
          longHair: random() < 0.45,
          skin: pick(random, SKIN_TONES),
          hair: pick(random, HAIR_COLORS),
          shirt: random() < 0.6 ? pick(random, SHIRT_COLORS) : new THREE.Color().setHSL(random(), 0.55, 0.5).getHex(),
          pants: pick(random, PANTS_COLORS),
        });
      }
    }
  }

  const color = new THREE.Color();
  // Instance slots are handed out each frame to the people near the player, so a slot's
  // colors are rewritten whenever a different person takes it.
  function createPart(geometry, members, colorKey) {
    const mesh = new THREE.InstancedMesh(geometry, material, members.length);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    members.forEach((person, i) => mesh.setColorAt(i, color.set(person[colorKey])));
    mesh.userData.colorKey = colorKey;
    scene.add(mesh);
    return mesh;
  }

  const everyone = people;
  const shortHaired = people.filter((p) => !p.longHair);
  const longHaired = people.filter((p) => p.longHair);
  const meshes = {
    head: createPart(PARTS.head(), everyone, 'skin'),
    torso: createPart(PARTS.torso(), everyone, 'shirt'),
    hips: createPart(PARTS.hips(), everyone, 'pants'),
    legL: createPart(PARTS.leg(), everyone, 'pants'),
    legR: createPart(PARTS.leg(), everyone, 'pants'),
    armL: createPart(PARTS.arm(), everyone, 'shirt'),
    armR: createPart(PARTS.arm(), everyone, 'shirt'),
    handL: createPart(PARTS.hand(), everyone, 'skin'),
    handR: createPart(PARTS.hand(), everyone, 'skin'),
    shortHair: createPart(PARTS.shortHair(), shortHaired, 'hair'),
    longHair: createPart(PARTS.longHair(), longHaired, 'hair'),
  };
  // Soft dark spot on the ground under each person.
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    people.length,
  );
  shadows.frustumCulled = false;
  scene.add(shadows);
  const shadowMatrix = new THREE.Matrix4();

  const bodyMeshes = Object.entries(meshes)
    .filter(([name]) => !name.endsWith('Hair'))
    .map(([, mesh]) => mesh);
  const bodySlots = people.slice();
  const hairSlots = { short: shortHaired.slice(), long: longHaired.slice() };

  function claimSlot(owners, slot, person, meshList) {
    if (owners[slot] === person) return;
    owners[slot] = person;
    for (const mesh of meshList) {
      mesh.setColorAt(slot, color.set(person[mesh.userData.colorKey]));
      mesh.instanceColor.needsUpdate = true;
    }
  }

  const body = new THREE.Matrix4();
  const joint = new THREE.Matrix4();
  const limb = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');
  const UP = new THREE.Vector3(0, 1, 0);

  function setLimb(mesh, index, x, y, swing, spread) {
    joint.makeRotationFromEuler(euler.set(swing, 0, spread));
    joint.setPosition(x, y, 0);
    mesh.setMatrixAt(index, limb.multiplyMatrices(body, joint));
  }

  function update(dt, viewer) {
    const loop = 4 * WALK_PATH;
    const half = WALK_PATH / 2;

    let visible = 0;
    let shortCount = 0;
    let longCount = 0;

    for (const person of people) {
      let x, z, heading;
      if (person.speed > 0) {
        person.t = (person.t + person.dir * person.speed * dt + loop) % loop;
        person.phase += person.speed * dt * STRIDE;
      }
      const side = Math.floor(person.t / WALK_PATH);
      const u = person.t - side * WALK_PATH;
      let dx, dz;
      if (side === 0) [x, z, dx, dz] = [-half + u, -half, 1, 0];
      else if (side === 1) [x, z, dx, dz] = [half, -half + u, 0, 1];
      else if (side === 2) [x, z, dx, dz] = [half - u, half, -1, 0];
      else [x, z, dx, dz] = [-half, half - u, 0, -1];
      heading = person.speed > 0 ? Math.atan2(dx * person.dir, dz * person.dir) : person.heading;

      const wx = person.cx + x;
      const wz = person.cz + z;
      if ((wx - viewer.x) ** 2 + (wz - viewer.z) ** 2 > VIEW_DISTANCE ** 2) continue;
      const i = visible++;
      claimSlot(bodySlots, i, person, bodyMeshes);
      const hairMesh = person.longHair ? meshes.longHair : meshes.shortHair;
      const hairIndex = person.longHair ? longCount++ : shortCount++;
      claimSlot(person.longHair ? hairSlots.long : hairSlots.short, hairIndex, person, [hairMesh]);

      const walking = person.speed > 0;
      const stride = walking ? Math.sin(person.phase) : 0;
      const bob = walking ? Math.abs(Math.cos(person.phase)) * 0.03 : 0;

      position.set(wx, SIDEWALK_HEIGHT + bob, wz);
      rotation.setFromAxisAngle(UP, heading);
      scale.set(person.width, person.height, person.width);
      body.compose(position, rotation, scale);

      shadows.setMatrixAt(i, shadowMatrix.makeTranslation(position.x, SIDEWALK_HEIGHT + 0.01, position.z));
      meshes.head.setMatrixAt(i, body);
      meshes.torso.setMatrixAt(i, body);
      meshes.hips.setMatrixAt(i, body);
      hairMesh.setMatrixAt(hairIndex, body);

      setLimb(meshes.legL, i, -HIP.x, HIP.y, stride * LEG_SWING, 0);
      setLimb(meshes.legR, i, HIP.x, HIP.y, -stride * LEG_SWING, 0);
      setLimb(meshes.armL, i, -SHOULDER.x, SHOULDER.y, -stride * ARM_SWING, -ARM_SPREAD);
      meshes.handL.setMatrixAt(i, limb);
      setLimb(meshes.armR, i, SHOULDER.x, SHOULDER.y, stride * ARM_SWING, ARM_SPREAD);
      meshes.handR.setMatrixAt(i, limb);
    }

    for (const mesh of bodyMeshes) mesh.count = visible;
    shadows.count = visible;
    meshes.shortHair.count = shortCount;
    meshes.longHair.count = longCount;

    for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
  }

  return { update };
}
