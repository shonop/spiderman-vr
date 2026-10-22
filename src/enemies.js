import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, BLOCK, blockCenter } from './city.js';
import { PARTS, HIP, SHOULDER, ARM_SPREAD } from './people.js';
import { SIDES } from './input.js';
import { paint } from './utils.js';
import { playThud } from './sound.js';

const FIRST_WAVE_DELAY = 30; // seconds of free swinging after PLAY before the first thugs show up
const NEXT_WAVE_DELAY = 30;
const MAX_THUGS = 6;
const SPAWN_MIN = 100; // waves appear this far from the player (meters)
const SPAWN_MAX = 200;

const THUG_HEALTH = 100;
const RUN_SPEED = 3.6; // a bit slower than the player walks, so you can always back off
const WALK_SPEED = 1.4;
const TURN_SPEED = 8;
const NOTICE_RANGE = 25; // thugs start fighting when the player comes down on the street this close
const GIVE_UP_RANGE = 60;
const STREET_LEVEL = 3; // the player counts as "on the street" below this height above the ground
const REACH = 1.3; // thugs stop here and swing
const SWING_RANGE = 1.8; // the swing lands if the player is still this close when it comes
const WINDUP = 0.5;
const STRIKE = 0.18;
const THUG_DAMAGE = 7;
const STUN = 0.45;
const KNOCKBACK = 5;
const BODY_RADIUS = 0.4;
const PERSONAL_SPACE = 1; // how close a thug's body gets to the player's head

const PLAYER_HEALTH = 100;
const REGEN_DELAY = 5; // health starts coming back this long after the last hit
const REGEN_RATE = 8; // per second

const PUNCH_SPEED = 2.2; // m/s a VR hand must be moving to count as a punch
const PUNCH_RADIUS = 0.42;
const DESKTOP_REACH = 2.3;
const DESKTOP_DAMAGE = 34;
const MESSAGE_TIME = 4;

const SKIN_TONES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'];
const HOODIES = ['#2b2d33', '#3a2f4a', '#4a2a2a', '#26313d', '#33302a', '#1f2a24'];
const PANTS = ['#1f1f24', '#2b3a55', '#3a3a3f', '#26303f'];
const BEANIES = ['#111111', '#1b1b1b', '#3a1010', '#202a3a'];
const BANDANAS = ['#c8102e', '#c8102e', '#1d4ed8', '#151515'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const UP = new THREE.Vector3(0, 1, 0);

// A bandana over the lower half of the face.
function createMaskGeometry() {
  return paint(
    new THREE.SphereGeometry(0.113, 14, 4, Math.PI / 2 - 1.35, 2.7, 1.5, 0.95).scale(0.92, 1.1, 1).translate(0, 1.63, 0),
    '#ffffff',
  );
}

// Flat arrow lying on the ground plane, pointing toward -z.
function createArrowGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.13);
  shape.lineTo(0.1, 0);
  shape.lineTo(0.038, 0);
  shape.lineTo(0.038, -0.1);
  shape.lineTo(-0.038, -0.1);
  shape.lineTo(-0.038, 0);
  shape.lineTo(-0.1, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

function fadeUpTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, '#000');
  gradient.addColorStop(1, '#fff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 64);
  return new THREE.CanvasTexture(canvas);
}

