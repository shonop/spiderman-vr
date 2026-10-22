import * as THREE from 'three';

// Sun and sky. The sun sits behind the player's right shoulder when they look at the menu.
export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.6, 0.58).normalize();
const ZENITH = new THREE.Color(0.1, 0.28, 0.62);
const HORIZON = new THREE.Color(0.62, 0.74, 0.86);
const EXPOSURE = 1;

const SHADOW_SIZE = 140; // meters around the player that get real shadows
const SHADOW_SNAP = 16; // the shadow map is only redrawn after the player moves this far

const skyShader = {
  uniforms: {
    sunDirection: { value: SUN_DIRECTION },
    zenith: { value: ZENITH },
    horizon: { value: HORIZON },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDirection;
    void main() {
      vDirection = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 sunDirection;
    uniform vec3 zenith;
    uniform vec3 horizon;
    varying vec3 vDirection;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 6; i++) {
        value += amplitude * noise(p);
        p = p * 2.03 + vec2(1.7, 9.2);
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec3 d = normalize(vDirection);
      float up = max(d.y, 0.0);
      float sun = max(dot(d, sunDirection), 0.0);

      vec3 color = mix(horizon, zenith, pow(up, 0.55));
      if (d.y < 0.0) color = horizon * mix(1.0, 0.75, min(-d.y * 3.0, 1.0));
      color += vec3(1.0, 0.82, 0.55) * (pow(sun, 6.0) * 0.25 + pow(sun, 60.0) * 0.6);

      // Clouds painted on a flat layer high above the city.
      if (d.y > 0.0) {
        vec2 uv = d.xz / (d.y + 0.12) * 1.3;
        float cover = smoothstep(0.48, 0.78, fbm(uv));
        float light = fbm(uv * 1.7 + 4.0);
        vec3 cloud = mix(vec3(0.62, 0.66, 0.74), vec3(1.25, 1.2, 1.12), light);
        cloud += vec3(1.0, 0.85, 0.6) * pow(sun, 5.0) * 0.8;
        color = mix(color, cloud, cover * smoothstep(0.0, 0.2, d.y) * 0.9);
      }

      color += vec3(30.0, 27.0, 22.0) * smoothstep(0.99985, 0.99993, sun);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// Same math as three.js' ACES tone mapping, so the fog can be the exact color of the
// horizon on screen (three.js mixes fog in after tone mapping).
function acesFilmic(color) {
  const v = color.clone().multiplyScalar(EXPOSURE / 0.6);
  const r = 0.59719 * v.r + 0.35458 * v.g + 0.04823 * v.b;
  const g = 0.076 * v.r + 0.90834 * v.g + 0.01566 * v.b;
  const b = 0.0284 * v.r + 0.13383 * v.g + 0.83777 * v.b;
  const fit = (x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  const [fr, fg, fb] = [fit(r), fit(g), fit(b)];
  const clamp = (x) => Math.min(1, Math.max(0, x));
  return new THREE.Color().setRGB(
    clamp(1.60475 * fr - 0.53108 * fg - 0.07367 * fb),
    clamp(-0.10208 * fr + 1.10813 * fg - 0.00605 * fb),
    clamp(-0.00327 * fr - 0.07276 * fg + 1.07602 * fb),
    THREE.LinearSRGBColorSpace,
  );
}

// Sky, sun, shadows and haze. Returns the sky as a cube map so glass and water can reflect it.
export function createEnvironment(renderer, scene) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  // The sky never changes, so it is drawn once into a cube map.
  const skyTarget = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
  const skyScene = new THREE.Scene();
  skyScene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 10),
      new THREE.ShaderMaterial({ ...skyShader, side: THREE.BackSide, depthWrite: false }),
    ),
  );
  new THREE.CubeCamera(0.1, 100, skyTarget).update(renderer, skyScene);
  const skyMap = skyTarget.texture;
  scene.background = skyMap;

  scene.fog = new THREE.FogExp2(acesFilmic(HORIZON), 0.0019);

  scene.add(new THREE.HemisphereLight(0xc4dcff, 0x6b5d4f, 1.25));

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_SIZE,
    right: SHADOW_SIZE,
    top: SHADOW_SIZE,
    bottom: -SHADOW_SIZE,
    near: 1,
    far: 700,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const shadowCenter = new THREE.Vector3(Infinity, 0, 0);

  // Only buildings and street furniture cast shadows, and they never move, so the shadow map
  // is redrawn only when the player has traveled far enough to need a new area.
  function update(playerPosition) {
    const x = Math.round(playerPosition.x / SHADOW_SNAP) * SHADOW_SNAP;
    const z = Math.round(playerPosition.z / SHADOW_SNAP) * SHADOW_SNAP;
    if (x === shadowCenter.x && z === shadowCenter.z) return;
    shadowCenter.set(x, 0, z);
    sun.target.position.copy(shadowCenter);
    sun.position.copy(shadowCenter).addScaledVector(SUN_DIRECTION, 350);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }

  return { skyMap, update };
}

