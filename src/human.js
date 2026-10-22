import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A detailed person with a real skeleton: one skinned mesh per person, with bent elbows and
// knees, a shaped body, a face and clothes. Used for the thugs and for pedestrians close to
// the player (far away pedestrians are the cheap instanced figures from people.js).
//
// The body is built standing at the origin facing +z, feet on the ground, arms hanging down.
// Its left side is +x. Arms and legs are posed with two-bone IK: a pose says where the hands
// and feet should be, and which way the elbows and knees point.

const { lerp, smoothstep, clamp } = THREE.MathUtils;

export const UPPER_ARM = 0.29;
export const FOREARM = 0.25;
export const THIGH = 0.43;
export const SHIN = 0.41;
export const STAND_HEIGHT = 0.945; // hips height when standing (feet on the ground, knees almost straight)

// name, parent, offset from the parent
const SKELETON = [
  ['hips', -1, 0, 0.95, 0],
  ['spine', 0, 0, 0.11, 0],
  ['chest', 1, 0, 0.18, 0],
  ['neck', 2, 0, 0.24, 0],
  ['head', 3, 0, 0.1, 0],
  ['upperArmL', 2, 0.19, 0.19, -0.01],
  ['forearmL', 5, 0, -UPPER_ARM, 0],
  ['handL', 6, 0, -FOREARM, 0],
  ['upperArmR', 2, -0.19, 0.19, -0.01],
  ['forearmR', 8, 0, -UPPER_ARM, 0],
  ['handR', 9, 0, -FOREARM, 0],
  ['thighL', 0, 0.095, -0.04, 0],
  ['shinL', 11, 0, -THIGH, 0],
  ['footL', 12, 0, -SHIN, 0],
  ['thighR', 0, -0.095, -0.04, 0],
  ['shinR', 14, 0, -THIGH, 0],
  ['footR', 15, 0, -SHIN, 0],
];
const BONE = Object.fromEntries(SKELETON.map(([name], i) => [name, i]));
const SIDE = ['L', 'R'];

const ROUGH = { skin: 0.52, cloth: 0.92, denim: 0.82, shoe: 0.5, sole: 0.8, hair: 0.62, eye: 0.15, lip: 0.4 };

// --- Body geometry -------------------------------------------------------------------------

// Weights that blend from bone to bone up the body. stops: [[y, bone], ...] from low to high.
function along(y, stops) {
  if (y <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [y1, bone1] = stops[i];
    if (y > y1) continue;
    const [y0, bone0] = stops[i - 1];
    if (bone0 === bone1) return bone0;
    const t = smoothstep(y, y0, y1);
    return [
      [bone0, 1 - t],
      [bone1, t],
    ];
  }
  return stops[stops.length - 1][1];
}

// Linear interpolation of a profile ([y, ...numbers] rows sorted by y in either direction).
function profileAt(sections, y) {
  const up = sections[0][0] < sections[sections.length - 1][0];
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1];
    const b = sections[i];
    const inside = up ? y <= b[0] : y >= b[0];
    if (!inside && i < sections.length - 1) continue;
    const t = clamp((y - a[0]) / (b[0] - a[0] || 1), 0, 1);
    return a.map((value, k) => lerp(value, b[k] ?? value, t));
  }
  return sections[sections.length - 1];
}

// Adds a thicker layer of cloth to a limb profile above (or below) `edge`, with a crisp hem.
function hem(sections, edge, thick, clothAbove = true) {
  const out = [];
  const covered = (y) => (clothAbove ? y > edge : y < edge);
  const grow = (row) => row.map((value, k) => (k >= 1 && k <= 3 && value > 0 ? value + thick : value));
  const step = clothAbove ? 0.004 : -0.004;
  let inserted = false;
  const descending = sections[0][0] > sections[sections.length - 1][0];
  for (const row of sections) {
    const passed = descending ? row[0] < edge : row[0] > edge;
    if (passed && !inserted) {
      inserted = true;
      const [first, second] = descending ? [edge + Math.abs(step), edge - Math.abs(step)] : [edge - Math.abs(step), edge + Math.abs(step)];
      for (const y of [first, second]) {
        const row2 = profileAt(sections, y);
        row2[0] = y;
        out.push(covered(y) ? grow(row2) : row2);
      }
    }
    out.push(covered(row[0]) ? grow(row) : row);
  }
  return out;
}

