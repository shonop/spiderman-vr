import * as THREE from 'three';
import { createPose, copyPose, lerpPose, lookAt } from './human.js';

// Fighting animations for the thugs: a boxing guard, punches and a kick that aim at the
// player's head, flinching when hit, and falling over when knocked out. All poses are in the
// thug's own space (facing +z, in units of its height), see human.js.

const { clamp, smoothstep } = THREE.MathUtils;
const easeInOut = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) * (1 - k);

// Orthodox stance: left foot and left fist forward, body turned a little sideways.
export function guardPose(pose, time, step = 0) {
  const weave = Math.sin(time * 1.9);
  const bounce = Math.sin(time * 7.5);
  copyPose(pose, BASE);
  pose.hips.x = weave * 0.025;
  pose.hips.y = 0.875 + bounce * 0.01;
  pose.chest.z = -weave * 0.04;
  pose.head.z = weave * 0.05;

  const [lead, rear] = pose.legs;
  // Shuffling forward: little alternating steps.
  if (step) {
    const k = Math.sin(time * 9);
    lead.z += Math.max(0, k) * 0.1 * step;
    lead.y += Math.max(0, k) * 0.05 * step;
    rear.z += Math.max(0, -k) * 0.1 * step;
    rear.y += Math.max(0, -k) * 0.04 * step;
  }
  for (const arm of pose.arms) arm.y += bounce * 0.008;
  pose.arms[0].x += weave * 0.02;
  return pose;
}

const BASE = (() => {
  const pose = createPose();
  Object.assign(pose.hips, { x: 0, y: 0.875, z: -0.02 });
  Object.assign(pose.hipsTurn, { x: 0, y: -0.45, z: 0 });
  Object.assign(pose.spine, { x: 0.12, y: -0.05, z: 0 });
  Object.assign(pose.chest, { x: 0.06, y: -0.1, z: 0 });
  Object.assign(pose.neck, { x: -0.05, y: 0.25, z: 0 });
  Object.assign(pose.head, { x: -0.06, y: 0.3, z: 0 });
  Object.assign(pose.legs[0], { x: 0.11, y: 0.07, z: 0.2, px: 0.25, py: 0, pz: 1, pitch: 0, yaw: -0.15 });
  Object.assign(pose.legs[1], { x: -0.15, y: 0.11, z: -0.2, px: -0.15, py: 0, pz: 1, pitch: 0.35, yaw: -0.75 });
  Object.assign(pose.arms[0], { x: 0.09, y: 1.47, z: 0.42, px: 0.25, py: -1, pz: 0.05, twist: 0.6, bend: 0.1 });
  Object.assign(pose.arms[1], { x: -0.05, y: 1.5, z: 0.2, px: -0.3, py: -1, pz: 0.05, twist: 0.7, bend: 0.1 });
  return pose;
})();

// Puts a fist on the aim point (the player's face), stopping `short` before it.
const shoulder = new THREE.Vector3();
const toAim = new THREE.Vector3();
function reach(arm, aim, s, short = 0.06) {
  shoulder.set(s * 0.15, 1.36, 0.02);
  toAim.set(aim.x, aim.y, aim.z).sub(shoulder);
  const d = toAim.length();
  toAim.multiplyScalar(Math.max(0, d - short) / (d || 1)).add(shoulder);
  arm.x = toAim.x;
  arm.y = toAim.y;
  arm.z = toAim.z;
}

