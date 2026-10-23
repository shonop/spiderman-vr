import * as THREE from 'three';
import { BLOCKS, BLOCK, blockCenter } from './city.js';
import { SIDES } from './input.js';
import { playThud } from './sound.js';
import { createHuman, createHumanMaterial, createPose, copyPose, lerpPose, standPose, walkPose, cycleLength, lookAt } from './human.js';
import { MOVES, attackLength, guardPose, attackPose, hitPose, knockoutPose } from './brawl.js';

const FIRST_WAVE_DELAY = 30; // seconds of free swinging after PLAY before the first thugs show up
const NEXT_WAVE_DELAY = 30;
const MAX_THUGS = 6;
const SPAWN_MIN = 100; // waves appear this far from the player (meters)
const SPAWN_MAX = 200;

const THUG_HEALTH = 100;
const RUN_SPEED = 3.6; // a bit slower than the player walks, so you can always back off
const SHUFFLE_SPEED = 1.5; // closing the last couple of meters with the guard up
const SHUFFLE_RANGE = 2.6;
const WALK_SPEED = 1.4;
const TURN_SPEED = 8;
const NOTICE_RANGE = 25; // thugs start fighting when the player comes down on the street this close
const GIVE_UP_RANGE = 60;
const STREET_LEVEL = 3; // the player counts as "on the street" below this height above the ground
const REACH = 1.1; // thugs stop here and start throwing punches
const DODGE = 0.35; // a punch misses if the player's head moved this far after it was thrown
const BLOCK_RADIUS = 0.22; // VR: a hand this close in front of the face blocks a punch
const COMBO_CHANCE = 0.5; // a jab is often followed straight away by a cross
const STUN = 0.45;
const KNOCKBACK = 5;
const BODY_RADIUS = 0.4;
const PERSONAL_SPACE = 0.85; // how close a thug's body gets to the player's head
const FADE = 0.2; // seconds to blend from one animation into the next
const FAST_FADE = 0.08;

const PLAYER_HEALTH = 100;
const REGEN_DELAY = 5; // health starts coming back this long after the last hit
const REGEN_RATE = 8; // per second

const PUNCH_SPEED = 2.2; // m/s a VR hand must be moving to count as a punch
const PUNCH_RADIUS = 0.42;
const DESKTOP_REACH = 2.3;
const DESKTOP_DAMAGE = 34;
const MESSAGE_TIME = 4;