function createBuilder() {
  const parts = [];
  const point = new THREE.Vector3();
  const info = { u: 0, v: 0, j: 0 };
  const normal = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  // Fills in colors (alpha = roughness) and skin weights from callbacks.
  function finish(geometry, paint, weigh) {
    geometry.deleteAttribute('uv');
    const position = geometry.attributes.position;
    const ring = geometry.userData.ring;
    delete geometry.userData.ring;
    const n = position.count;
    const colors = new Float32Array(n * 4);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      point.fromBufferAttribute(position, i);
      if (ring) [info.u, info.v, info.j] = [ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2]];
      const [color, rough] = typeof paint === 'function' ? paint(point, info) : paint;
      colors[i * 4] = color.r;
      colors[i * 4 + 1] = color.g;
      colors[i * 4 + 2] = color.b;
      colors[i * 4 + 3] = rough;
      let weights = typeof weigh === 'function' ? weigh(point, info) : weigh;
      if (typeof weights === 'string') weights = [[weights, 1]];
      weights.forEach(([bone, weight], k) => {
        if (BONE[bone] === undefined) throw new Error(`No bone ${bone}`);
        skinIndex[i * 4 + k] = BONE[bone];
        skinWeight[i * 4 + k] = weight;
      });
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    parts.push(geometry);
  }

  // A surface made of rings. place(i, j, out, info) puts vertex j of ring i.
  function grid(rings, segments, closed, place, { paint, weigh, inward = false, displace }) {
    const columns = closed ? segments : segments + 1;
    const positions = new Float32Array(rings * columns * 3);
    const ringInfo = new Float32Array(rings * columns * 3);
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < columns; j++) {
        const k = i * columns + j;
        info.j = j;
        place(i, j, point, info);
        if (displace) displace(point, info);
        point.toArray(positions, k * 3);
        ringInfo[k * 3] = info.u;
        ringInfo[k * 3 + 1] = info.v;
        ringInfo[k * 3 + 2] = j;
      }
    }
    const index = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const j2 = closed ? (j + 1) % segments : j + 1;
        const a = i * columns + j;
        const b = i * columns + j2;
        const c = (i + 1) * columns + j;
        const d = (i + 1) * columns + j2;
        index.push(a, c, b, b, c, d);
      }
    }
    // Turn the triangles to face outward (or inward), whichever way the rings were laid out.
    const center = new THREE.Vector3();
    for (let k = 0; k < positions.length; k += 3) center.x += positions[k];
    for (let k = 1; k < positions.length; k += 3) center.y += positions[k];
    for (let k = 2; k < positions.length; k += 3) center.z += positions[k];
    center.divideScalar(rings * columns);
    let outward = 0;
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < index.length; t += 3) {
      for (let k = 0; k < 3; k++) p[k].fromArray(positions, index[t + k] * 3);
      normal.crossVectors(e1.subVectors(p[1], p[0]), e2.subVectors(p[2], p[0]));
      outward += normal.dot(p[0].add(p[1]).add(p[2]).divideScalar(3).sub(center));
    }
    if (outward < 0 !== inward) {
      for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.userData.ring = ringInfo;
    finish(geometry, paint, weigh);
  }

  // Rings stacked along y (or z): each section is [position, rx, front, back, cx, cy].
  // front/back are the radius toward +z/-z (toward +y/-y for axis 'z').
  function loft(sections, segments, options) {
    const alongZ = options.axis === 'z';
    grid(
      sections.length,
      segments,
      true,
      (i, j, out, ringInfo) => {
        const [s, rx, front = rx, back = front, cx = 0, cy = 0] = sections[i];
        const angle = (j / segments) * Math.PI * 2;
        ringInfo.u = Math.sin(angle);
        ringInfo.v = Math.cos(angle);
        const r = ringInfo.v > 0 ? front : back;
        if (alongZ) out.set(cx + rx * ringInfo.u, cy + r * ringInfo.v, s);
        else out.set(cx + rx * ringInfo.u, s, cy + r * ringInfo.v);
      },
      options,
    );
  }

  function solid(geometry, paint, weigh) {
    finish(geometry, paint, weigh);
  }

  return { grid, loft, solid, build: () => mergeGeometries(parts) };
}

