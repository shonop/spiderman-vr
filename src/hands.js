import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIDES } from './input.js';
import { createHumanMaterial } from './human.js';

// The player's own hands, shown where the controllers are (and at the bottom of the screen
// on desktop). Each hand is one skinned mesh with a real skeleton: a palm, three joints in
// every finger and a thumb that can swing across the palm, so the fingers follow the buttons:
//
//   trigger           → Spider-Man's "thwip": middle and ring fingers pressed in, the rest out
//   grip              → fist
//   finger off trigger → pointing
//   thumb off buttons  → thumbs up
//
// The hand is built as a right hand in its own space: wrist at the origin, fingers along +y,
// palm facing +z, thumb on +x. The left hand is the same mesh mirrored.

const { lerp, smoothstep } = THREE.MathUtils;

const PALM_LENGTH = 0.094;
// Knuckle position on the palm, splay (+ = toward the thumb), phalanx lengths and thickness.
const FINGERS = [
  { x: 0.026, y: 0.092, splay: 0.08, lengths: [0.043, 0.025, 0.02], radius: 0.0097 }, // index
  { x: 0.0075, y: 0.096, splay: 0.0, lengths: [0.047, 0.029, 0.021], radius: 0.01 }, // middle
  { x: -0.0115, y: 0.092, splay: -0.08, lengths: [0.044, 0.027, 0.021], radius: 0.0093 }, // ring
  { x: -0.029, y: 0.083, splay: -0.18, lengths: [0.034, 0.02, 0.019], radius: 0.0081 }, // pinky
];
const THUMB = {
  base: new THREE.Vector3(0.02, 0.016, 0.007),
  dir: new THREE.Vector3(0.72, 0.62, 0.3), // which way the thumb points when relaxed
  pad: new THREE.Vector3(-0.55, 0, 0.83), // which way it bends
  lengths: [0.046, 0.032, 0.027],
  radius: 0.0125,
};

// Where the wrist sits in the controller's grip space (WebXR: origin in the middle of the
// curled fingers, -z along the handle toward the thumb, back of the right hand toward +x,
// +y up the arm).
const GRIP_OFFSET = new THREE.Vector3(0.029, 0.08, -0.001); // puts the middle of a fist on the grip origin
const GRIP_BASIS = {
  right: new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)),
  left: new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)),
};

// --- Poses ---------------------------------------------------------------------------------
// [index mcp, pip, dip, middle ×3, ring ×3, pinky ×3, spread, thumb adduct, thumb ×3 bend]

const SPREAD = 12;
const THUMB_AT = 13;
const pose = (fingers, spread, thumb) => Float32Array.from([...fingers.flat(), spread, ...thumb]);
const POSES = {
  relaxed: pose([[0.3, 0.38, 0.2], [0.38, 0.46, 0.24], [0.46, 0.52, 0.28], [0.54, 0.58, 0.32]], 1, [0.05, 0.22, 0.22, 0.2]),
  fist: pose([[1.45, 1.95, 1.05], [1.49, 1.95, 1.05], [1.53, 1.95, 1.05], [1.57, 1.95, 1.05]], 0.1, [0.6, 0.5, 0.2, 0.8]),
  thwip: pose([[0.02, 0.03, 0.02], [1.5, 1.85, 0.95], [1.5, 1.85, 0.95], [0.03, 0.05, 0.03]], 1.9, [-0.5, -0.12, 0.05, 0.02]),
};
const POINT = [0.05, 0.06, 0.04];
const THUMB_UP = [-0.15, 0.95, -0.15, -0.1];
const THUMB_REST = [0.35, 0.5, 0.25, 0.18];

// --- Geometry ------------------------------------------------------------------------------

// A rounded, slightly tapered tube along +y from 0 to `length`, closed with domes.
function tube(length, r0, r1, { flat = 0.86, radial = 14, endCap = 1, startCap = 1 } = {}) {
  const points = [];
  const cap = 5;
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0 * startCap));
  }
  for (let i = 1; i < 6; i++) points.push(new THREE.Vector2(lerp(r0, r1, i / 6), (i / 6) * length));
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.cos(a) * r1, length + Math.sin(a) * r1 * endCap));
  }
  points[0].x = 0;
  points[points.length - 1].x = 0;
  return new THREE.LatheGeometry(points, radial).scale(1, 1, flat);
}