// Small additions to three.js' Lambert shader:
// - groundShade: walls get darker near the street, like light blocked by everything around them.
// - fresnel: glass reflects more of the sky when seen at a grazing angle.
export function patchMaterial(material, { groundShade = false, fresnel = false } = {}) {
  material.onBeforeCompile = (shader) => {
    if (groundShade) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 shadeWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            shadeWorld = instanceMatrix * shadeWorld;
          #endif
          vHeight = (modelMatrix * shadeWorld).y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;')
        .replace(
          '#include <envmap_fragment>',
          `#include <envmap_fragment>
          outgoingLight *= mix(0.55, 1.0, smoothstep(0.0, 9.0, vHeight));`,
        );
    }
    if (fresnel) {
      shader.fragmentShader = shader.fragmentShader.replace(
        'outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );',
        `float facing = 1.0 - abs(dot(cameraToFrag, worldNormal));
        float fresnelTerm = 0.25 + 0.75 * pow(facing, 3.0);
        outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity * fresnelTerm );`,
      );
    }
  };
  material.customProgramCacheKey = () => `patched-${groundShade}-${fresnel}`;
  return material;
}

// Small street and roof details are split into square chunks of the city, and a chunk is
// hidden when the player is far from it. Buildings themselves are always drawn.
export const CHUNK_SIZE = 108; // two blocks
export const DETAIL_DISTANCE = 200;
const hidable = [];

// Splits items into chunks by their x/z position.
export function groupByChunk(items, positionOf) {
  const chunks = new Map();
  for (const item of items) {
    const [x, z] = positionOf(item);
    const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(item);
  }
  return [...chunks.values()];
}

// Center of a geometry on the ground plane, for groupByChunk.
export function geometryCenter(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [(min.x + max.x) / 2, (min.z + max.z) / 2];
}

// Call after the object's matrices (and instance matrices) are final.
// `from` lets a cheap far-away version take over where the detailed one is hidden.
export function hideBeyond(object, distance = DETAIL_DISTANCE, from = 0) {
  const box = new THREE.Box3();
  if (object.isInstancedMesh) {
    object.computeBoundingBox();
    box.copy(object.boundingBox);
  } else {
    object.geometry.computeBoundingBox();
    box.copy(object.geometry.boundingBox);
  }
  object.updateMatrixWorld();
  box.applyMatrix4(object.matrixWorld);
  hidable.push({ object, box, distanceSq: distance * distance, fromSq: from * from });
}

export function updateHidden(viewer) {
  for (const { object, box, distanceSq, fromSq } of hidable) {
    const dx = Math.max(box.min.x - viewer.x, 0, viewer.x - box.max.x);
    const dz = Math.max(box.min.z - viewer.z, 0, viewer.z - box.max.z);
    const d = dx * dx + dz * dz;
    object.visible = d < distanceSq && d >= fromSq;
  }
}