// Body profiles: [y, rx, front, back] (+ cx, cz for the head).
const TORSO = [
  [0.815, 0, 0, 0],
  [0.83, 0.1, 0.07, 0.08],
  [0.88, 0.155, 0.095, 0.11],
  [0.94, 0.172, 0.105, 0.122],
  [0.975, 0.168, 0.1, 0.11],
  [1.0, 0.166, 0.1, 0.104],
  [1.08, 0.152, 0.1, 0.092],
  [1.17, 0.162, 0.11, 0.095],
  [1.27, 0.178, 0.122, 0.1],
  [1.35, 0.185, 0.118, 0.1],
  [1.41, 0.182, 0.095, 0.09],
  [1.44, 0.16, 0.08, 0.08],
  [1.465, 0.115, 0.065, 0.07],
  [1.49, 0.07, 0.055, 0.06],
  [1.5, 0, 0, 0],
];
const NECK = [
  [1.45, 0.058, 0.05, 0.056, 0, -0.005],
  [1.52, 0.05, 0.047, 0.05, 0, 0],
  [1.58, 0.048, 0.046, 0.05, 0, 0.005],
  [1.615, 0.045, 0.04, 0.045, 0, 0.01],
];
const HEAD = [
  [1.556, 0, 0, 0, 0, 0.03],
  [1.565, 0.03, 0.03, 0.03, 0, 0.035],
  [1.58, 0.052, 0.065, 0.045, 0, 0.02],
  [1.61, 0.068, 0.08, 0.07, 0, 0.01],
  [1.645, 0.075, 0.088, 0.085, 0, 0.005],
  [1.68, 0.078, 0.09, 0.095, 0, 0],
  [1.715, 0.08, 0.087, 0.1, 0, -0.005],
  [1.75, 0.072, 0.07, 0.09, 0, -0.01],
  [1.775, 0.05, 0.05, 0.065, 0, -0.015],
  [1.79, 0, 0, 0, 0, -0.015],
];
const HEAD_CENTER = new THREE.Vector3(0, 1.68, 0);
const ARM = [
  [1.478, 0],
  [1.47, 0.03],
  [1.452, 0.05],
  [1.42, 0.058],
  [1.37, 0.056],
  [1.28, 0.052, 0.054, 0.05],
  [1.2, 0.046],
  [1.14, 0.042, 0.042, 0.044],
  [1.08, 0.045],
  [0.99, 0.038, 0.036, 0.038],
  [0.93, 0.033, 0.031, 0.032],
  [0.9, 0.031, 0.03, 0.03],
  [0.885, 0],
];
const HAND = [
  [0.905, 0.026, 0.03, 0.03],
  [0.88, 0.028, 0.042, 0.04],
  [0.84, 0.031, 0.046, 0.042],
  [0.81, 0.032, 0.045, 0.04],
  [0.785, 0.03, 0.04, 0.035],
  [0.77, 0.02, 0.025, 0.022],
  [0.762, 0, 0, 0],
];
const LEG = [
  [1.0, 0.09, 0.085, 0.095],
  [0.92, 0.092, 0.088, 0.095],
  [0.84, 0.085, 0.083, 0.088],
  [0.74, 0.077, 0.076, 0.078],
  [0.62, 0.067, 0.067, 0.066],
  [0.52, 0.058, 0.06, 0.056],
  [0.48, 0.056, 0.058, 0.056],
  [0.42, 0.056, 0.053, 0.064],
  [0.33, 0.054, 0.05, 0.062],
  [0.22, 0.046, 0.045, 0.048],
  [0.14, 0.045, 0.044, 0.046],
  [0.1, 0.05, 0.05, 0.052],
  [0.085, 0.05, 0.05, 0.052],
  [0.08, 0, 0, 0],
];
// Shoe along z: [z, rx, up, down, cx, cy]
const SHOE = [
  [-0.075, 0, 0, 0, 0, 0.045],
  [-0.068, 0.03, 0.03, 0.035, 0, 0.045],
  [-0.045, 0.044, 0.045, 0.045, 0, 0.05],
  [0.0, 0.047, 0.055, 0.05, 0, 0.055],
  [0.05, 0.05, 0.045, 0.048, 0, 0.05],
  [0.1, 0.052, 0.035, 0.04, 0, 0.04],
  [0.15, 0.05, 0.028, 0.035, 0, 0.035],
  [0.185, 0.042, 0.022, 0.03, 0, 0.032],
  [0.205, 0.028, 0.016, 0.027, 0, 0.03],
  [0.215, 0, 0, 0, 0, 0.03],
];
// Hood worn up: [y, rx, front, back, cz], and how far the face opening reaches around (radians).
const HOOD = [
  [1.42, 0.15, 0.1, 0.1, -0.01],
  [1.48, 0.115, 0.095, 0.1, -0.01],
  [1.54, 0.097, 0.1, 0.108, -0.005],
  [1.6, 0.096, 0.106, 0.118, 0],
  [1.66, 0.1, 0.11, 0.122, -0.005],
  [1.72, 0.1, 0.1, 0.122, -0.01],
  [1.77, 0.086, 0.08, 0.106, -0.02],
  [1.81, 0.056, 0.05, 0.072, -0.03],
  [1.83, 0, 0, 0, -0.03],
];
const HOOD_OPENING = [
  [1.4, 0],
  [1.45, 0.5],
  [1.52, 0.8],
  [1.57, 1.05],
  [1.7, 1.05],
  [1.75, 0.6],
  [1.79, 0],
  [1.84, 0],
];

const color = (hex) => new THREE.Color(hex);
const shade = (c, k) => c.clone().multiplyScalar(k);