function knuckleY(x) {
  const xs = FINGERS.map((f) => f.x);
  if (x >= xs[0]) return FINGERS[0].y;
  for (let i = 1; i < FINGERS.length; i++) {
    if (x >= xs[i]) return lerp(FINGERS[i].y, FINGERS[i - 1].y, (x - xs[i]) / (xs[i - 1] - xs[i]));
  }
  return FINGERS[FINGERS.length - 1].y;
}

const bump = (x, y, cx, cy, sx, sy) => Math.exp(-((x - cx) ** 2) / sx - (y - cy) ** 2 / sy);

function palmGeometry() {
  const W = 0.078;
  const L = 0.104;
  const T = 0.03;
  const R = 0.0125;
  const geometry = new THREE.BoxGeometry(W, L, T, 14, 14, 6);
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  const inner = new THREE.Vector3(W / 2 - R, L / 2 - R, T / 2 - R);
  const core = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    core.copy(p).clamp(inner.clone().negate(), inner);
    p.sub(core).setLength(R).add(core);
    p.y += L / 2 - 0.01;

    const { x, y } = p;
    const top = smoothstep(y, 0.045, 0.094);
    p.x *= lerp(0.8, 1, smoothstep(y, -0.01, 0.06));
    p.y += (knuckleY(p.x) - 0.094) * top;
    p.z *= lerp(1, 0.78, top);
    if (p.z > 0) {
      p.z += 0.0095 * bump(x, y, 0.024, 0.026, 0.0003, 0.0011); // ball of the thumb
      p.z += 0.0055 * bump(x, y, -0.026, 0.035, 0.00025, 0.0016); // the pinky side
      p.z += 0.004 * bump(x, y, 0, 0.088, 0.0012, 0.00008); // pads under the knuckles
      p.z -= 0.0035 * bump(x, y, 0.002, 0.055, 0.0004, 0.0007); // hollow of the palm
    } else {
      p.z -= 0.0025 * Math.cos((x / 0.04) * (Math.PI / 2)); // the back of the hand arches
    }
    position.setXYZ(i, p.x, p.y, p.z);
  }
  return geometry;
}

