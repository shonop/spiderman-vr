import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorld } from './world.js';
import { setupControllers } from './controllers.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 0.5);

// The rig is the player's body: moving or rotating it moves the headset and controllers together.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

const { grabbables } = createWorld(scene);
const controllers = setupControllers(renderer, rig, camera, grabbables);

// Mouse controls for testing on the PC without a headset.
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.9, -1);
orbit.update();

renderer.xr.addEventListener('sessionstart', () => (orbit.enabled = false));
renderer.xr.addEventListener('sessionend', () => (orbit.enabled = true));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  if (renderer.xr.isPresenting) controllers.update(delta);
  renderer.render(scene, camera);
});