// style: { skin, eyes, hair, hairStyle: 'short' | 'long' | 'buzz' | 'bald' | 'beanie' | 'hood', hat,
//          top, topStyle: 'hoodie' | 'tshirt', pants, pantsStyle: 'jeans' | 'joggers' | 'shorts', stripe,
//          shoes, sole, mask, beard (0..1), build (width), belly }
export function buildHumanGeometry(style) {
  const b = createBuilder();
  const w = style.build ?? 1;
  const belly = style.belly ?? 0;
  const skin = color(style.skin);
  const hair = color(style.hair ?? '#1b1512');
  const top = color(style.top);
  const pants = color(style.pants);
  const shoes = color(style.shoes ?? '#e8e8e8');
  const sole = color(style.sole ?? '#f4f4f4');
  const mask = style.mask ? color(style.mask) : null;
  const hoodie = style.topStyle === 'hoodie';
  const hoodUp = style.hairStyle === 'hood';
  const rib = shade(top, 0.78);
  const lip = skin.clone().lerp(color('#9c4a44'), 0.35);
  const blush = skin.clone().lerp(color('#c0574f'), 0.12);
  const stubble = skin.clone().lerp(hair, style.beard ?? 0);
  const tmp = new THREE.Color();

  // Torso
  const torsoRows = TORSO.map(([y, rx, front, back]) => {
    const gut = belly * Math.max(0, 1 - Math.abs(y - 1.09) / 0.12);
    const hemBump = hoodie && y >= 0.97 && y <= 1.0 ? 0.008 : 0;
    return [y, rx * w + hemBump, front * w + gut + hemBump, back * w + hemBump];
  });
  b.loft(torsoRows, 20, {
    paint: (p, ring) => {
      if (p.y < 0.975) return [pants, ROUGH.denim];
      if (hoodie && p.y < 1.005) return [rib, ROUGH.cloth];
      if (hoodie && ring.v > 0.45 && p.y < 1.14 && Math.abs(p.x) < 0.11 * w) return [shade(top, 0.9), ROUGH.cloth];
      if (!hoodie && p.y > 1.46) return [rib, ROUGH.cloth];
      return [top, ROUGH.cloth];
    },
    weigh: (p) =>
      along(p.y, [
        [0.97, 'hips'],
        [1.1, 'spine'],
        [1.28, 'chest'],
      ]),
  });
  if (hoodie) {
    // Drawstrings
    for (const s of [-1, 1]) {
      b.solid(
        new THREE.CylinderGeometry(0.0035, 0.0035, 0.15, 5).rotateX(-0.12).translate(s * 0.032, 1.355, 0.118 * w + 0.004),
        [color('#d8d8d8'), ROUGH.cloth],
        'chest',
      );
    }
    if (!hoodUp) {
      // The hood lying on the back of the neck.
      b.solid(
        new THREE.TorusGeometry(0.085, 0.026, 6, 18).rotateX(Math.PI / 2).scale(1.15 * w, 1, 1).translate(0, 1.465, -0.012),
        [top, ROUGH.cloth],
        'chest',
      );
      b.solid(new THREE.SphereGeometry(0.1, 12, 8).scale(1.1 * w, 0.75, 0.42).translate(0, 1.43, -0.095), [top, ROUGH.cloth], 'chest');
    }
  }

  // Neck and head
  b.loft(NECK, 12, {
    paint: (p, ring) => (mask && p.y > 1.53 && ring.v > -0.1 ? [mask, ROUGH.cloth] : [skin, ROUGH.skin]),
    weigh: (p) =>
      along(p.y, [
        [1.45, 'chest'],
        [1.52, 'neck'],
        [1.57, 'neck'],
        [1.61, 'head'],
      ]),
  });
  const masked = (p, ring) => mask && p.y < 1.648 && ring.v > -0.2;
  b.loft(HEAD, 20, {
    displace: (p, ring) => {
      if (!masked(p, ring)) return;
      p.x += ring.u * 0.004;
      p.z += ring.v * 0.004;
    },
    paint: (p, ring) => {
      if (masked(p, ring)) return [mask, ROUGH.cloth];
      if (style.beard && p.y < 1.632 && ring.v > -0.35) return [stubble, ROUGH.hair];
      if (ring.v > 0.5 && Math.abs(ring.u) > 0.45 && p.y > 1.615 && p.y < 1.66) return [blush, ROUGH.skin];
      return [skin, ROUGH.skin];
    },
    weigh: 'head',
  });

  const face = (geometry, c, rough) => b.solid(geometry, [c, rough], 'head');
  for (const s of [-1, 1]) {
    face(new THREE.SphereGeometry(0.0125, 10, 8).translate(s * 0.033, 1.682, 0.074), color('#ece7de'), ROUGH.eye);
    face(new THREE.SphereGeometry(0.0068, 8, 6).scale(1, 1, 0.6).translate(s * 0.033, 1.682, 0.0855), color(style.eyes ?? '#3b2a1a'), ROUGH.eye);
    face(new THREE.BoxGeometry(0.03, 0.0065, 0.009).rotateZ(-s * 0.12).translate(s * 0.034, 1.703, 0.087), shade(hair, 0.9), ROUGH.hair);
    face(new THREE.SphereGeometry(0.026, 8, 6).scale(0.35, 1.2, 0.75).translate(s * 0.078, 1.668, -0.008), skin, ROUGH.skin);
  }
  // Brow ridge, so the eyes sit in a little shade.
  face(new THREE.CapsuleGeometry(0.011, 0.05, 2, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.8).translate(0, 1.698, 0.08), skin, ROUGH.skin);
  const noseColor = mask ? mask : skin;
  face(new THREE.SphereGeometry(0.016, 8, 8).scale(0.72, 2.1, 1).rotateX(-0.28).translate(0, 1.658, 0.088), noseColor, ROUGH.skin);
  face(new THREE.SphereGeometry(0.0135, 8, 6).translate(0, 1.637, mask ? 0.1 : 0.098), noseColor, ROUGH.skin);
  for (const s of [-1, 1]) face(new THREE.SphereGeometry(0.009, 6, 5).translate(s * 0.012, 1.634, 0.092), noseColor, ROUGH.skin);
  if (mask) {
    // Knotted bandana: the loose triangle hanging under the chin.
    face(new THREE.ConeGeometry(0.06, 0.07, 4).rotateY(Math.PI / 4).scale(1.1, 1, 0.3).rotateX(Math.PI).translate(0, 1.545, 0.072), mask, ROUGH.cloth);
  } else {
    face(new THREE.SphereGeometry(0.01, 8, 6).scale(2.3, 0.55, 0.8).translate(0, 1.613, 0.086), lip, ROUGH.lip);
    face(new THREE.SphereGeometry(0.01, 8, 6).scale(2.0, 0.65, 0.8).translate(0, 1.603, 0.084), lip, ROUGH.lip);
  }

  // Hair, hats and hoods
  const headPoint = (y, u, v, out) => {
    const [, rx, front, back, , cz] = profileAt(HEAD, y);
    return out.set(rx * u, y, cz + (v > 0 ? front : back) * v);
  };
  // A shell around the top of the head, from a hairline up to the crown.
  function cap({ front, sides, back, offset, rings = 8, paint, until = 1 }) {
    const segments = 24;
    b.grid(
      rings,
      segments,
      true,
      (i, j, out, ring) => {
        const angle = (j / segments) * Math.PI * 2;
        ring.u = Math.sin(angle);
        ring.v = Math.cos(angle);
        const line = ring.v > 0 ? lerp(sides, front, ring.v) : lerp(sides, back, -ring.v);
        const start = Math.asin(clamp((line - HEAD_CENTER.y) / 0.11, -1, 1));
        const polar = lerp(start, Math.PI / 2, (i / (rings - 1)) * until);
        headPoint(HEAD_CENTER.y + Math.sin(polar) * 0.11, ring.u, ring.v, out);
        const away = out.clone().sub(HEAD_CENTER);
        out.addScaledVector(away, offset / Math.max(away.length(), 0.01));
      },
      { paint, weigh: 'head' },
    );
  }
  const hairPaint = [hair, ROUGH.hair];
  switch (style.hairStyle) {
    case 'short':
      cap({ front: 1.722, sides: 1.672, back: 1.615, offset: 0.007, paint: hairPaint });
      break;
    case 'buzz':
      cap({ front: 1.718, sides: 1.668, back: 1.61, offset: 0.0035, paint: [skin.clone().lerp(hair, 0.65), ROUGH.hair] });
      break;
    case 'long':
      cap({ front: 1.728, sides: 1.6, back: 1.56, offset: 0.009, paint: hairPaint });
      b.solid(new THREE.SphereGeometry(0.1, 14, 10).scale(1.02, 1.75, 0.42).translate(0, 1.54, -0.072), hairPaint, 'head');
      break;
    case 'beanie': {
      const hat = color(style.hat ?? '#151515');
      const knit = (p, ring) => [Math.floor(ring.j / 1) % 2 ? hat : tmp.copy(hat).multiplyScalar(0.8), ROUGH.cloth];
      cap({ front: 1.722, sides: 1.69, back: 1.645, offset: 0.014, paint: knit });
      cap({ front: 1.722, sides: 1.69, back: 1.645, offset: 0.021, rings: 3, until: 0.22, paint: [shade(hat, 0.9), ROUGH.cloth] });
      break;
    }
    case 'hood': {
      const layer = (inset, inward, c) =>
        b.grid(
          HOOD.length,
          24,
          false,
          (i, j, out, ring) => {
            const [y, rx, front, back, cz] = HOOD[i];
            const open = profileAt(HOOD_OPENING, y)[1];
            const angle = open + (j / 24) * (Math.PI * 2 - open * 2);
            ring.u = Math.sin(angle);
            ring.v = Math.cos(angle);
            const r = ring.v > 0 ? front : back;
            out.set(Math.max(0, rx - inset) * ring.u, y, cz + Math.max(0, r - inset) * ring.v);
          },
          {
            inward,
            paint: [c, ROUGH.cloth],
            weigh: (p) =>
              along(p.y, [
                [1.47, 'chest'],
                [1.58, 'head'],
              ]),
          },
        );
      layer(0, false, top);
      layer(0.007, true, shade(top, 0.45));
      break;
    }
  }

  // Arms and hands
  const sleeveEnd = hoodie ? 0.915 : 1.245;
  const armRows = hem(
    ARM.map(([y, rx, front = rx, back = front]) => [y, rx * w, front * w, back * w]),
    sleeveEnd,
    hoodie ? 0.01 : 0.008,
  );
  for (const side of [0, 1]) {
    const s = side ? -1 : 1;
    const name = SIDE[side];
    const cx = s * 0.19;
    b.loft(
      armRows.map((row) => [...row.slice(0, 4), cx, 0]),
      12,
      {
        paint: (p) => {
          if (p.y < sleeveEnd) return [skin, ROUGH.skin];
          if (hoodie && p.y < 0.95) return [rib, ROUGH.cloth];
          return [top, ROUGH.cloth];
        },
        weigh: (p) =>
          along(p.y, [
            [0.87, `hand${name}`],
            [0.915, `forearm${name}`],
            [1.11, `forearm${name}`],
            [1.17, `upperArm${name}`],
          ]),
      },
    );
    b.loft(
      HAND.map(([y, rx, front, back]) => [y, rx, front, back, cx - s * 0.004, 0.004]),
      10,
      { paint: [skin, ROUGH.skin], weigh: `hand${name}` },
    );
    b.solid(new THREE.CapsuleGeometry(0.0125, 0.035, 2, 6).rotateX(0.5).translate(cx - s * 0.012, 0.848, 0.042), [skin, ROUGH.skin], `hand${name}`);
  }

  // Legs and shoes
  const shorts = style.pantsStyle === 'shorts';
  const legRows = shorts ? hem(LEG, 0.56, 0.014) : LEG;
  const stripe = style.stripe ? color(style.stripe) : null;
  for (const side of [0, 1]) {
    const s = side ? -1 : 1;
    const name = SIDE[side];
    const cx = s * 0.095;
    b.loft(
      legRows.map(([y, rx, front, back]) => [y, rx * (y > 0.6 ? w : 1), front, back, cx, 0]),
      14,
      {
        paint: (p, ring) => {
          if (shorts && p.y < 0.56) return [skin, ROUGH.skin];
          if (stripe && ring.u * s > 0.93) return [stripe, ROUGH.cloth];
          if (style.pantsStyle === 'jeans') {
            // Worn, lighter denim on the front of the thighs and the knees.
            const bump = (center, size) => Math.max(0, 1 - Math.abs(p.y - center) / size);
            const wear = Math.max(0, ring.v) * (bump(0.5, 0.07) * 0.6 + bump(0.74, 0.12) * 0.5);
            return [tmp.copy(pants).multiplyScalar(1 + wear * 0.45), ROUGH.denim];
          }
          return [pants, ROUGH.cloth];
        },
        weigh: (p) =>
          along(p.y, [
            [0.44, `shin${name}`],
            [0.52, `thigh${name}`],
            [0.86, `thigh${name}`],
            [0.99, 'hips'],
          ]),
      },
    );
    b.loft(
      SHOE.map(([z, rx, up, down, , cy]) => [z, rx, up, down, cx, cy]),
      14,
      {
        axis: 'z',
        paint: (p, ring) => {
          if (p.y < 0.018) return [sole, ROUGH.sole];
          if (ring.v > 0.7 && p.z > 0.02 && p.z < 0.11) return [tmp.copy(shoes).lerp(sole, 0.5), ROUGH.shoe];
          return [shoes, ROUGH.shoe];
        },
        weigh: `foot${name}`,
      },
    );
  }

  const geometry = b.build();
  geometry.computeBoundingSphere();
  return geometry;
}

