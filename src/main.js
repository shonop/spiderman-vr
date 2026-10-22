import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createCity } from './city.js';
import { createTraffic } from './traffic.js';
import { createPeople } from './people.js';
import { createInput, SIDES } from './input.js';
import { createMenu } from './menu.js';
import { createPlayer } from './player.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 600);
camera.position.set(0, 1.6, 0);

// The rig is the player's body: moving or rotating it moves the headset and controllers together.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

const city = createCity(scene);
const traffic = createTraffic(scene);
const people = createPeople(scene);
const input = createInput(renderer, rig, camera);
const player = createPlayer({ scene, rig, camera, input, city });
const menu = createMenu({ onPlay: startGame });
scene.add(menu.root);

const raycaster = new THREE.Raycaster();
const hud = document.getElementById('hud');
const crosshair = document.getElementById('crosshair');
let state = 'menu';

function openMenu() {
  state = 'menu';
  player.reset();
  menu.show('main');
  menu.root.visible = true;
  menu.root.position.copy(city.spawn).add(new THREE.Vector3(0, 1.5, -2.2));
}

function startGame() {
  state = 'playing';
  menu.root.visible = false;
  renderer.domElement.style.cursor = 'default';
  if (!renderer.xr.isPresenting) lockPointer();
}

function lockPointer() {
  renderer.domElement.requestPointerLock()?.catch?.(() => {});
}

input.onDesktopClick = () => {
  if (state === 'menu') {
    raycaster.setFromCamera(input.mouse, camera);
    menu.pick(raycaster)?.button.userData.onClick();
  } else {
    lockPointer();
  }
};

renderer.xr.addEventListener('sessionstart', () => document.exitPointerLock());
renderer.xr.addEventListener('sessionend', () => {
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function updateMenu() {
  const hovered = new Set();
  if (renderer.xr.isPresenting) {
    for (const side of SIDES) {
      if (!input.getAimRay(side, raycaster.ray)) continue;
      const hit = menu.pick(raycaster);
      input.setRay(side, hit ? hit.distance : 3, 0xffffff);
      if (!hit) continue;
      hovered.add(hit.button);
      if (input.hands[side].triggerDown) {
        input.pulse(side, 0.4, 30);
        hit.button.userData.onClick();
        break;
      }
    }
  } else {
    raycaster.setFromCamera(input.mouse, camera);
    const hit = menu.pick(raycaster);
    if (hit) hovered.add(hit.button);
    renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
  }
  menu.setHovered(hovered);
}

const HUD_TEXT = {
  menu: 'Click PLAY to start · To play in the headset press ENTER VR',
  unlocked: 'Click to play',
  playing: 'WASD move · Space jump · Left / right click = web · Hold Shift = pull · Esc = free mouse',
};

function updateHud() {
  const desktop = !renderer.xr.isPresenting;
  const locked = document.pointerLockElement === renderer.domElement;
  const text = state === 'menu' ? HUD_TEXT.menu : locked ? HUD_TEXT.playing : HUD_TEXT.unlocked;
  if (hud.textContent !== text) hud.textContent = text;
  hud.style.display = desktop ? 'block' : 'none';
  crosshair.style.display = desktop && state === 'playing' && locked ? 'block' : 'none';
  crosshair.classList.toggle('target', player.hasTarget());
}

openMenu();

// Handy for poking at the game from the browser console while developing.
if (import.meta.env.DEV) window.game = { scene, rig, camera, player, input, menu, city, people };

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  input.update();
  if (state === 'menu') updateMenu();
  else player.update(dt);
  traffic.update(dt, rig.position);
  people.update(dt);
  updateHud();
  renderer.render(scene, camera);
});