// Each move: how long each part takes, what it does, and the poses it goes through.
// cock = loading up the punch, extend = the moment of impact.
export const MOVES = {
  jab: {
    windup: 0.32,
    strike: 0.11,
    hold: 0.07,
    recover: 0.28,
    damage: 5,
    range: 1.55,
    cock(p) {
      p.arms[0].z -= 0.06;
      p.arms[0].y -= 0.02;
      p.hipsTurn.y -= 0.05;
      p.hips.y -= 0.01;
    },
    extend(p, aim) {
      reach(p.arms[0], aim, 1);
      Object.assign(p.arms[0], { px: 0.7, py: -0.6, pz: 0, twist: 1.3, bend: 0 });
      p.hipsTurn.y -= 0.12;
      p.chest.y -= 0.12;
      p.spine.x += 0.06;
      p.hips.z += 0.15;
      p.legs[0].z += 0.12;
    },
  },
  cross: {
    windup: 0.45,
    strike: 0.13,
    hold: 0.09,
    recover: 0.38,
    damage: 9,
    range: 1.6,
    cock(p) {
      p.hipsTurn.y -= 0.15;
      p.chest.y -= 0.12;
      p.arms[1].z -= 0.06;
      p.arms[1].x -= 0.03;
      p.hips.y -= 0.02;
    },
    extend(p, aim) {
      reach(p.arms[1], aim, -1);
      Object.assign(p.arms[1], { px: -0.7, py: -0.6, pz: 0, twist: 1.4, bend: 0 });
      p.hipsTurn.y += 0.55;
      p.chest.y += 0.3;
      p.spine.x += 0.1;
      p.hips.z += 0.2;
      p.legs[0].z += 0.1;
      Object.assign(p.legs[1], { pitch: 0.8, yaw: -0.15, y: 0.14 }); // pivot on the back toe
      p.arms[0].z -= 0.12; // lead hand comes back to the chin
      p.arms[0].x -= 0.04;
    },
  },
  hook: {
    windup: 0.45,
    strike: 0.16,
    hold: 0.08,
    recover: 0.4,
    damage: 10,
    range: 1.45,
    arc: [0.28, 0.02, -0.02],
    cock(p) {
      p.hipsTurn.y += 0.25;
      p.chest.y += 0.15;
      p.hips.y -= 0.03;
      Object.assign(p.arms[0], { x: 0.27, y: 1.42, z: 0.28, px: 1, py: 0.2, pz: -0.3, twist: 0.3 });
    },
    extend(p, aim) {
      reach(p.arms[0], aim, 1, 0.08);
      Object.assign(p.arms[0], { px: 1, py: 0.45, pz: 0.1, twist: 0.1, bend: 0 });
      p.hipsTurn.y -= 0.35;
      p.chest.y -= 0.4;
      p.hips.z += 0.15;
      p.hips.x -= 0.03;
      Object.assign(p.legs[0], { yaw: -0.6, pitch: 0.25, y: 0.09 }); // pivot on the front foot
    },
  },
  uppercut: {
    windup: 0.5,
    strike: 0.15,
    hold: 0.1,
    recover: 0.42,
    damage: 11,
    range: 1.4,
    arc: [0, -0.12, 0.08],
    cock(p) {
      p.hips.y -= 0.07;
      p.hipsTurn.y -= 0.1;
      p.spine.x += 0.12;
      Object.assign(p.arms[1], { x: -0.12, y: 1.12, z: 0.2, px: -0.4, py: -1, pz: -0.3, twist: -0.3 });
    },
    extend(p, aim) {
      // An uppercut lands short and from below: elbow bent, fist rising under the chin.
      reach(p.arms[1], { x: aim.x, y: aim.y - 0.1, z: aim.z }, -1, 0.3);
      Object.assign(p.arms[1], { px: -0.1, py: -1, pz: 0.3, twist: -0.5, bend: -0.3 });
      p.hips.y += 0.03;
      p.hipsTurn.y += 0.45;
      p.chest.y += 0.25;
      p.spine.x -= 0.08;
      p.chest.x -= 0.1;
      p.hips.z += 0.35;
      p.legs[0].z += 0.2;
      Object.assign(p.legs[1], { pitch: 0.7, y: 0.14 });
    },
  },
  kick: {
    windup: 0.5,
    strike: 0.16,
    hold: 0.12,
    recover: 0.45,
    damage: 8,
    range: 1.7,
    cock(p) {
      Object.assign(p.legs[1], { x: -0.08, y: 0.5, z: 0.18, px: 0, py: 0.4, pz: 1, pitch: -0.3, yaw: -0.1 });
      p.hips.z -= 0.05;
      p.hips.y += 0.02;
      p.hipsTurn.y += 0.2;
      p.spine.x -= 0.12;
      p.arms[1].z -= 0.08;
    },
    extend(p, aim) {
      const z = clamp(aim.z - 0.25, 0.45, 0.75);
      Object.assign(p.legs[1], { x: -0.04, y: 0.78, z, px: 0, py: 1, pz: 0.3, pitch: -0.7, yaw: 0 });
      p.hips.z -= 0.1;
      p.hips.y += 0.03;
      p.hipsTurn.y += 0.25;
      p.spine.x -= 0.3;
      Object.assign(p.legs[0], { yaw: -0.4 });
      Object.assign(p.arms[1], { x: -0.2, y: 1.15, z: -0.1, px: -0.6, py: -1, pz: 0 }); // swung back for balance
    },
  },
};
export const MOVE_NAMES = Object.keys(MOVES);
export const attackLength = (move) => move.windup + move.strike + move.hold + move.recover;

const guard = createPose();
const cocked = createPose();
const extended = createPose();