const SKIN_TONES = ['#f2cfb0', '#e6b892', '#d29c76', '#b57b55', '#8d5a3c', '#6a4129', '#4a2c1c'];
const EYES = ['#3b2a1a', '#4a3322', '#2a1c12', '#4e6a7a', '#4f6b3a'];
const HAIR = ['#141110', '#1f1712', '#2e2018', '#4a3020', '#6b4a2e'];
const HOODIES = ['#2b2d33', '#3a2f4a', '#4a2a2a', '#26313d', '#4a463c', '#1f2a24', '#5c5f66', '#7a1e22'];
const TEES = ['#e8e4dc', '#1d1d20', '#5a6b4a', '#7a6a55'];
const PANTS = ['#1f1f24', '#2b3a55', '#3a3a3f', '#26303f', '#4a4a4f', '#3d4a63'];
const BEANIES = ['#111111', '#1b1b1b', '#4a1414', '#202a3a', '#3c4a2e', '#6a6a6a'];
const BANDANAS = ['#a3121f', '#a3121f', '#1d3f8a', '#151515'];
const SHOES = [
  ['#f2f2f2', '#f8f8f8'],
  ['#151515', '#f0f0f0'],
  ['#151515', '#1a1a1a'],
  ['#8a1a1a', '#f2f2f2'],
  ['#c9c1b0', '#7a5a3a'],
];
const STRIPES = ['#e6e6e6', '#e6e6e6', '#b31b1b'];
// Which attacks get thrown, and how often.
const MOVE_ODDS = [
  ['jab', 3],
  ['cross', 2],
  ['hook', 2],
  ['uppercut', 1.5],
  ['kick', 1.5],
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;

// A random street thug look.
function thugStyle() {
  const hood = chance(0.4);
  const hoodie = hood || chance(0.75);
  const joggers = chance(0.5);
  const [shoes, sole] = pick(SHOES);
  return {
    skin: pick(SKIN_TONES),
    eyes: pick(EYES),
    hair: pick(HAIR),
    hairStyle: hood ? 'hood' : pick(['beanie', 'beanie', 'buzz', 'short', 'bald']),
    hat: pick(BEANIES),
    top: hoodie ? pick(HOODIES) : pick(TEES),
    topStyle: hoodie ? 'hoodie' : 'tshirt',
    pants: pick(PANTS),
    pantsStyle: joggers ? 'joggers' : 'jeans',
    stripe: joggers && chance(0.6) ? pick(STRIPES) : null,
    shoes,
    sole,
    mask: chance(0.55) ? pick(BANDANAS) : null,
    beard: chance(0.45) ? 0.45 + Math.random() * 0.45 : 0,
    build: 1 + Math.random() * 0.15,
    belly: chance(0.3) ? 0.015 + Math.random() * 0.03 : 0,
  };
}

function pickMove(distance, size) {
  const options = MOVE_ODDS.filter(([name]) => MOVES[name].range * size >= distance);
  let roll = Math.random() * options.reduce((sum, [, odds]) => sum + odds, 0);
  for (const [name, odds] of options) {
    roll -= odds;
    if (roll <= 0) return name;
  }
  return 'jab';
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
// Spider-Man comes down to the street, and fight: jabs, crosses, hooks, uppercuts and kicks
// aimed at the player's head. The player can step out of the way, block with a hand in front
// of the face (VR), and punch back with real arm swings in VR, or F / middle click on desktop.
export function createEnemies({ scene, rig, camera, input, hands, renderer, city, status, blobTexture, onKnockout }) {
  const thugs = [];
  for (let i = 0; i < MAX_THUGS; i++) {
    const material = createHumanMaterial(); // one each, so a hit thug can flash on its own
    const human = createHuman(thugStyle(), material);
    human.root.visible = false;
    scene.add(human.root);
    thugs.push({
      index: i,
      active: false,
      human,
      material,
      pose: createPose(),
      from: createPose(),
      next: createPose(),
      animation: '',
      blend: 1,
      fade: FADE,
      restyle: false,
    });
  }

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

  let phase = 'off'; // off → waiting → fighting → waiting → ...
  let timer = 0;
  let wave = 0;
  let health = PLAYER_HEALTH;
  let sinceHurt = Infinity;
  let message = '';
  let messageTimer = 0;
  let time = 0;
  const target = new THREE.Vector3();

  const head = new THREE.Vector3();
  const look = new THREE.Vector3();
  const handLocal = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  const handPrevious = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  const handReady = { left: false, right: false };
  const handCooldown = { left: 0, right: 0 };
  const handWorld = new THREE.Vector3();
  const handVelocity = new THREE.Vector3();
  const guardPoint = new THREE.Vector3();

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
        homeX: spot.x + Math.cos(angle) * 1.6,
        homeZ: spot.z + Math.sin(angle) * 1.6,
        spotX: spot.x,
        spotZ: spot.z,
        state: 'idle',
        hp: THUG_HEALTH,
        vx: 0,
        vz: 0,
        timer: 0,
        cooldown: Math.random(),
        phase: Math.random() * Math.PI * 2,
        clock: Math.random() * 100, // so they don't all sway in step
        sink: 0,
        flash: 0,
        size: 0.97 + Math.random() * 0.1,
        moving: false,
        speed: 0,
        move: null,
        attackTime: 0,
        attacks: 0,
        locked: false,
        lockedAim: new THREE.Vector3(),
        hitTime: 0,
        downTime: 0,
        hitLow: false,
        hitSide: 1,
        restyle: true, // a new look, built over the next frames (one body per frame)
      });
      thug.x = thug.homeX;
      thug.z = thug.homeZ;
      thug.heading = Math.atan2(spot.x - thug.x, spot.z - thug.z); // gathered in a circle, chatting
      thug.human.root.visible = false;
      thug.animation = '';
    }
    phase = 'fighting';
    say(wave === 1 ? 'THUGS SPOTTED! FOLLOW THE ARROW' : `WAVE ${wave}! FOLLOW THE ARROW`);
  }

  const fighting = (thug) => thug.active && thug.state !== 'down';

  function alertAll() {
    for (const thug of thugs) if (fighting(thug) && thug.state === 'idle') thug.state = 'chase';
  }

  // dirX/dirZ: which way the blow pushes. low: a body shot rather than a head shot.
  function hurtThug(thug, damage, dirX, dirZ, low = false) {
    thug.hp -= damage;
    thug.flash = 0.2;
    thug.vx = dirX * KNOCKBACK;
    thug.vz = dirZ * KNOCKBACK;
    thug.hitTime = 0;
    thug.hitLow = low;
    // Head snaps toward the side the blow pushes it (+1 = the thug's left).
    thug.hitSide = dirX * Math.cos(thug.heading) - dirZ * Math.sin(thug.heading) >= 0 ? 1 : -1;
    if (thug.hp <= 0) {
      thug.state = 'down';
      thug.downTime = 0;
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
      Object.assign(thug, { x: thug.homeX, z: thug.homeZ, hp: THUG_HEALTH, state: 'idle', vx: 0, vz: 0 });
    }
    say('KNOCKED OUT!');
  }

  // VR: a hand held up in front of the face, between it and the punch, blocks it.
  function blocked(thug) {
    if (!renderer.xr.isPresenting) return false;
    guardPoint.set(thug.x - head.x, 0, thug.z - head.z).normalize().multiplyScalar(0.18).add(head);
    for (const side of SIDES) {
      const controller = input.hands[side].controller;
      if (!controller) continue;
      controller.getWorldPosition(handWorld);
      if (handWorld.distanceTo(guardPoint) < BLOCK_RADIUS) {
        input.pulse(side, 0.6, 60);
        return true;
      }
    }
    return false;
  }

  // The moment a punch or kick arrives: it lands unless the player stepped away or blocked.
  function landAttack(thug, ground) {
    const move = MOVES[thug.move];
    const height = head.y - ground;
    const distance = Math.hypot(head.x - thug.x, head.z - thug.z);
    if (head.distanceTo(thug.lockedAim) > DODGE) return playThud(0.1, 2.6); // dodged: a whoosh
    if (distance > move.range * thug.size + 0.2 || height < 0.5 || height > 2.6) return;
    if (blocked(thug)) return playThud(0.35, 1.7);
    hurtPlayer(move.damage);
  }

  function startAttack(thug, name) {
    thug.state = 'attack';
    thug.move = name;
    thug.attackTime = 0;
    thug.attacks++;
    thug.locked = false;
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
    thug.speed = speed;
    thug.phase += (stepLength / (cycleLength(speed > 2 ? 1 : 0) * thug.size)) * Math.PI * 2;
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
    thug.hitTime += dt;
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
        if (!moving) turnToward(thug, thug.spotX, thug.spotZ, dt * 0.3);
        break;
      case 'chase':
        if (distance > GIVE_UP_RANGE) {
          thug.state = 'idle';
        } else if (!onStreet) {
          turnToward(thug, head.x, head.z, dt); // can't reach Spider-Man up there, just stare
        } else if (distance > REACH) {
          moving = walkToward(thug, head.x, head.z, distance < SHUFFLE_RANGE ? SHUFFLE_SPEED : RUN_SPEED, REACH, dt);
        } else {
          turnToward(thug, head.x, head.z, dt);
          if (thug.cooldown <= 0) startAttack(thug, pickMove(distance, thug.size));
        }
        if (thug.state === 'chase' && thug.cooldown <= 0 && onStreet && distance < MOVES.kick.range * thug.size && chance(dt * 0.6)) {
          startAttack(thug, pickMove(distance, thug.size)); // sometimes swings while still closing in
        }
        break;
      case 'attack': {
        const move = MOVES[thug.move];
        const before = thug.attackTime;
        thug.attackTime += dt;
        const t = thug.attackTime;
        // Tracks the player while winding up, then commits to where they were.
        if (t < move.windup) turnToward(thug, head.x, head.z, dt);
        else if (!thug.locked) {
          thug.locked = true;
          thug.lockedAim.copy(head);
        }
        const impact = move.windup + move.strike;
        if (before < impact && t >= impact) landAttack(thug, ground);
        if (thug.move === 'jab' && before < impact + move.hold && t >= impact + move.hold && chance(COMBO_CHANCE) && distance < MOVES.cross.range * thug.size) {
          startAttack(thug, 'cross');
          thug.attackTime = MOVES.cross.windup * 0.45; // already half loaded from the jab
          thug.fade = 0.12;
        } else if (t >= attackLength(move)) {
          thug.state = 'chase';
          thug.cooldown = 1.1 + Math.random() * 1.3; // breathing room between attacks
        }
        break;
      }
      case 'stunned':
        if (thug.timer <= 0) thug.state = 'chase';
        break;
      case 'down':
        thug.downTime += dt;
        if (thug.downTime > 6) thug.sink += dt * 0.3; // then slowly sinks away
        if (thug.sink > 0.4) thug.active = false;
        break;
    }

    // Don't stand inside the player.
    if (thug.state !== 'down' && distance < PERSONAL_SPACE && distance > 0.001) {
      thug.x -= (dx / distance) * (PERSONAL_SPACE - distance);
      thug.z -= (dz / distance) * (PERSONAL_SPACE - distance);
    }
    collide(thug);
    thug.moving = moving;
    thug.onStreet = onStreet;
  }

  // --- Animation ---

  const aim = new THREE.Vector3();
  const lookPoint = { x: 0, y: 0, z: 0 };

  // A world point in the thug's own space (facing +z, in units of its height).
  function toLocal(thug, x, y, z, out) {
    const ground = city.groundHeightAt(thug.x, thug.z);
    const dx = x - thug.x;
    const dz = z - thug.z;
    const c = Math.cos(thug.heading);
    const s = Math.sin(thug.heading);
    out.x = (dx * c - dz * s) / thug.size;
    out.y = (y - ground) / thug.size;
    out.z = (dx * s + dz * c) / thug.size;
    return out;
  }

  // Works out what the body is doing this frame and blends smoothly between animations.
  function animate(thug, dt) {
    const pose = thug.next;
    const t = thug.clock;
    let name = thug.state;
    const aimed = thug.state === 'attack' && thug.locked ? thug.lockedAim : head;
    toLocal(thug, aimed.x, aimed.y, aimed.z, aim);

    switch (thug.state) {
      case 'idle':
        if (thug.moving) {
          name = 'walk';
          walkPose(pose, thug.phase, 0);
        } else {
          standPose(pose, t, 0.7);
          toLocal(thug, thug.spotX, 0, thug.spotZ, lookPoint);
          lookPoint.y = 1.55; // the faces of the others in the circle
          lookAt(pose, lookPoint, 0.7);
        }
        break;
      case 'chase':
        if (thug.moving && thug.speed > 2) {
          name = 'run';
          walkPose(pose, thug.phase, 1);
        } else if (!thug.onStreet) {
          name = 'stare';
          standPose(pose, t);
          lookAt(pose, aim);
        } else {
          name = 'guard';
          guardPose(pose, t, thug.moving ? 1 : 0);
          lookAt(pose, aim);
        }
        break;
      case 'attack':
        name = `attack${thug.attacks}`;
        attackPose(pose, MOVES[thug.move], thug.attackTime, t, aim);
        lookAt(pose, aim);
        break;
      case 'stunned':
        hitPose(pose, t, thug.hitTime, thug.hitLow, thug.hitSide);
        break;
      case 'down':
        knockoutPose(pose, t, thug.downTime, thug.hitSide);
        break;
    }

    if (name !== thug.animation) {
      if (thug.animation) {
        copyPose(thug.from, thug.pose);
        thug.blend = 0;
        if (name === 'stunned' || name === 'down') thug.fade = FAST_FADE;
        else if (thug.fade === FADE || thug.fade === FAST_FADE) thug.fade = FADE;
      } else {
        thug.blend = 1;
      }
      thug.animation = name;
    }
    thug.blend = Math.min(1, thug.blend + dt / thug.fade);
    if (thug.blend < 1) {
      const k = thug.blend * thug.blend * (3 - 2 * thug.blend);
      lerpPose(thug.pose, thug.from, pose, k);
    } else {
      copyPose(thug.pose, pose);
      thug.fade = FADE;
    }
    thug.human.apply(thug.pose);
  }

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const matrix = new THREE.Matrix4();
  const barRotation = new THREE.Quaternion();
  const barRight = new THREE.Vector3();
  const barPosition = new THREE.Vector3();
  const barScale = new THREE.Vector3();

  function placeThug(thug, dt) {
    const i = thug.index;
    const { root } = thug.human;
    root.visible = thug.active && !thug.restyle;
    if (!root.visible) {
      shadows.setMatrixAt(i, hidden);
      barBack.setMatrixAt(i, hidden);
      barFill.setMatrixAt(i, hidden);
      return;
    }
    const ground = city.groundHeightAt(thug.x, thug.z);
    thug.clock += dt;
    root.position.set(thug.x, ground - thug.sink, thug.z);
    root.rotation.y = thug.heading;
    root.scale.setScalar(thug.size);
    animate(thug, dt);
    thug.material.emissive.setRGB(0.2, 0.04, 0.03).multiplyScalar(Math.min(1, thug.flash * 6)); // a brief red flush when hit

    // The shadow follows the hips (they end up away from the feet when lying down).
    const lying = Math.sin(thug.pose.tilt) * 0.85 * thug.size;
    shadows.setMatrixAt(i, matrix.makeTranslation(thug.x - Math.sin(thug.heading) * lying, ground + 0.01, thug.z - Math.cos(thug.heading) * lying));

    // Health bar
    if (thug.state === 'down' || thug.hp >= THUG_HEALTH) {
      barBack.setMatrixAt(i, hidden);
      barFill.setMatrixAt(i, hidden);
      return;
    }
    camera.getWorldQuaternion(barRotation);
    barRight.set(1, 0, 0).applyQuaternion(barRotation);
    barPosition.set(thug.x, ground + 2.1 * thug.size, thug.z);
    barBack.setMatrixAt(i, matrix.compose(barPosition, barRotation, barScale.set(1, 1, 1)));
    look.copy(head).sub(barPosition).normalize().multiplyScalar(0.01);
    barPosition.addScaledVector(barRight, -0.29).add(look);
    barFill.setMatrixAt(i, matrix.compose(barPosition, barRotation, barScale.set(Math.max(0.001, thug.hp / THUG_HEALTH), 1, 1)));
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
        const low = handWorld.y < ground + 1.25 * thug.size;
        hurtThug(thug, THREE.MathUtils.clamp(speed * 9, 18, 50), dirX / length, dirZ / length, low);
        input.pulse(side, 1, 70);
        handCooldown[side] = 0.35;
        break;
      }
    }
  }

  // Desktop: F or middle click throws a punch at whoever is right in front of the camera.
  function punchFromDesktop() {
    hands.punch();

    camera.getWorldDirection(look);
    const lookingDown = look.y < -0.45; // aiming low hits the body
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
    if (best) hurtThug(best, DESKTOP_DAMAGE, look.x, look.z, lookingDown);
    else playThud(0.12, 2.5); // a whoosh at the air
  }

  function updateMarker(alive) {
    target.set(0, 0, 0);
    for (const thug of alive) target.x += thug.x / alive.length;
    for (const thug of alive) target.z += thug.z / alive.length;
    target.y = city.groundHeightAt(target.x, target.z);

    const distance = Math.hypot(target.x - head.x, target.z - head.z);
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
    time += dt;
    status.update(dt);
    if (!playing || phase === 'off') {
      for (const object of [shadows, barBack, barFill, beam, chevron, arrow]) object.visible = false;
      for (const thug of thugs) thug.human.root.visible = false;
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

    // New looks for a fresh wave, one body per frame so there's no hitch.
    const restyle = thugs.find((thug) => thug.active && thug.restyle);
    if (restyle) {
      restyle.human.setStyle(thugStyle());
      restyle.restyle = false;
    }

    // Knocked-out thugs keep lying there and fading even after the wave is over.
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

    for (const thug of thugs) placeThug(thug, dt);
    for (const object of [shadows, barBack, barFill]) {
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
