import * as THREE from 'three';
import { SIDES } from './input.js';

const WEB_RANGE = 50; // webs only reach buildings this close (meters)
const LOOK_RANGE = 250; // further than this, aiming at a building shows nothing at all
const GRAVITY = 14;
const WALK_SPEED = 4.5;
const JUMP_SPEED = 6.5;
const AIR_CONTROL = 8; // m/s² of steering while flying
const AIR_DRAG = 0.05;
const MAX_SPEED = 50;
const CHEST_HEIGHT = 1.2; // webs pull from here, not from the feet
const RADIUS = 0.35;
const MIN_ROPE = 3;
const AUTO_REEL = 1.5; // the web slowly shortens by itself, which helps you lift off
const REEL_SPEED = 12; // how fast the web shortens while holding grip
const REEL_PULL = 20; // extra acceleration toward the anchor while holding grip

const UP = new THREE.Vector3(0, 1, 0);

// Ray vs. axis-aligned building boxes. Returns the closest hit within maxDistance.
function raycastBuildings(ray, maxDistance, colliders) {
  const { origin: o, direction: d } = ray;
  let best = maxDistance;
  let found = false;
  const range = [0, 0];
  const slab = (origin, dir, min, max) => {
    if (Math.abs(dir) < 1e-8) return origin >= min && origin <= max;
    let t1 = (min - origin) / dir;
    let t2 = (max - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    range[0] = Math.max(range[0], t1);
    range[1] = Math.min(range[1], t2);
    return range[0] <= range[1];
  };
  for (const b of colliders) {
    range[0] = 0;
    range[1] = best;
    if (slab(o.x, d.x, b.minX, b.maxX) && slab(o.y, d.y, 0, b.top) && slab(o.z, d.z, b.minZ, b.maxZ) && range[0] > 0) {
      best = range[0];
      found = true;
    }
  }
  return found ? { distance: best, point: ray.at(best, new THREE.Vector3()) } : null;
}

// The player's body: gravity, walking, landing on roofs, bumping into walls, and swinging on webs.
export function createPlayer({ scene, rig, camera, input, city }) {
  const velocity = new THREE.Vector3();
  let grounded = true;

  const webGeometry = new THREE.CylinderGeometry(0.015, 0.015, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const webMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeeee, toneMapped: false });
  const reticleGeometry = new THREE.SphereGeometry(1, 12, 8);
  const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false });
  const tooFarMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b3f, depthTest: false, transparent: true, opacity: 0.6, toneMapped: false });

  const webs = {};
  for (const side of SIDES) {
    const line = new THREE.Mesh(webGeometry, webMaterial);
    const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    line.frustumCulled = false;
    reticle.renderOrder = 10;
    line.visible = reticle.visible = false;
    scene.add(line, reticle);
    webs[side] = { attached: false, anchor: new THREE.Vector3(), length: 0, aim: null, tooFar: null, line, reticle };
  }

  const ray = new THREE.Ray();
  const chest = new THREE.Vector3();
  const toAnchor = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const handPosition = new THREE.Vector3();

  function reset() {
    rig.position.copy(city.spawn);
    rig.rotation.set(0, 0, 0);
    velocity.set(0, 0, 0);
    grounded = true;
    for (const side of SIDES) {
      const web = webs[side];
      web.attached = false;
      web.aim = web.tooFar = null;
      web.line.visible = web.reticle.visible = false;
    }
  }

  function attach(side, hit) {
    const web = webs[side];
    web.attached = true;
    web.anchor.copy(hit.point);
    chest.copy(rig.position).y += CHEST_HEIGHT;
    web.length = Math.max(MIN_ROPE, chest.distanceTo(web.anchor) * 0.95);
    toAnchor.subVectors(web.anchor, chest).normalize();
    if (grounded) {
      // Yank off the ground so the swing can start.
      velocity.addScaledVector(toAnchor, 8);
      velocity.y += 4;
      grounded = false;
    } else {
      velocity.addScaledVector(toAnchor, 3);
    }
    input.pulse(side, 0.7, 50);
  }

  function collide(prevY) {
    const p = rig.position;
    grounded = false;

    for (const b of city.colliders) {
      if (p.y >= b.top) continue;
      if (p.x <= b.minX - RADIUS || p.x >= b.maxX + RADIUS || p.z <= b.minZ - RADIUS || p.z >= b.maxZ + RADIUS) continue;

      // Came from above: land on the roof.
      if (prevY >= b.top - 0.05) {
        p.y = b.top;
        if (velocity.y < 0) velocity.y = 0;
        grounded = true;
        continue;
      }

      // Otherwise push out through the closest wall and stop moving into it.
      const pushes = [b.minX - RADIUS - p.x, b.maxX + RADIUS - p.x, b.minZ - RADIUS - p.z, b.maxZ + RADIUS - p.z];
      let k = 0;
      for (let i = 1; i < 4; i++) if (Math.abs(pushes[i]) < Math.abs(pushes[k])) k = i;
      if (k < 2) {
        p.x += pushes[k];
        if ((k === 0 && velocity.x > 0) || (k === 1 && velocity.x < 0)) velocity.x = 0;
      } else {
        p.z += pushes[k];
        if ((k === 2 && velocity.z > 0) || (k === 3 && velocity.z < 0)) velocity.z = 0;
      }
    }

    const ground = city.groundHeightAt(p.x, p.z);
    if (p.y <= ground) {
      p.y = ground;
      if (velocity.y < 0) velocity.y = 0;
      grounded = true;
    }

    for (const axis of ['x', 'z']) {
      if (Math.abs(p[axis]) > city.bounds) {
        p[axis] = Math.sign(p[axis]) * city.bounds;
        velocity[axis] = 0;
      }
    }
  }

  function step(h) {
    const swinging = webs.left.attached || webs.right.attached;

    velocity.y -= GRAVITY * h;
    if (grounded && !swinging) {
      velocity.x = wish.x * WALK_SPEED;
      velocity.z = wish.z * WALK_SPEED;
    } else {
      velocity.addScaledVector(wish, AIR_CONTROL * h);
      velocity.multiplyScalar(1 - AIR_DRAG * h);
    }

    chest.copy(rig.position).y += CHEST_HEIGHT;
    for (const side of SIDES) {
      const web = webs[side];
      if (!web.attached) continue;
      const reeling = input.hands[side].grip;
      web.length = Math.max(MIN_ROPE, web.length - (reeling ? REEL_SPEED : AUTO_REEL) * h);
      if (reeling) velocity.addScaledVector(toAnchor.subVectors(web.anchor, chest).normalize(), REEL_PULL * h);
    }
    if (velocity.length() > MAX_SPEED) velocity.setLength(MAX_SPEED);

    const prevY = rig.position.y;
    rig.position.addScaledVector(velocity, h);

    // Rope constraint: never further from the anchor than the web is long.
    // Removing the outward part of the velocity is what turns falling into swinging.
    for (const side of SIDES) {
      const web = webs[side];
      if (!web.attached) continue;
      chest.copy(rig.position).y += CHEST_HEIGHT;
      toAnchor.subVectors(chest, web.anchor);
      const distance = toAnchor.length();
      if (distance <= web.length) continue;
      toAnchor.divideScalar(distance);
      rig.position.addScaledVector(toAnchor, web.length - distance);
      const outward = velocity.dot(toAnchor);
      if (outward > 0) velocity.addScaledVector(toAnchor, -outward);
    }

    collide(prevY);
  }

  function updateVisuals() {
    rig.updateMatrixWorld(true);
    for (const side of SIDES) {
      const web = webs[side];
      const { aim, tooFar, line, reticle } = web;

      // White dot: the web will stick there. Red dot: that building is out of range.
      const target = aim || tooFar;
      reticle.visible = !!target && !web.attached;
      if (reticle.visible) {
        reticle.material = aim ? reticleMaterial : tooFarMaterial;
        reticle.position.copy(target.point);
        reticle.scale.setScalar(Math.max(0.04, target.distance * 0.007));
      }
      if (aim) input.setRay(side, aim.distance, 0xffffff);
      else if (tooFar) input.setRay(side, WEB_RANGE, 0xff3b3f);
      else input.setRay(side, 1.5, 0x777777);

      line.visible = web.attached;
      if (web.attached) {
        input.getHandPosition(side, handPosition);
        line.position.copy(handPosition);
        line.lookAt(web.anchor);
        line.scale.set(1, 1, handPosition.distanceTo(web.anchor));
      }
    }
  }

  function update(dt) {
    for (const side of SIDES) {
      const web = webs[side];
      const hand = input.hands[side];
      const hit = input.getAimRay(side, ray) ? raycastBuildings(ray, LOOK_RANGE, city.colliders) : null;
      web.aim = hit && hit.distance <= WEB_RANGE ? hit : null;
      web.tooFar = hit && !web.aim ? hit : null;
      if (hand.triggerDown && !web.attached) {
        if (web.aim) attach(side, web.aim);
        else if (web.tooFar) input.pulse(side, 0.15, 20); // a short buzz: too far, nothing happens
      }
      if (!hand.trigger) web.attached = false;
    }

    if (input.jumpDown && grounded) {
      velocity.y = JUMP_SPEED;
      grounded = false;
    }

    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, UP);
    wish.set(0, 0, 0).addScaledVector(forward, -input.move.y).addScaledVector(right, input.move.x);

    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) step(dt / steps);

    if (rig.position.y < -30) reset();
    updateVisuals();
  }

  return {
    reset,
    update,
    hasTarget: () => !!(webs.left.aim || webs.right.aim),
    targetTooFar: () => !!(webs.left.tooFar || webs.right.tooFar),
  };
}
