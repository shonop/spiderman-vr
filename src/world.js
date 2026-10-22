import * as THREE from 'three';

// Builds the static environment and returns the group of grabbable objects.
export function createWorld(scene) {
  scene.background = new THREE.Color(0x1a1d29);
  scene.fog = new THREE.Fog(0x1a1d29, 10, 40);

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x30260f, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a3f55, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 40, 0x6c7bd1, 0x4a5070);
  grid.position.y = 0.001;
  scene.add(grid);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.05, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 }),
  );
  table.position.set(0, 0.8, -1);
  table.castShadow = table.receiveShadow = true;
  scene.add(table);

  // Everything inside this group can be picked up with the controllers.
  const grabbables = new THREE.Group();
  scene.add(grabbables);

  const geometries = [
    new THREE.BoxGeometry(0.15, 0.15, 0.15),
    new THREE.SphereGeometry(0.09, 32, 16),
    new THREE.ConeGeometry(0.08, 0.18, 32),
    new THREE.TorusGeometry(0.07, 0.03, 16, 48),
    new THREE.IcosahedronGeometry(0.09),
  ];

  geometries.forEach((geometry, i) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(i / geometries.length, 0.7, 0.55),
        roughness: 0.4,
        metalness: 0.1,
      }),
    );
    mesh.position.set(-0.6 + i * 0.3, 0.92, -1);
    mesh.castShadow = true;
    grabbables.add(mesh);
  });

  return { grabbables };
}