// Skin and cloth in one material: roughness comes from the vertex color's alpha, and a soft
// sky-colored rim light keeps bodies readable against dark streets.
export function createHumanMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vColor.a;')
      .replace(
        '#include <opaque_fragment>',
        `float rim = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);
        outgoingLight += vec3(0.6, 0.7, 0.85) * rim * 0.22 * diffuseColor.rgb;
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'human';
  return material;
}

// --- Poses ---------------------------------------------------------------------------------

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const armPose = (s) => ({ x: s * 0.2, y: 0.9, z: 0.03, px: s * 0.3, py: 0, pz: -1, twist: 0, bend: 0, sx: 0, sy: 0, sz: 0 });
const legPose = (s) => ({ x: s * 0.1, y: 0.07, z: 0, px: s * 0.1, py: 0, pz: 1, pitch: 0, yaw: 0 });

// Everything a body needs for one frame. Positions are in the body's own space (facing +z).
export function createPose() {
  return {
    hips: vec(0, STAND_HEIGHT, 0),
    hipsTurn: vec(),
    spine: vec(),
    chest: vec(),
    neck: vec(),
    head: vec(),
    arms: [armPose(1), armPose(-1)],
    legs: [legPose(1), legPose(-1)],
    tilt: 0, // whole body tipping backward (falling over), around the feet
    lift: 0,
  };
}

export function restPose(pose) {
  Object.assign(pose.hips, vec(0, STAND_HEIGHT, 0));
  for (const key of ['hipsTurn', 'spine', 'chest', 'neck', 'head']) Object.assign(pose[key], vec());
  Object.assign(pose.arms[0], armPose(1));
  Object.assign(pose.arms[1], armPose(-1));
  Object.assign(pose.legs[0], legPose(1));
  Object.assign(pose.legs[1], legPose(-1));
  pose.tilt = 0;
  pose.lift = 0;
  return pose;
}

// out = a + (b - a) * t for every number in the pose (out may be a or b).
export function lerpPose(out, a, b, t) {
  for (const key in out) {
    const value = out[key];
    if (typeof value === 'number') out[key] = lerp(a[key], b[key], t);
    else lerpPose(value, a[key], b[key], t);
  }
  return out;
}

export function copyPose(out, from) {
  return lerpPose(out, from, from, 0);
}

// Turns the neck and head so the eyes look at a point in body space.
export function lookAt(pose, target, amount = 1) {
  const bodyYaw = pose.hipsTurn.y + pose.spine.y + pose.chest.y;
  const bodyPitch = pose.hipsTurn.x + pose.spine.x + pose.chest.x;
  const eyeY = pose.hips.y + 0.72;
  const yaw = clamp(Math.atan2(target.x - pose.hips.x, target.z - pose.hips.z) - bodyYaw, -1.3, 1.3) * amount;
  const pitch = clamp(Math.atan2(eyeY - target.y, Math.hypot(target.x, target.z)) - bodyPitch, -0.7, 0.7) * amount;
  pose.neck.y = yaw * 0.45;
  pose.head.y = yaw * 0.55;
  pose.neck.x = pitch * 0.4;
  pose.head.x = pitch * 0.6;
}

// Walking and running. One cycle (two steps) covers cycleLength(run) meters.
export const cycleLength = (run) => lerp(1.4, 2.4, run);

export function walkPose(pose, phase, run = 0) {
  restPose(pose);
  const stance = lerp(0.5, 0.38, run); // part of the cycle each foot is on the ground
  const travel = stance * cycleLength(run); // how far a planted foot slides back under the body
  const cycle = phase / (Math.PI * 2);
  let leftForward = 0;

  for (const side of [0, 1]) {
    const s = side ? -1 : 1;
    const leg = pose.legs[side];
    const u = (((cycle + side * 0.5) % 1) + 1) % 1;
    let z, y, pitch;
    if (u < stance) {
      const k = u / stance;
      z = travel / 2 - k * travel;
      pitch = smoothstep(k, 0.55, 1) * 0.55; // heel comes up before the foot leaves the ground
      y = 0.07 + Math.sin(pitch) * 0.12;
    } else {
      const k = (u - stance) / (1 - stance);
      z = -travel / 2 + travel * (1 - Math.cos(Math.PI * k)) * 0.5 - run * 0.12 * Math.sin(Math.PI * k);
      y = 0.07 + Math.sin(Math.PI * k) * lerp(0.1, 0.26, run) + run * 0.1 * Math.sin(Math.PI * Math.min(1, k * 1.6));
      pitch = 0.55 * (1 - k) * (1 - k) - 0.6 * k * (1 - k);
    }
    Object.assign(leg, { x: s * lerp(0.1, 0.085, run), y, z, pitch, px: s * 0.12, py: 0, pz: 1 });
    if (!side) leftForward = (2 * z) / travel;

    // Arms swing against the legs, elbows bend more when running.
    const arm = pose.arms[side];
    const swing = -(side ? -leftForward : leftForward);
    arm.x = s * lerp(0.205, 0.17, run);
    arm.y = lerp(0.93, 1.1, run) + Math.max(0, swing) * lerp(0.03, 0.12, run);
    arm.z = lerp(0.03, 0.08, run) + swing * lerp(0.15, 0.24, run);
    arm.px = s * 0.25;
    arm.py = -0.3;
    arm.pz = -1;
  }

  const bob = Math.cos(2 * (phase - Math.PI * stance));
  pose.hips.y = lerp(0.935, 0.895, run) + bob * lerp(0.016, -0.028, run);
  pose.hips.x = Math.sin(phase) * lerp(0.022, 0.01, run);
  pose.hipsTurn.y = -0.13 * leftForward;
  pose.hipsTurn.z = Math.sin(phase) * 0.035;
  pose.spine.x = lerp(0.03, 0.2, run);
  pose.chest.y = 0.2 * leftForward;
  pose.chest.x = lerp(0.0, 0.04, run);
  pose.chest.z = -pose.hipsTurn.z * 0.7;
  pose.head.x = -pose.spine.x * 0.8;
  pose.neck.y = -(pose.hipsTurn.y + pose.chest.y) * 0.5;
  pose.head.y = pose.neck.y;
  return pose;
}

// Standing around: weight shifting, breathing, looking about. `talk` waves the hands a bit.
export function standPose(pose, time, talk = 0) {
  restPose(pose);
  const sway = Math.sin(time * 0.55);
  pose.hips.x = sway * 0.018;
  pose.hips.y = STAND_HEIGHT - 0.008 - Math.abs(sway) * 0.006;
  pose.hipsTurn.z = -sway * 0.035;
  pose.chest.z = sway * 0.025;
  pose.chest.x = Math.sin(time * 1.7) * 0.012;
  pose.head.y = Math.sin(time * 0.31) * 0.35 + Math.sin(time * 0.83) * 0.08;
  pose.head.x = Math.sin(time * 0.47) * 0.06;
  for (const side of [0, 1]) {
    const s = side ? -1 : 1;
    Object.assign(pose.legs[side], { x: s * 0.11, yaw: s * 0.15, px: s * 0.25 });
    const arm = pose.arms[side];
    arm.x += pose.hips.x;
    const gesture = talk * Math.max(0, Math.sin(time * 1.3 + side * 2.4)) ** 3;
    arm.y += gesture * 0.25;
    arm.z += gesture * 0.25;
    arm.x -= s * gesture * 0.05;
    arm.twist = gesture * 0.8;
  }
  return pose;
}

// --- The person ----------------------------------------------------------------------------

const X_AXIS = new THREE.Vector3(1, 0, 0);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qSpine = new THREE.Quaternion();
const qChest = new THREE.Quaternion();
const qUpper = new THREE.Quaternion();
const qLower = new THREE.Quaternion();
const qInverse = new THREE.Quaternion();
const qTarget = new THREE.Quaternion();
const pSpine = new THREE.Vector3();
const pChest = new THREE.Vector3();
const joint = new THREE.Vector3();
const target = new THREE.Vector3();
const pole = new THREE.Vector3();
const dir = new THREE.Vector3();
const bendAway = new THREE.Vector3();
const upper = new THREE.Vector3();
const lower = new THREE.Vector3();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();
const basis = new THREE.Matrix4();

// Two-bone IK in body space. Sets the local rotations of the upper and lower bone so the end
// of the limb reaches `target` with the middle joint bent toward `pole`. Arms bend forward
// (elbow points at the pole), legs backward (knee points at the pole). Leaves the lower
// bone's body-space rotation in qLower.
function solveLimb(root, a, b, parentRotation, isArm, upperBone, lowerBone) {
  dir.subVectors(target, root);
  let d = dir.length();
  if (d < 1e-5) dir.set(0, -1, 0);
  else dir.divideScalar(d);
  d = clamp(d, Math.abs(a - b) + 0.02, (a + b) * 0.9995);
  bendAway.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bendAway.lengthSq() < 1e-8) bendAway.set(0, 0, isArm ? -1 : 1).addScaledVector(dir, -dir.z);
  bendAway.normalize();
  const cos = (a * a + d * d - b * b) / (2 * a * d);
  upper.copy(dir).multiplyScalar(cos).addScaledVector(bendAway, Math.sqrt(Math.max(0, 1 - cos * cos)));
  lower.copy(dir).multiplyScalar(d).addScaledVector(upper, -a).normalize();

  yAxis.copy(upper).negate();
  zAxis.copy(lower).addScaledVector(upper, -lower.dot(upper));
  if (zAxis.lengthSq() < 1e-8) zAxis.copy(bendAway).negate();
  zAxis.normalize();
  if (!isArm) zAxis.negate();
  xAxis.crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis);
  qUpper.setFromRotationMatrix(basis.makeBasis(xAxis, yAxis, zAxis));
  upperBone.quaternion.copy(qInverse.copy(parentRotation).invert()).multiply(qUpper);

  lower.applyQuaternion(qInverse.copy(qUpper).invert());
  lowerBone.quaternion.setFromAxisAngle(X_AXIS, Math.atan2(-lower.z, -lower.y));
  qLower.multiplyQuaternions(qUpper, lowerBone.quaternion);
}

export function createHuman(style, material) {
  const bones = SKELETON.map(([name, , x, y, z]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    return bone;
  });
  SKELETON.forEach(([, parent], i) => parent >= 0 && bones[parent].add(bones[i]));

  const mesh = new THREE.SkinnedMesh(buildHumanGeometry(style), material);
  mesh.add(bones[0]);
  mesh.frustumCulled = false; // the pose moves the body far from its bind-pose bounds
  mesh.receiveShadow = true;
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const root = new THREE.Group();
  root.add(mesh);

  const setRotation = (bone, angles) => bone.quaternion.setFromEuler(euler.set(angles.x, angles.y, angles.z));

  function apply(pose) {
    const [hips, spine, chest, neck, head] = bones;
    hips.position.set(pose.hips.x, pose.hips.y, pose.hips.z);
    setRotation(hips, pose.hipsTurn);
    setRotation(spine, pose.spine);
    setRotation(chest, pose.chest);
    setRotation(neck, pose.neck);
    setRotation(head, pose.head);
    qSpine.multiplyQuaternions(hips.quaternion, spine.quaternion);
    qChest.multiplyQuaternions(qSpine, chest.quaternion);
    pSpine.copy(spine.position).applyQuaternion(hips.quaternion).add(hips.position);
    pChest.copy(chest.position).applyQuaternion(qSpine).add(pSpine);

    for (const side of [0, 1]) {
      const s = side ? -1 : 1;
      const arm = pose.arms[side];
      const [upperArm, forearm, hand] = bones.slice(5 + side * 3, 8 + side * 3);
      upperArm.position.set(s * (0.19 + arm.sx), 0.19 + arm.sy, -0.01 + arm.sz);
      joint.copy(upperArm.position).applyQuaternion(qChest).add(pChest);
      target.set(arm.x, arm.y, arm.z);
      pole.set(arm.px, arm.py, arm.pz);
      solveLimb(joint, UPPER_ARM, FOREARM, qChest, true, upperArm, forearm);
      // Turning the palm down is shared between forearm and wrist.
      const twist = -s * arm.twist;
      forearm.quaternion.multiply(qTarget.setFromAxisAngle(yAxis.set(0, 1, 0), twist * 0.5));
      hand.quaternion.setFromEuler(euler.set(arm.bend, twist * 0.5, 0));

      const leg = pose.legs[side];
      const [thigh, shin, foot] = bones.slice(11 + side * 3, 14 + side * 3);
      joint.copy(thigh.position).applyQuaternion(hips.quaternion).add(hips.position);
      target.set(leg.x, leg.y, leg.z);
      pole.set(leg.px, leg.py, leg.pz);
      solveLimb(joint, THIGH, SHIN, hips.quaternion, false, thigh, shin);
      qTarget.setFromEuler(euler.set(leg.pitch, leg.yaw, 0));
      foot.quaternion.copy(qLower.invert()).multiply(qTarget);
    }
    mesh.rotation.x = -pose.tilt;
    mesh.position.y = pose.lift;
  }

  function setStyle(newStyle) {
    mesh.geometry.dispose();
    mesh.geometry = buildHumanGeometry(newStyle);
  }

  return { root, mesh, bones, apply, setStyle };
}