// The attack animation `t` seconds after it began. Returns 'windup' | 'strike' | 'hold' | 'recover' | 'done'.
// `blend` (0..1) starts the windup from wherever the previous combo punch left off.
export function attackPose(pose, move, t, time, aim) {
  guardPose(guard, time);
  copyPose(cocked, guard);
  move.cock(cocked);
  copyPose(extended, guard);
  move.extend(extended, aim);

  const { windup, strike, hold, recover } = move;
  if (t < windup) {
    lerpPose(pose, guard, cocked, easeInOut(t / windup));
    return 'windup';
  }
  t -= windup;
  if (t < strike) {
    const k = t / strike;
    lerpPose(pose, cocked, extended, easeOut(k));
    if (move.arc) {
      const side = move === MOVES.uppercut ? -1 : 1;
      const arm = pose.arms[move === MOVES.hook ? 0 : 1];
      const bulge = Math.sin(Math.PI * k);
      arm.x += move.arc[0] * side * bulge;
      arm.y += move.arc[1] * bulge;
      arm.z += move.arc[2] * bulge;
    }
    return 'strike';
  }
  t -= strike;
  if (t < hold) {
    copyPose(pose, extended);
    return 'hold';
  }
  t -= hold;
  if (t < recover) {
    lerpPose(pose, extended, guard, easeInOut(t / recover));
    return 'recover';
  }
  copyPose(pose, guard);
  return 'done';
}

// Flinching from a hit, layered on top of the guard. `since` = seconds since the hit,
// `low` = hit in the stomach, `side` = +1 if the blow came from the thug's left.
export function hitPose(pose, time, since, low, side) {
  guardPose(pose, time);
  const e = since < 0.07 ? since / 0.07 : Math.exp(-(since - 0.07) * 6);
  if (low) {
    // Doubled over, hands to the stomach.
    pose.spine.x += 0.45 * e;
    pose.chest.x += 0.25 * e;
    pose.head.x -= 0.15 * e;
    pose.hips.z -= 0.12 * e;
    pose.hips.y -= 0.06 * e;
    for (const [i, arm] of pose.arms.entries()) {
      const s = i ? -1 : 1;
      arm.x += (s * 0.08 - arm.x) * e;
      arm.y += (1.0 - arm.y) * e;
      arm.z += (0.22 - arm.z) * e;
    }
  } else {
    // Head snaps back and to the side, arms fly out.
    pose.head.y += side * 0.55 * e;
    pose.head.x -= 0.35 * e;
    pose.neck.x -= 0.2 * e;
    pose.spine.x -= 0.25 * e;
    pose.chest.y += side * 0.25 * e;
    pose.hips.z -= 0.08 * e;
    for (const [i, arm] of pose.arms.entries()) {
      const s = i ? -1 : 1;
      arm.x += s * 0.14 * e;
      arm.y -= 0.18 * e;
      arm.z -= 0.12 * e;
    }
  }
  // Stagger: the back foot catches the weight.
  pose.legs[1].z -= 0.12 * e;
  pose.legs[1].pitch -= 0.3 * e;
  return pose;
}

// Knocked out: snaps back, knees buckle, falls flat on the back and lies there.
// `tau` = seconds since the knockout punch, `side` turns the head.
export function knockoutPose(pose, time, tau, side) {
  hitPose(pose, time, Math.min(tau, 0.2), false, side);
  const f = clamp((tau - 0.2) / 0.6, 0, 1);
  const lying = smoothstep(f, 0.4, 1);
  pose.tilt = (Math.PI / 2) * f * f;
  pose.lift = 0.11 * f * f;
  if (tau > 0.8) pose.lift += 0.05 * Math.exp(-(tau - 0.8) * 7) * Math.abs(Math.sin((tau - 0.8) * 16));
  pose.hips.y -= 0.16 * Math.sin(Math.PI * f) * (1 - lying);

  // Blend toward the lying pose.
  copyPose(guard, LYING);
  guard.head.y = side * 0.75;
  lerpPose(pose, pose, guard, lying);
  pose.tilt = (Math.PI / 2) * f * f;
  return pose;
}

const LYING = (() => {
  const pose = createPose();
  Object.assign(pose.hips, { x: 0, y: 0.93, z: 0 });
  Object.assign(pose.spine, { x: -0.05, y: 0, z: 0.05 });
  Object.assign(pose.head, { x: -0.15, y: 0, z: 0 });
  Object.assign(pose.arms[0], { x: 0.42, y: 1.18, z: -0.09, px: 0.3, py: 0, pz: 1, twist: -0.5 });
  Object.assign(pose.arms[1], { x: -0.5, y: 1.3, z: -0.09, px: -0.3, py: 1, pz: 0.5, twist: -0.8 });
  Object.assign(pose.legs[0], { x: 0.16, y: 0.4, z: -0.06, px: 0.2, py: 0, pz: 1, pitch: 0.3, yaw: 0.2 });
  Object.assign(pose.legs[1], { x: -0.16, y: 0.07, z: -0.04, px: -0.3, py: 0, pz: 1, pitch: 0.5, yaw: -0.5 });
  return pose;
})();

export { lookAt };
