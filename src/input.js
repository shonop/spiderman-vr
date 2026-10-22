import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export const SIDES = ['left', 'right'];
const DEADZONE = 0.2;
const SNAP_ANGLE = Math.PI / 6;
const MOUSE_SENSITIVITY = 0.0022;

const deadzone = (v) => (Math.abs(v) < DEADZONE ? 0 : v);

// One place that reads the VR controllers or the keyboard + mouse, so the game logic
// doesn't care which one is being used.
//
// VR:      trigger = web, grip = pull, left stick = walk, right stick = snap turn, A/X = jump
// Desktop: left/right mouse (or Q/E) = web, Shift = pull, WASD = walk, Space = jump
export function createInput(renderer, rig, camera) {
  const dom = renderer.domElement;
  const modelFactory = new XRControllerModelFactory();
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

  const controllers = [];
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('connected', (e) => (controller.userData.source = e.data));
    controller.addEventListener('disconnected', () => (controller.userData.source = null));
    const ray = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, toneMapped: false }));
    controller.add(ray);
    controller.userData.ray = ray;
    rig.add(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(modelFactory.createControllerModel(grip));
    rig.add(grip);
    controllers.push(controller);
  }

  const hands = {};
  for (const side of SIDES) hands[side] = { trigger: false, triggerDown: false, grip: false, controller: null, source: null };

  const move = new THREE.Vector2();
  const mouse = new THREE.Vector2();
  const keys = new Set();
  const mouseButtons = new Set();
  let jumpHeld = false;
  let snapReady = true;

  const isLocked = () => document.pointerLockElement === dom;

  const api = {
    hands,
    move,
    mouse,
    jumpDown: false,
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

  function update() {
    rig.updateMatrixWorld(true);
    const pressed = { left: [false, false], right: [false, false] };
    let jump = false;
    let turn = 0;

    if (renderer.xr.isPresenting) {
      move.set(0, 0);
      for (const side of SIDES) hands[side].controller = hands[side].source = null;
      for (const controller of controllers) {
        const source = controller.userData.source;
        const hand = hands[source?.handedness];
        if (!hand || !source.gamepad) continue;
        const { buttons, axes } = source.gamepad;
        hand.controller = controller;
        hand.source = source;
        pressed[source.handedness] = [!!buttons[0]?.pressed, !!buttons[1]?.pressed];
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
    }

    for (const side of SIDES) {
      const hand = hands[side];
      const [trigger, grip] = pressed[side];
      hand.triggerDown = trigger && !hand.trigger;
      hand.trigger = trigger;
      hand.grip = grip;
    }
    api.jumpDown = jump && !jumpHeld;
    jumpHeld = jump;

    if (Math.abs(turn) > 0.7 && snapReady) {
      rig.rotation.y -= Math.sign(turn) * SNAP_ANGLE;
      snapReady = false;
    } else if (Math.abs(turn) < 0.3) {
      snapReady = true;
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