// Street thugs that show up in waves. They wait at a street corner, rush the player when
// Spider-Man comes down to the street, and punch. The player punches back with real arm
// swings in VR, or F / middle click on desktop.
export function createEnemies({ scene, rig, camera, input, renderer, city, status, blobTexture, onKnockout }) {
  const thugs = [];
  for (let i = 0; i < MAX_THUGS; i++) thugs.push({ index: i, active: false });

  // Bodies: one InstancedMesh per body part, like the pedestrians.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = {};
  const part = (name, geometry, colorKey) => {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_THUGS);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData.colorKey = colorKey;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color());
    scene.add(mesh);
    meshes[name] = mesh;
  };
  part('head', PARTS.head(), 'skin');
  part('beanie', PARTS.shortHair(), 'beanie');
  part('mask', createMaskGeometry(), 'mask');
  part('torso', PARTS.torso(), 'hoodie');
  part('hips', PARTS.hips(), 'pants');
  part('legL', PARTS.leg(), 'pants');
  part('legR', PARTS.leg(), 'pants');
  part('armL', PARTS.arm(), 'hoodie');
  part('armR', PARTS.arm(), 'hoodie');
  part('handL', PARTS.hand(), 'skin');
  part('handR', PARTS.hand(), 'skin');
  const meshList = Object.values(meshes);

  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    MAX_THUGS,
  );
  shadows.frustumCulled = false;
  shadows.visible = false;
  scene.add(shadows);

  // Health bars floating over their heads, always turned toward the player.
  const barMaterial = (color, opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });
  const barBack = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.08), barMaterial(0x000000, 0.55), MAX_THUGS);
  const barFill = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.58, 0.05).translate(0.29, 0, 0), barMaterial(0xff3b3f, 1), MAX_THUGS);
  for (const bar of [barBack, barFill]) {
    bar.frustumCulled = false;
    bar.visible = false;
    scene.add(bar);
  }
  barFill.renderOrder = 1;

  // Marker: a tall red light over the gang that can be seen from across the city,
  // with a spinning arrowhead pointing down at them.
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0xe0141c,
    alphaMap: fadeUpTexture(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 320, 20, 1, true).translate(0, 160, 0), markerMaterial);
  beam.frustumCulled = false;
  const chevron = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 1.3, 4).rotateX(Math.PI),
    new THREE.MeshBasicMaterial({ color: 0xff3b3f, fog: false, toneMapped: false }),
  );
  beam.visible = chevron.visible = false;
  scene.add(beam, chevron);

  // Arrow floating at waist height in front of the player, pointing at the gang.
  const arrow = new THREE.Group();
  const arrowMesh = new THREE.Mesh(
    createArrowGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9, fog: false, toneMapped: false }),
  );
  arrowMesh.rotation.x = 0.55; // tip raised so it faces the player a little
  arrowMesh.renderOrder = 45;
  arrow.add(arrowMesh);
  arrow.visible = false;
  scene.add(arrow);

  // Spider-Man's fists on desktop, so a punch has something to show.
  const fistMaterial = new THREE.MeshLambertMaterial({ color: 0xc8102e });
  const fists = SIDES.map((side) => {
    const fist = new THREE.Mesh(
      mergeGeometries([
        new THREE.SphereGeometry(0.04, 12, 8).scale(1, 0.85, 1.1),
        new THREE.CylinderGeometry(0.026, 0.03, 0.14, 10).rotateX(Math.PI / 2).translate(0, 0, 0.09).rotateX(0.8), // forearm, angled down out of view
      ]),
      fistMaterial,
    );
    fist.userData = { side, t: 1, rest: new THREE.Vector3(side === 'left' ? -0.21 : 0.21, -0.22, -0.42) };
    fist.renderOrder = 44;
    fist.visible = false;
    camera.add(fist);
    return fist;
  });
  let nextFist = 1;

  let phase = 'off'; // off → waiting → fighting → waiting → ...
  let timer = 0;
  let wave = 0;
  let health = PLAYER_HEALTH;
  let sinceHurt = Infinity;
  let message = '';
  let messageTimer = 0;
  const target = new THREE.Vector3();

  const head = new THREE.Vector3();
  const look = new THREE.Vector3();
  const color = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const handLocal = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  const handPrevious = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  const handReady = { left: false, right: false };
  const handCooldown = { left: 0, right: 0 };
  const handWorld = new THREE.Vector3();
  const handVelocity = new THREE.Vector3();

  function say(text) {
    message = text;
    messageTimer = MESSAGE_TIME;
  }

  function start() {
    phase = 'waiting';
    timer = FIRST_WAVE_DELAY;
    wave = 0;
    health = PLAYER_HEALTH;
    sinceHurt = Infinity;
    message = '';
    for (const thug of thugs) thug.active = false;
  }

  // Every block corner within reach of a web swing or two, but not right next to the player.
  function chooseSpot() {
    const spots = [];
    const corner = BLOCK / 2 - 2;
    for (let i = 0; i < BLOCKS; i++) {
      for (let j = 0; j < BLOCKS; j++) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const x = blockCenter(i) + sx * corner;
            const z = blockCenter(j) + sz * corner;
            spots.push({ x, z, d: Math.hypot(x - rig.position.x, z - rig.position.z) });
          }
        }
      }
    }
    const good = spots.filter((s) => s.d >= SPAWN_MIN && s.d <= SPAWN_MAX);
    if (good.length) return pick(good);
    return spots.sort((a, b) => Math.abs(a.d - 150) - Math.abs(b.d - 150))[0];
  }

  function spawnWave() {
    wave++;
    const count = Math.min(MAX_THUGS, 2 + wave);
    const spot = chooseSpot();
    for (let k = 0; k < MAX_THUGS; k++) {
      const thug = thugs[k];
      thug.active = k < count;
      if (!thug.active) continue;
      const angle = (k / count) * Math.PI * 2 + Math.random() * 0.4;
      Object.assign(thug, {
        homeX: spot.x + Math.cos(angle) * 2.2,
        homeZ: spot.z + Math.sin(angle) * 2.2,
        state: 'idle',
        hp: THUG_HEALTH,
        vx: 0,
        vz: 0,
        timer: 0,
        cooldown: Math.random(),
        phase: Math.random() * Math.PI * 2,
        tilt: 0,
        sink: 0,
        flash: 0,
        swing: 0,
        size: 1 + Math.random() * 0.1,
        skin: pick(SKIN_TONES),
        hoodie: pick(HOODIES),
        pants: pick(PANTS),
        beanie: pick(BEANIES),
        mask: pick(BANDANAS),
      });
      thug.x = thug.homeX;
      thug.z = thug.homeZ;
      thug.heading = Math.atan2(spot.x - thug.x, spot.z - thug.z); // gathered in a circle, chatting
      paintThug(thug);
    }
    phase = 'fighting';
    say(wave === 1 ? 'THUGS SPOTTED! FOLLOW THE ARROW' : `WAVE ${wave}! FOLLOW THE ARROW`);
  }

  function paintThug(thug) {
    for (const mesh of meshList) {
      color.set(thug[mesh.userData.colorKey]);
      if (thug.flash > 0) color.lerp(white, Math.min(1, thug.flash * 6));
      mesh.setColorAt(thug.index, color);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  const fighting = (thug) => thug.active && thug.state !== 'down';

  function alertAll() {
    for (const thug of thugs) if (fighting(thug) && thug.state === 'idle') thug.state = 'chase';
  }

  function hurtThug(thug, damage, dirX, dirZ) {
    thug.hp -= damage;
    thug.flash = 0.2;
    thug.vx = dirX * KNOCKBACK;
    thug.vz = dirZ * KNOCKBACK;
    if (thug.hp <= 0) {
      thug.state = 'down';
      thug.timer = 0;
      thug.vx *= 1.6;
      thug.vz *= 1.6;
    } else {
      thug.state = 'stunned';
      thug.timer = STUN;
    }
    alertAll();
    playThud(Math.min(1, damage / 40), thug.hp <= 0 ? 0.8 : 1.15);
  }

  function hurtPlayer(amount) {
    health -= amount;
    sinceHurt = 0;
    status.flash(0.7);
    for (const side of SIDES) input.pulse(side, 1, 120);
    playThud(0.8, 0.6);
    if (health > 0) return;

    // Knocked out: back to the start roof, and the gang regroups at full health.
    health = PLAYER_HEALTH;
    onKnockout();
    for (const thug of thugs) {
      if (!fighting(thug)) continue;
      Object.assign(thug, { x: thug.homeX, z: thug.homeZ, hp: THUG_HEALTH, state: 'idle', vx: 0, vz: 0, tilt: 0 });
    }
    say('KNOCKED OUT!');
  }

  function turnToward(thug, x, z, dt) {
    const want = Math.atan2(x - thug.x, z - thug.z);
    let diff = want - thug.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    thug.heading += diff * Math.min(1, TURN_SPEED * dt);
  }

  // Walks toward (x, z) and stops `stopAt` meters short. Returns true while still walking.
  function walkToward(thug, x, z, speed, stopAt, dt) {
    const dx = x - thug.x;
    const dz = z - thug.z;
    const d = Math.hypot(dx, dz);
    turnToward(thug, x, z, dt);
    if (d <= stopAt) return false;
    const stepLength = Math.min(speed * dt, d - stopAt);
    thug.x += (dx / d) * stepLength;
    thug.z += (dz / d) * stepLength;
    thug.phase += stepLength * 4.5;
    return true;
  }

  function collide(thug) {
    const r = BODY_RADIUS;
    for (const b of city.colliders) {
      if (thug.x <= b.minX - r || thug.x >= b.maxX + r || thug.z <= b.minZ - r || thug.z >= b.maxZ + r) continue;
      const pushes = [b.minX - r - thug.x, b.maxX + r - thug.x, b.minZ - r - thug.z, b.maxZ + r - thug.z];
      let k = 0;
      for (let i = 1; i < 4; i++) if (Math.abs(pushes[i]) < Math.abs(pushes[k])) k = i;
      if (k < 2) thug.x += pushes[k];
      else thug.z += pushes[k];
    }
    for (const other of thugs) {
      if (other === thug || !fighting(other)) continue;
      const dx = thug.x - other.x;
      const dz = thug.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < BODY_RADIUS * 2) {
        thug.x += (dx / d) * (BODY_RADIUS * 2 - d) * 0.5;
        thug.z += (dz / d) * (BODY_RADIUS * 2 - d) * 0.5;
      }
    }
    thug.x = THREE.MathUtils.clamp(thug.x, -city.bounds, city.bounds);
    thug.z = THREE.MathUtils.clamp(thug.z, -city.bounds, city.bounds);
  }

  function updateThug(thug, dt) {
    const ground = city.groundHeightAt(thug.x, thug.z);
    const dx = head.x - thug.x;
    const dz = head.z - thug.z;
    const distance = Math.hypot(dx, dz);
    const onStreet = rig.position.y < ground + STREET_LEVEL;
    let moving = false;

    thug.timer -= dt;
    thug.cooldown -= dt;
    thug.flash = Math.max(0, thug.flash - dt);
    const slide = Math.exp(-6 * dt);
    thug.x += thug.vx * dt;
    thug.z += thug.vz * dt;
    thug.vx *= slide;
    thug.vz *= slide;

    switch (thug.state) {
      case 'idle':
        if (onStreet && distance < NOTICE_RANGE) alertAll();
        moving = walkToward(thug, thug.homeX, thug.homeZ, WALK_SPEED, 0.3, dt);
        break;
      case 'chase':
        if (distance > GIVE_UP_RANGE) {
          thug.state = 'idle';
        } else if (!onStreet) {
          turnToward(thug, head.x, head.z, dt); // can't reach Spider-Man up there, just stare
        } else if (distance > REACH) {
          moving = walkToward(thug, head.x, head.z, RUN_SPEED, REACH, dt);
        } else {
          turnToward(thug, head.x, head.z, dt);
          if (thug.cooldown <= 0) {
            thug.state = 'windup';
            thug.timer = WINDUP;
          }
        }
        break;
      case 'windup':
        turnToward(thug, head.x, head.z, dt);
        if (thug.timer <= 0) {
          thug.state = 'strike';
          thug.timer = STRIKE;
          const height = head.y - ground;
          if (distance <= SWING_RANGE && height > 0.5 && height < 2.6) hurtPlayer(THUG_DAMAGE);
        }
        break;
      case 'strike':
        if (thug.timer <= 0) {
          thug.state = 'chase';
          thug.cooldown = 0.9 + Math.random() * 0.9;
        }
        break;
      case 'stunned':
        if (thug.timer <= 0) thug.state = 'chase';
        break;
      case 'down':
        thug.timer += 2 * dt; // counts up while lying there
        if (thug.timer > 6) thug.sink += dt * 0.6;
        if (thug.sink > 0.6) thug.active = false;
        break;
    }

    // Don't stand inside the player.
    if (thug.state !== 'down' && distance < PERSONAL_SPACE && distance > 0.001) {
      thug.x -= (dx / distance) * (PERSONAL_SPACE - distance);
      thug.z -= (dz / distance) * (PERSONAL_SPACE - distance);
    }
    collide(thug);

    // Pose
    const tiltTarget = thug.state === 'down' ? -Math.PI / 2 : thug.state === 'stunned' ? -0.35 : 0;
    thug.tilt += (tiltTarget - thug.tilt) * Math.min(1, dt * (thug.state === 'down' ? 7 : 12));
    const swingTarget = thug.state === 'windup' ? 0.6 : thug.state === 'strike' ? -1.65 : thug.state === 'idle' ? 0 : -1.05;
    thug.swing += (swingTarget - thug.swing) * Math.min(1, dt * (thug.state === 'strike' ? 30 : 10));
    if (!moving && thug.state !== 'down') thug.phase += dt * 1.2 * (thug.state === 'idle' ? 0.6 : 2);
    thug.moving = moving;
  }

  // Matrices for one thug's body parts.
  const body = new THREE.Matrix4();
  const joint = new THREE.Matrix4();
  const limb = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const tiltRotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const X_AXIS = new THREE.Vector3(1, 0, 0);

  function setLimb(mesh, index, x, y, swing, spread) {
    joint.makeRotationFromEuler(euler.set(swing, 0, spread));
    joint.setPosition(x, y, 0);
    mesh.setMatrixAt(index, limb.multiplyMatrices(body, joint));
  }

  const barRotation = new THREE.Quaternion();
  const barRight = new THREE.Vector3();
  const barPosition = new THREE.Vector3();
  const barScale = new THREE.Vector3();

  function placeThug(thug) {
    const i = thug.index;
    if (!thug.active) {
      for (const mesh of meshList) mesh.setMatrixAt(i, hidden);
      shadows.setMatrixAt(i, hidden);
      barBack.setMatrixAt(i, hidden);
      barFill.setMatrixAt(i, hidden);
      return;
    }
    const ground = city.groundHeightAt(thug.x, thug.z);
    const running = thug.moving && thug.state === 'chase';
    const stride = thug.moving ? Math.sin(thug.phase) : 0;
    const bob = thug.moving ? Math.abs(Math.cos(thug.phase)) * (running ? 0.06 : 0.03) : 0;
    const sway = thug.moving || thug.state === 'down' ? 0 : Math.sin(thug.phase) * 0.06;

    position.set(thug.x, ground + bob - thug.sink, thug.z);
    rotation.setFromAxisAngle(UP, thug.heading).multiply(tiltRotation.setFromAxisAngle(X_AXIS, thug.tilt + sway * 0.3));
    scale.setScalar(thug.size);
    body.compose(position, rotation, scale);

    for (const name of ['head', 'beanie', 'mask', 'torso', 'hips']) meshes[name].setMatrixAt(i, body);
    shadows.setMatrixAt(i, limb.makeTranslation(thug.x, ground + 0.01, thug.z));

    const legSwing = running ? 0.75 : 0.45;
    const down = thug.state === 'down';
    setLimb(meshes.legL, i, -HIP.x, HIP.y, down ? 0 : stride * legSwing, down ? -0.15 : 0);
    setLimb(meshes.legR, i, HIP.x, HIP.y, down ? 0 : -stride * legSwing, down ? 0.15 : 0);

    // Fists up while fighting; the right arm throws the punch.
    const fightingPose = thug.state !== 'idle' && !down;
    const guard = fightingPose ? -1.1 + Math.sin(thug.phase * 0.7) * 0.1 : -stride * 0.35 + sway;
    const punch = fightingPose ? thug.swing : stride * 0.35 - sway;
    const spread = down ? 1.2 : fightingPose ? 0.25 : ARM_SPREAD;
    setLimb(meshes.armL, i, -SHOULDER.x, SHOULDER.y, thug.state === 'stunned' ? -2.2 : guard, -spread);
    meshes.handL.setMatrixAt(i, limb);
    setLimb(meshes.armR, i, SHOULDER.x, SHOULDER.y, thug.state === 'stunned' ? -2.4 : punch, thug.state === 'strike' ? 0.05 : spread);
    meshes.handR.setMatrixAt(i, limb);

    // Health bar
    if (down || thug.hp >= THUG_HEALTH) {
      barBack.setMatrixAt(i, hidden);
      barFill.setMatrixAt(i, hidden);
      return;
    }
    camera.getWorldQuaternion(barRotation);
    barRight.set(1, 0, 0).applyQuaternion(barRotation);
    barPosition.set(thug.x, ground + 2.15 * thug.size, thug.z);
    barBack.setMatrixAt(i, limb.compose(barPosition, barRotation, barScale.set(1, 1, 1)));
    look.copy(head).sub(barPosition).normalize().multiplyScalar(0.01);
    barPosition.addScaledVector(barRight, -0.29).add(look);
    barFill.setMatrixAt(i, limb.compose(barPosition, barRotation, barScale.set(Math.max(0.001, thug.hp / THUG_HEALTH), 1, 1)));
  }

  // VR: any thug a fast-moving hand passes through gets hit, harder the faster the swing.
  function punchWithHands(dt) {
    for (const side of SIDES) {
      const controller = input.hands[side].controller;
      handCooldown[side] -= dt;
      if (!renderer.xr.isPresenting || !controller) {
        handReady[side] = false;
        continue;
      }
      // Measured in the rig's space, so swinging on a web doesn't count as punching.
      handPrevious[side].copy(handLocal[side]);
      handLocal[side].copy(controller.position);
      if (!handReady[side]) {
        handReady[side] = true;
        continue;
      }
      handVelocity.subVectors(handLocal[side], handPrevious[side]).divideScalar(Math.max(dt, 1e-3));
      const speed = handVelocity.length();
      if (speed < PUNCH_SPEED || speed > 30 || handCooldown[side] > 0) continue;

      controller.getWorldPosition(handWorld);
      handVelocity.applyQuaternion(rig.quaternion);
      for (const thug of thugs) {
        if (!fighting(thug)) continue;
        const ground = city.groundHeightAt(thug.x, thug.z);
        const y = THREE.MathUtils.clamp(handWorld.y, ground + 0.9 * thug.size, ground + 1.7 * thug.size);
        const d = Math.hypot(handWorld.x - thug.x, handWorld.y - y, handWorld.z - thug.z);
        if (d > PUNCH_RADIUS) continue;
        let dirX = handVelocity.x;
        let dirZ = handVelocity.z;
        const flat = Math.hypot(dirX, dirZ);
        if (flat < 0.5) [dirX, dirZ] = [thug.x - head.x, thug.z - head.z];
        const length = Math.hypot(dirX, dirZ) || 1;
        hurtThug(thug, THREE.MathUtils.clamp(speed * 9, 18, 50), dirX / length, dirZ / length);
        input.pulse(side, 1, 70);
        handCooldown[side] = 0.35;
        break;
      }
    }
  }

  // Desktop: F or middle click throws a punch at whoever is right in front of the camera.
  function punchFromDesktop() {
    const fist = fists[nextFist];
    nextFist = 1 - nextFist;
    fist.userData.t = 0;

    camera.getWorldDirection(look);
    look.y = 0;
    look.normalize();
    let best = null;
    let bestDistance = DESKTOP_REACH;
    for (const thug of thugs) {
      if (!fighting(thug)) continue;
      const dx = thug.x - head.x;
      const dz = thug.z - head.z;
      const d = Math.hypot(dx, dz);
      const height = head.y - city.groundHeightAt(thug.x, thug.z);
      if (d > bestDistance || height < 0.5 || height > 2.8) continue;
      if (d > 0.5 && (dx * look.x + dz * look.z) / d < 0.6) continue;
      best = thug;
      bestDistance = d;
    }
    if (best) hurtThug(best, DESKTOP_DAMAGE, look.x, look.z);
    else playThud(0.12, 2.5); // a whoosh at the air
  }

  function updateFists(dt, show) {
    for (const fist of fists) {
      const data = fist.userData;
      fist.visible = show;
      data.t = Math.min(1, data.t + dt / 0.22);
      const jab = Math.sin(data.t * Math.PI);
      fist.position.copy(data.rest);
      fist.position.x *= 1 - jab * 0.65;
      fist.position.y += jab * 0.1;
      fist.position.z -= jab * 0.3;
    }
  }

  function updateMarker(alive) {
    target.set(0, 0, 0);
    for (const thug of alive) target.x += thug.x / alive.length;
    for (const thug of alive) target.z += thug.z / alive.length;
    target.y = city.groundHeightAt(target.x, target.z);

    const distance = Math.hypot(target.x - head.x, target.z - head.z);
    const time = performance.now() / 1000;
    beam.visible = true;
    chevron.visible = distance > 15;
    beam.position.copy(target);
    markerMaterial.opacity = (0.45 + Math.sin(time * 3) * 0.1) * THREE.MathUtils.clamp((distance - 12) / 30, 0, 1);
    chevron.position.set(target.x, target.y + 4.2 + Math.sin(time * 2.5) * 0.3, target.z);
    chevron.rotation.y = time * 1.5;
    chevron.scale.setScalar(THREE.MathUtils.clamp(distance / 40, 1, 4));

    // The arrow points at the gang until the player is close enough to see them.
    arrow.visible = distance > 25;
    if (!arrow.visible) return distance;
    camera.getWorldDirection(look);
    look.y = 0;
    if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
    look.normalize();
    arrow.position.copy(head).addScaledVector(look, 0.8);
    arrow.position.y -= 0.32;
    arrow.rotation.y = Math.atan2(-(target.x - arrow.position.x), -(target.z - arrow.position.z));
    return distance;
  }

  function update(dt, playing) {
    status.update(dt);
    updateFists(dt, playing && phase !== 'off' && !renderer.xr.isPresenting);
    if (!playing || phase === 'off') {
      for (const object of [...meshList, shadows, barBack, barFill, beam, chevron, arrow]) object.visible = false;
      status.hide();
      return;
    }

    camera.getWorldPosition(head);
    messageTimer -= dt;
    if (messageTimer <= 0) message = '';
    sinceHurt += dt;
    if (sinceHurt > REGEN_DELAY) health = Math.min(PLAYER_HEALTH, health + REGEN_RATE * dt);

    if (phase === 'waiting') {
      timer -= dt;
      if (timer <= 0) spawnWave();
    }

    // Knocked-out thugs keep falling and fading even after the wave is over.
    for (const thug of thugs) if (thug.active) updateThug(thug, dt);

    if (input.punchDown && !renderer.xr.isPresenting) punchFromDesktop();
    punchWithHands(dt);

    let objective = '';
    const anyActive = thugs.some((thug) => thug.active);
    if (phase === 'fighting') {
      const alive = thugs.filter(fighting);
      if (alive.length) {
        const distance = updateMarker(alive);
        objective = `THUGS LEFT: ${alive.length}` + (distance > 25 ? `  ·  ${Math.round(distance)} m` : '');
      } else {
        beam.visible = chevron.visible = arrow.visible = false;
        phase = 'waiting';
        timer = NEXT_WAVE_DELAY;
        say('AREA CLEAR!');
      }
    } else {
      beam.visible = chevron.visible = arrow.visible = false;
    }

    for (const thug of thugs) {
      // Colors only change while a thug flashes white from a hit.
      if (thug.active && (thug.flash > 0 || thug.flashing)) paintThug(thug);
      thug.flashing = thug.flash > 0;
      placeThug(thug);
    }
    for (const object of [...meshList, shadows, barBack, barFill]) {
      object.visible = anyActive;
      object.instanceMatrix.needsUpdate = true;
    }

    const showHealth = phase === 'fighting' || health < PLAYER_HEALTH;
    status.set({ message, objective, health: showHealth ? Math.max(0, health) / PLAYER_HEALTH : null });
  }

  return {
    start,
    update,
    // For testing from the console: skip the wait before the next wave.
    spawnNow: () => {
      if (phase === 'waiting') timer = 0;
    },
    get thugs() {
      return thugs;
    },
    get health() {
      return health;
    },
  };
}
