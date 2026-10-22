import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const MOVE_SPEED = 2; // meters per second
const SNAP_ANGLE = Math.PI / 6; // 30 degrees
const DEADZONE = 0.2;

// Sets up both VR controllers: ray pointers, trigger-to-grab, and thumbstick locomotion.
//   Left stick  -> walk (relative to where you look)
//   Right stick -> snap turn
//   Trigger     -> grab / release
export function setupControllers(renderer, rig, camera, grabbables) {
  const modelFactory = new XRControllerModelFactory();
  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const controllers = [];

  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('connected', (e) => (controller.userData.inputSource = e.data));
    controller.addEventListener('disconnected', () => (controller.userData.inputSource = null));
    controller.addEventListener('selectstart', () => grab(controller));
    controller.addEventListener('selectend', () => release(controller));

    const ray = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
    ray.scale.z = 5;
    controller.add(ray);
    controller.userData.ray = ray;
    rig.add(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(modelFactory.createControllerModel(grip));
    rig.add(grip);

    controllers.push(controller);
  }

  function intersect(controller) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    return raycaster.intersectObjects(grabbables.children, false);
  }

  function grab(controller) {
    const hit = intersect(controller)[0];
    if (!hit) return;
    const object = hit.object;
    object.material.emissive.setHex(0x333333);
    controller.attach(object);
    controller.userData.held = object;
  }

  function release(controller) {
    const object = controller.userData.held;
    if (!object) return;
    object.material.emissive.setHex(0x000000);
    grabbables.attach(object);
    controller.userData.held = null;
  }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let snapReady = true;

  function update(delta) {
    for (const controller of controllers) {
      // Shorten the ray to whatever it is pointing at.
      const hit = controller.userData.held ? null : intersect(controller)[0];
      controller.userData.ray.scale.z = hit ? hit.distance : 5;

      const source = controller.userData.inputSource;
      const axes = source?.gamepad?.axes;
      if (!axes || axes.length < 4) continue;
      const x = axes[2];
      const y = axes[3];

      if (source.handedness === 'left') {
        if (Math.abs(x) < DEADZONE && Math.abs(y) < DEADZONE) continue;
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, up);
        rig.position.addScaledVector(forward, -y * MOVE_SPEED * delta);
        rig.position.addScaledVector(right, x * MOVE_SPEED * delta);
      } else if (source.handedness === 'right') {
        if (Math.abs(x) > 0.7 && snapReady) {
          rig.rotation.y -= Math.sign(x) * SNAP_ANGLE;
          snapReady = false;
        } else if (Math.abs(x) < 0.3) {
          snapReady = true;
        }
      }
    }
  }

  return { update };
}
