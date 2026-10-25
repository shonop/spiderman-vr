import * as THREE from 'three';

export const SIDES = ['left', 'right'];
// three.js gives each input source a slot and ignores sources once the slots are full. The Quest
// can report more than two for a moment (a controller waking up before the hand it replaces is
// gone), and with only two slots that controller would stay dead until leaving VR.
export const MAX_SOURCES = 4;
const DEADZONE = 0.2;
const TURN_SPEED = 2.6; // radians per second with the right stick all the way over
const MOUSE_SENSITIVITY = 0.0022;

const deadzone = (v) => (Math.abs(v) < DEADZONE ? 0 : v);

// One place that reads the VR controllers or the keyboard + mouse, so the game logic
// doesn't care which one is being used.
//
// VR:      trigger = web, grip = pull, left stick = walk, right stick = turn, A/X = jump
// Desktop: left/right mouse (or Q/E) = web, Shift = pull, WASD = walk, Space = jump, F / middle click = punch
// (In VR, punching is just swinging your real hands, see enemies.js.)
export function createInput(renderer, rig, camera) {
  const dom = renderer.domElement;
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

  const controllers = [];
  for (let i = 0; i < MAX_SOURCES; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('connected', (e) => (controller.userData.source = e.data));
    controller.addEventListener('disconnected', () => (controller.userData.source = null));
    const ray = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false }));
    controller.add(ray);
    controller.userData.ray = ray;
    rig.add(controller);
    controllers.push(controller);
  }

  const hands = {};
  // trigger/grip are pressed or not; the values (0..1) and touches drive the fingers (hands.js).
  for (const side of SIDES) {
    hands[side] = {
      trigger: false,
      triggerDown: false,
      grip: false,
      triggerValue: 0,
      gripValue: 0,
      indexTouched: true,
      thumbTouched: true,
      controller: null,
      source: null,
    };
  }

  const move = new THREE.Vector2();
  const mouse = new THREE.Vector2();
  const keys = new Set();
  const mouseButtons = new Set();
  let jumpHeld = false;
  let punchHeld = false;
  const headBefore = new THREE.Vector3();
  const headAfter = new THREE.Vector3();

  const isLocked = () => document.pointerLockElement === dom;

  const api = {
    hands,
    move,
    mouse,
    jumpDown: false,
    punchDown: false,
    onDesktopClick: null,
    update,
    getAimRay,
    getHandPosition,
    setRay,
    pulse,
  };

  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    mouseButtons.clear();
  });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  const updateMouse = (e) => mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  dom.addEventListener('mousemove', (e) => {
    updateMouse(e);
    if (!isLocked()) return;
    rig.rotation.y -= e.movementX * MOUSE_SENSITIVITY;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * MOUSE_SENSITIVITY, -1.5, 1.5);
  });
  dom.addEventListener('mousedown', (e) => {
    updateMouse(e);
    if (isLocked()) mouseButtons.add(e.button);
    else api.onDesktopClick?.(e);
  });
  window.addEventListener('mouseup', (e) => mouseButtons.delete(e.button));
  document.addEventListener('pointerlockchange', () => {
    if (!isLocked()) mouseButtons.clear();
  });

  function update(dt) {
    rig.updateMatrixWorld(true);
    const pressed = { left: [false, false], right: [false, false] };
    let jump = false;
    let punch = false;
    let turn = 0;

    if (renderer.xr.isPresenting) {
      move.set(0, 0);
      for (const side of SIDES) hands[side].controller = hands[side].source = null;
      for (const controller of controllers) {
        controller.userData.ray.visible = false;
        const source = controller.userData.source;
        const hand = hands[source?.handedness];
        // one controller per hand; tracked hands without a controller aren't supported
        if (!hand || !source.gamepad || source.hand || hand.controller) continue;
        controller.userData.ray.visible = true;
        const { buttons, axes } = source.gamepad;
        hand.controller = controller;
        hand.source = source;
        pressed[source.handedness] = [!!buttons[0]?.pressed, !!buttons[1]?.pressed];
        hand.triggerValue = buttons[0]?.value ?? 0;
        hand.gripValue = buttons[1]?.value ?? 0;
        hand.indexTouched = !!(buttons[0]?.touched || buttons[0]?.value > 0.05);
        // the thumb rests on the stick, the face buttons or the thumb rest
        hand.thumbTouched = [3, 4, 5, 6].some((i) => buttons[i]?.touched || buttons[i]?.pressed);
        jump ||= !!buttons[4]?.pressed;
        if (source.handedness === 'left') move.set(deadzone(axes[2] ?? 0), deadzone(axes[3] ?? 0));
        else turn = axes[2] ?? 0;
      }
    } else {
      const locked = isLocked();
      const reel = keys.has('ShiftLeft') || keys.has('ShiftRight');
      move.set(
        (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
        (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
      );
      if (move.lengthSq() > 1) move.normalize();
      pressed.left = [(locked && mouseButtons.has(0)) || keys.has('KeyQ'), reel];
      pressed.right = [(locked && mouseButtons.has(2)) || keys.has('KeyE'), reel];
      jump = keys.has('Space');
      punch = keys.has('KeyF') || (locked && mouseButtons.has(1));
    }

    for (const side of SIDES) {
      const hand = hands[side];
      const [trigger, grip] = pressed[side];
      if (!renderer.xr.isPresenting) {
        hand.triggerValue = trigger ? 1 : 0;
        hand.gripValue = grip ? 1 : 0;
        hand.indexTouched = hand.thumbTouched = true;
      }
      hand.triggerDown = trigger && !hand.trigger;
      hand.trigger = trigger;
      hand.grip = grip;
    }
    api.jumpDown = jump && !jumpHeld;
    jumpHeld = jump;
    api.punchDown = punch && !punchHeld;
    punchHeld = punch;

    // Smooth turning around the head (not around the middle of the play area), so turning
    // doesn't also slide the player sideways.
    turn = deadzone(turn);
    if (turn) {
      camera.getWorldPosition(headBefore);
      const speed = (Math.abs(turn) - DEADZONE) / (1 - DEADZONE);
      rig.rotation.y -= Math.sign(turn) * speed * TURN_SPEED * dt;
      rig.updateMatrixWorld(true);
      camera.getWorldPosition(headAfter);
      rig.position.x += headBefore.x - headAfter.x;
      rig.position.z += headBefore.z - headAfter.z;
    }
    rig.updateMatrixWorld(true);
  }

  // Where a hand is aiming. On desktop both hands aim where the camera looks.
  function getAimRay(side, ray) {
    if (!renderer.xr.isPresenting) {
      camera.getWorldPosition(ray.origin);
      camera.getWorldDirection(ray.direction);
      return true;
    }
    const controller = hands[side].controller;
    if (!controller) return false;
    ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
    return true;
  }

  // Where the web visually comes out of. On desktop it's the bottom corner of the screen.
  function getHandPosition(side, out) {
    const controller = renderer.xr.isPresenting && hands[side].controller;
    if (controller) return controller.getWorldPosition(out);
    out.set(side === 'left' ? -0.3 : 0.3, -0.35, -0.4);
    return camera.localToWorld(out);
  }

  function setRay(side, length, color) {
    const ray = hands[side].controller?.userData.ray;
    if (!ray) return;
    ray.scale.z = length;
    ray.material.color.setHex(color);
  }

  function pulse(side, intensity, duration) {
    hands[side].source?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, duration);
  }

  return api;
}