// Creates the skeleton and the skinned mesh for one (right) hand.
function buildHand(material) {
  const root = new THREE.Bone();
  const fingers = FINGERS.map((finger) => {
    const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
    bones[0].position.set(finger.x, finger.y, 0.001);
    bones[0].rotation.order = 'ZXY';
    root.add(bones[0]);
    bones[1].position.y = finger.lengths[0];
    bones[0].add(bones[1]);
    bones[2].position.y = finger.lengths[1];
    bones[1].add(bones[2]);
    return bones;
  });

  const y = THUMB.dir.clone().normalize();
  const z = THUMB.pad.clone().addScaledVector(y, -THUMB.pad.dot(y)).normalize();
  const thumbBase = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
  const thumb = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  thumb[0].position.copy(THUMB.base);
  thumb[0].quaternion.copy(thumbBase);
  root.add(thumb[0]);
  thumb[1].position.y = THUMB.lengths[0];
  thumb[0].add(thumb[1]);
  thumb[2].position.y = THUMB.lengths[1];
  thumb[1].add(thumb[2]);

  const nozzle = new THREE.Object3D(); // where the web comes out: the shooter on the inside of the wrist
  nozzle.position.set(0, -0.012, 0.025);
  root.add(nozzle);

  const bones = [root, ...fingers.flat(), ...thumb];
  const boneIndex = new Map(bones.map((bone, i) => [bone, i]));
  root.updateMatrixWorld(true);

  // --- Paint and skin every part ---
  const SKIN = new THREE.Color('#d39f87');
  const PALM = new THREE.Color('#e4b2a0');
  const BACK = new THREE.Color('#c99079');
  const NAIL = new THREE.Color('#ecc8bd');
  const TIP = new THREE.Color('#e8ab98');
  const CREASE = new THREE.Color('#b37a66');
  const SLEEVE = new THREE.Color('#2a2e35');
  const CUFF = new THREE.Color('#21252b');
  const METAL = new THREE.Color('#9aa4ae');
  const DARK = new THREE.Color('#33373d');
  const RED = new THREE.Color('#c8102e');
  const color = new THREE.Color();

  const parts = [];
  const p = new THREE.Vector3();
  // geometry is in the bone's own space; paint(p) returns [color, roughness]
  function add(geometry, bone, { parent = null, blend = 0, paint }) {
    geometry.deleteAttribute('uv');
    geometry.deleteAttribute('normal');
    geometry = mergeVertices(geometry);
    const position = geometry.attributes.position;
    const n = position.count;
    const colors = new Float32Array(n * 4);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(position, i);
      const [c, rough] = paint(p);
      colors.set([c.r, c.g, c.b, rough], i * 4);
      const own = parent ? smoothstep(p.y, -blend, blend) : 1;
      skinIndex.set([boneIndex.get(bone), boneIndex.get(parent ?? bone)], i * 4);
      skinWeight.set([own, 1 - own], i * 4);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    geometry.applyMatrix4(bone.matrixWorld);
    geometry.computeVertexNormals();
    parts.push(geometry);
  }

  // A finger segment: lighter underneath, a darker crease over each joint, a nail at the tip.
  const segmentPaint = (length, radius, last) => (q) => {
    const back = -q.z / radius; // 1 on the back of the finger
    color.copy(back > 0 ? SKIN : PALM).lerp(BACK, Math.max(0, back) * 0.5);
    if (back > 0.3 && Math.abs(q.y) < 0.004) color.lerp(CREASE, 0.35);
    if (last) {
      if (back > 0.45 && q.y > length * 0.3) return [NAIL, 0.32];
      if (q.y > length * 0.6) color.lerp(TIP, 0.5);
    }
    return [color, back > 0.45 && last && q.y > length * 0.3 ? 0.32 : 0.55];
  };

  FINGERS.forEach((finger, f) => {
    const r = finger.radius;
    const radii = [r, r * 0.93, r * 0.86, r * 0.78];
    finger.lengths.forEach((length, k) => {
      const last = k === 2;
      const geometry = tube(length, radii[k], radii[k + 1], { endCap: last ? 1.15 : 1 });
      if (last) flattenNail(geometry, length, radii[k + 1]);
      add(geometry, fingers[f][k], { parent: k === 0 ? root : fingers[f][k - 1], blend: radii[k] * 0.7, paint: segmentPaint(length, radii[k], last) });
    });
  });

  const tr = THUMB.radius;
  const thumbRadii = [tr, tr * 0.88, tr * 0.84, tr * 0.74];
  THUMB.lengths.forEach((length, k) => {
    const last = k === 2;
    const geometry = tube(length, thumbRadii[k], thumbRadii[k + 1], { flat: 0.82, endCap: last ? 1.1 : 1 });
    if (last) flattenNail(geometry, length, thumbRadii[k + 1]);
    add(geometry, thumb[k], { parent: k === 0 ? root : thumb[k - 1], blend: thumbRadii[k] * (k === 0 ? 1.4 : 0.7), paint: segmentPaint(length, thumbRadii[k], last) });
  });

  add(palmGeometry(), root, {
    paint: (q) => {
      color.copy(q.z > 0 ? PALM : SKIN);
      if (q.z < 0) color.lerp(BACK, smoothstep(q.y, 0.05, 0.09) * 0.4);
      return [color, 0.55];
    },
  });

  // The wrist and forearm, with the web shooter strapped on and the sleeve over it.
  add(tube(0.14, 0.029, 0.025, { flat: 0.74 }).translate(0, -0.15, 0), root, { paint: () => [SKIN, 0.55] });
  add(tube(0.024, 0.0285, 0.0275, { flat: 0.8, startCap: 0.2, endCap: 0.2 }).translate(0, -0.04, 0), root, {
    paint: (q) => (Math.abs(q.y + 0.028) < 0.003 ? [RED, 0.4] : [METAL, 0.28]),
  });
  add(tube(0.016, 0.0055, 0.0045, { flat: 1, radial: 10 }).translate(0, -0.034, 0.024), root, { paint: () => [DARK, 0.3] });
  add(tube(0.2, 0.039, 0.036, { flat: 0.8, endCap: 0.22 }).translate(0, -0.29, 0), root, {
    paint: (q) => {
      const cuff = q.y > -0.115;
      color.copy(cuff ? CUFF : SLEEVE);
      if (cuff && Math.sin(Math.atan2(q.x, q.z) * 22) > 0.4) color.multiplyScalar(0.8); // ribbing
      return [color, 0.95];
    },
  });

  const geometry = mergeGeometries(parts);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, root, fingers, thumb, thumbBase, nozzle };
}

// Fingernails are flat plates, not round.
function flattenNail(geometry, length, radius) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const y = position.getY(i);
    if (z < 0 && y > length * 0.25) position.setZ(i, Math.max(z, -radius * 0.62));
  }
}

const euler = new THREE.Euler(0, 0, 0, 'ZXY');
const quaternion = new THREE.Quaternion();

function applyPose(hand, p) {
  FINGERS.forEach((finger, f) => {
    const [b0, b1, b2] = hand.fingers[f];
    b0.rotation.set(p[f * 3], 0, -finger.splay * p[SPREAD]);
    b1.rotation.x = p[f * 3 + 1];
    b2.rotation.x = p[f * 3 + 2];
  });
  euler.set(p[THUMB_AT + 1], 0, p[THUMB_AT]);
  hand.thumb[0].quaternion.copy(hand.thumbBase).multiply(quaternion.setFromEuler(euler));
  hand.thumb[1].rotation.x = p[THUMB_AT + 2];
  hand.thumb[2].rotation.x = p[THUMB_AT + 3];
}

// --- Hands in the game -------------------------------------------------------------------

// Desktop "grip" orientation: roll around the arm, tip the arm, then turn it inward.
function desktopTurn(pitch, roll, yaw) {
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, roll, 0));
  return turn.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
}

export function createHands({ renderer, rig, camera, input }) {
  const material = createHumanMaterial();
  const puffMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
  const puffGeometry = new THREE.SphereGeometry(1, 10, 8);

  const hands = {};
  for (const side of SIDES) {
    const built = buildHand(material);
    const mirror = new THREE.Group(); // the left hand is the right one, mirrored
    mirror.scale.x = side === 'left' ? -1 : 1;
    mirror.add(built.mesh);
    const holder = new THREE.Group(); // places the wrist in the grip (or the desktop "grip")
    holder.add(mirror);
    holder.visible = false;

    const puff = new THREE.Mesh(puffGeometry, puffMaterial.clone());
    puff.visible = false;
    built.nozzle.add(puff);

    // On desktop the hands hang at the bottom of the screen, as if holding controllers:
    // this group plays the part of the controller's grip space.
    const desktop = new THREE.Group();
    const mirrored = side === 'left' ? -1 : 1;
    desktop.userData.rest = new THREE.Vector3(0.17 * mirrored, -0.23, -0.38);
    // arm back and down, back of the hand up; for a punch the knuckles turn to the front
    desktop.userData.restQuaternion = desktopTurn(1.8, 1.25 * mirrored, -0.25 * mirrored);
    desktop.userData.punchQuaternion = desktopTurn(2.05, 1.5 * mirrored, -0.35 * mirrored);
    camera.add(desktop);

    // The same wrist placement works for a real controller grip and the desktop one.
    holder.position.copy(GRIP_OFFSET);
    if (side === 'left') holder.position.x *= -1;
    holder.quaternion.setFromRotationMatrix(GRIP_BASIS[side]);

    hands[side] = {
      ...built,
      holder,
      desktop,
      puff,
      puffTime: 1,
      punchTime: 1,
      grip: null,
      current: Float32Array.from(POSES.relaxed),
      target: new Float32Array(POSES.relaxed.length),
    };
  }

  // In VR the hands ride on the controllers' grip spaces.
  for (let i = 0; i < 2; i++) {
    const grip = renderer.xr.getControllerGrip(i);
    rig.add(grip);
    grip.addEventListener('connected', (e) => {
      const hand = hands[e.data.handedness];
      if (!hand || e.data.hand) return; // hand tracking without controllers isn't supported
      hand.grip = grip;
      grip.add(hand.holder);
    });
    grip.addEventListener('disconnected', () => {
      for (const side of SIDES) {
        if (hands[side].grip !== grip) continue;
        hands[side].grip = null;
        grip.remove(hands[side].holder);
      }
    });
  }

  let nextPunch = 'right';

  // Works out where each finger should be from the buttons, then eases toward it.
  function updatePose(hand, buttons, dt) {
    const { target, current } = hand;
    target.set(POSES.relaxed);
    const grip = buttons.gripValue;
    const thwip = smoothstep(buttons.triggerValue, 0.15, 0.7);
    for (let i = 3; i < 12; i++) target[i] = lerp(POSES.relaxed[i], POSES.fist[i], grip);
    for (let i = 0; i < 3; i++) target[i] = lerp(POINT[i], lerp(POSES.relaxed[i], POSES.fist[i], grip * 0.8), buttons.indexTouched ? 1 : 0);
    target[SPREAD] = lerp(1, POSES.fist[SPREAD], grip);
    for (let i = 0; i < 4; i++) {
      const down = lerp(THUMB_REST[i], POSES.fist[THUMB_AT + i], grip);
      target[THUMB_AT + i] = lerp(THUMB_UP[i], down, buttons.thumbTouched ? 1 : 0);
    }
    if (hand.punchTime < 1) {
      const fist = Math.sin(Math.min(1, hand.punchTime * 1.4) * Math.PI) > 0 ? 1 : 0;
      for (let i = 0; i < target.length; i++) target[i] = lerp(target[i], POSES.fist[i], fist);
    }
    for (let i = 0; i < target.length; i++) target[i] = lerp(target[i], POSES.thwip[i], thwip);

    const k = 1 - Math.exp(-dt * 22);
    for (let i = 0; i < target.length; i++) current[i] += (target[i] - current[i]) * k;
    applyPose(hand, current);
  }

  function update(dt, showOnDesktop) {
    const vr = renderer.xr.isPresenting;
    for (const side of SIDES) {
      const hand = hands[side];
      const buttons = input.hands[side];

      if (vr) {
        hand.holder.visible = !!hand.grip;
      } else {
        if (hand.holder.parent !== hand.desktop) hand.desktop.add(hand.holder);
        hand.holder.visible = showOnDesktop;

        // A punch is a quick jab forward and back.
        hand.punchTime = Math.min(1, hand.punchTime + dt / 0.24);
        const jab = Math.sin(hand.punchTime * Math.PI);
        hand.desktop.position.copy(hand.desktop.userData.rest);
        hand.desktop.position.x *= 1 - jab * 0.6;
        hand.desktop.position.y += jab * 0.08;
        hand.desktop.position.z -= jab * 0.22;
        hand.desktop.quaternion.slerpQuaternions(hand.desktop.userData.restQuaternion, hand.desktop.userData.punchQuaternion, Math.min(1, jab * 1.6));
        // Shooting a web flicks the wrist up a little.
        hand.desktop.position.y += Math.max(0, 1 - hand.puffTime * 4) * 0.015;
      }
      if (vr && hand.holder.parent === hand.desktop) hand.desktop.remove(hand.holder);
      if (vr && hand.grip && hand.holder.parent !== hand.grip) hand.grip.add(hand.holder);

      updatePose(hand, buttons, dt);

      hand.puffTime += dt;
      const t = hand.puffTime / 0.18;
      hand.puff.visible = t < 1;
      if (hand.puff.visible) {
        hand.puff.position.set(0, 0.012 + t * 0.05, 0.004);
        hand.puff.scale.setScalar(0.006 + t * 0.018);
        hand.puff.material.opacity = 0.9 * (1 - t);
      }
    }
  }

  // Where a web starts: the shooter on the wrist. False when that hand isn't showing.
  function getWebStart(side, out) {
    const hand = hands[side];
    if (!hand.holder.visible || !hand.holder.parent) return false;
    hand.nozzle.getWorldPosition(out);
    return true;
  }

  return {
    update,
    getWebStart,
    // A little white puff from the web shooter.
    shoot(side) {
      hands[side].puffTime = 0;
    },
    // Desktop: the hands take turns punching.
    punch() {
      nextPunch = nextPunch === 'right' ? 'left' : 'right';
      hands[nextPunch].punchTime = 0;
      return nextPunch;
    },
    hands,
    poses: POSES,
  };
}
