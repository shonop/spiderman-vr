import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom, paint, pick } from './utils.js';
import { patchMaterial } from './graphics.js';
import {
  FLOOR,
  createFacades,
  createStorefrontTexture,
  createAsphaltTexture,
  createPavingTexture,
  createRoofTexture,
} from './textures.js';

// City layout: a BLOCKS x BLOCKS grid of blocks with roads between and around them.
export const BLOCKS = 7;
export const BLOCK = 40;
export const ROAD = 14;
export const PITCH = BLOCK + ROAD;
export const HALF = (BLOCKS * PITCH + ROAD) / 2;
export const SIDEWALK_HEIGHT = 0.12;
const SIDEWALK = 4;

const STOREFRONT = 5; // height of the shop floor at the bottom of every building
const CAP = 0.7; // cornice on top of every building
const PROMENADE = 22; // walkway along the water around the city
const WATER_LEVEL = -1.6;

export const roadCenter = (j) => -HALF + j * PITCH + ROAD / 2;
export const blockCenter = (i) => -HALF + i * PITCH + ROAD + BLOCK / 2;

// How each facade style repeats sideways (meters), and the colors its walls come in.
const STYLES = {
  glass: { module: 1.5, tints: ['#e9eef2', '#d4e0e8', '#c4d2dc', '#e2e2da'], trim: '#8a939b' },
  office: { module: 8, tints: ['#efeee9', '#dcdad2', '#cdd0d5', '#e8dece', '#c9c4ba'], trim: '#d6d3cb' },
  classic: { module: 4, tints: ['#b8694e', '#a35a44', '#c9a27e', '#dbcbad', '#94503d', '#c6b69c', '#8f6f5a'], trim: '#e3dccd' },
  residential: { module: 6, tints: ['#eadcc4', '#d9c6a6', '#c9d1d6', '#e5d3c2', '#cdb99f', '#d6dccf'], trim: '#ece8df' },
};

function chooseStyle(random, height) {
  if (height > 75) return random() < 0.65 ? 'glass' : 'office';
  if (height > 40) return pick(random, ['glass', 'office', 'office', 'classic']);
  if (height > 22) return pick(random, ['office', 'classic', 'classic', 'residential']);
  return pick(random, ['classic', 'residential', 'residential']);
}

// Box whose four walls are textured with a repeating facade.
// `uOf(faceWidth, u)` maps the box's 0..1 u to texture u; v is measured in meters / tileHeight.
function facadeBox(width, height, depth, tileHeight, uOf) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceWidths = [depth, depth, 0, 0, width, width];
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      if (faceWidths[face] === 0) uv.setXY(i, 0.02, 0.02);
      else uv.setXY(i, uOf(faceWidths[face], uv.getX(i)), (uv.getY(i) * height) / tileHeight);
    }
  }
  return geometry;
}

// Texture coordinates taken from world position, for surfaces that tile seamlessly.
function worldUV(geometry, metersPerTile) {
  const { position, normal, uv } = geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const [nx, ny] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i))];
    if (ny > 0.5) uv.setXY(i, x / metersPerTile, z / metersPerTile);
    else if (nx > 0.5) uv.setXY(i, z / metersPerTile, y / metersPerTile);
    else uv.setXY(i, x / metersPerTile, y / metersPerTile);
  }
  return geometry;
}

const box = (w, h, d, x, y, z, color) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const cylinder = (rTop, rBottom, h, segments, x, y, z, color) =>
  paint(new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(x, y, z), color);

// Builds the whole city and returns what the player physics needs to know about it.
export function createCity(scene, skyMap) {
  const random = createRandom(1337); // building layout (same city as always)
  const looks = createRandom(4242); // styles, colors and rooftop clutter

  const facades = createFacades();
  const facadeGeometries = { glass: [], office: [], classic: [], residential: [] };
  const storefrontGeometries = [];
  const trimGeometries = [];
  const roofGeometries = [];
  const sidewalkGeometries = [];
  const colliders = [];
  const middle = Math.floor(BLOCKS / 2);
  let spawn;

  function addCollider(x, z, width, depth, top) {
    colliders.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, top });
  }

  // One stack of floors with a cornice and a gravel roof on top. Returns the roof height.
  function addSection(x, z, width, depth, bottom, floors, style, tint, withShops) {
    const { module, trim } = STYLES[style];
    const facade = facades[style];
    let y = bottom;

    if (withShops) {
      const shop = Math.floor(looks() * 8);
      const shopsU = (faceWidth, u) => (shop * 6 + u * Math.max(1, Math.round(faceWidth / 6)) * 6) / 48;
      storefrontGeometries.push(
        facadeBox(width, STOREFRONT, depth, STOREFRONT, shopsU).translate(x, y + STOREFRONT / 2, z),
      );
      trimGeometries.push(box(width + 0.5, 0.3, depth + 0.5, x, y + STOREFRONT - 0.05, z, trim));
      y += STOREFRONT;
    }

    const height = floors * FLOOR;
    const facadeU = (faceWidth, u) => 0.5 + ((u - 0.5) * Math.max(1, Math.round(faceWidth / module)) * module) / facade.width;
    facadeGeometries[style].push(
      paint(facadeBox(width, height, depth, facade.height, facadeU).translate(x, y + height / 2, z), tint),
    );
    y += height;

    trimGeometries.push(box(width + 0.5, CAP, depth + 0.5, x, y + CAP / 2, z, trim));
    y += CAP;
    roofGeometries.push(
      worldUV(new THREE.PlaneGeometry(width - 0.2, depth - 0.2).rotateX(-Math.PI / 2).translate(x, y + 0.02, z), 4),
    );
    addCollider(x, z, width, depth, y);
    return y;
  }

  // Air conditioners, stair houses, water tanks and antennas, so roofs aren't empty slabs.
  function addRooftop(x, z, width, depth, roof, style, tallest) {
    const margin = 1.5;
    const place = (w, d) => [
      x + (looks() - 0.5) * Math.max(0, width - w - 2 * margin),
      z + (looks() - 0.5) * Math.max(0, depth - d - 2 * margin),
    ];
    const solid = (w, h, d, px, pz, color) => {
      trimGeometries.push(box(w, h, d, px, roof + h / 2, pz, color));
      addCollider(px, pz, w, d, roof + h);
    };

    if (width < 7 || depth < 7) return;
    const [bx, bz] = place(3, 3.6);
    solid(3, 2.8, 3.6, bx, bz, '#b7b3aa');
    trimGeometries.push(box(1.1, 2.1, 0.08, bx, roof + 1.05, bz + 1.82, '#59544d'));

    const units = Math.floor(looks() * 4);
    for (let k = 0; k < units; k++) {
      const w = 1.4 + looks() * 1.2;
      const d = 1.2 + looks() * 1;
      const [ax, az] = place(w, d);
      solid(w, 1.2, d, ax, az, '#d4d4d0');
      trimGeometries.push(cylinder(0.4, 0.4, 0.06, 12, ax, roof + 1.23, az, '#4b4d50'));
    }

    if ((style === 'classic' || style === 'residential') && looks() < 0.55) {
      const [tx, tz] = place(3.6, 3.6);
      for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
        trimGeometries.push(box(0.18, 2.6, 0.18, tx + lx, roof + 1.3, tz + lz, '#3b3632'));
      }
      trimGeometries.push(cylinder(1.7, 1.7, 3.4, 16, tx, roof + 4.3, tz, '#6e4c33'));
      trimGeometries.push(cylinder(0.05, 1.85, 1.4, 16, tx, roof + 6.7, tz, '#4a3a2e'));
      for (const band of [3.2, 4.4, 5.6]) trimGeometries.push(cylinder(1.73, 1.73, 0.08, 16, tx, roof + band, tz, '#2e2a27'));
      addCollider(tx, tz, 3.6, 3.6, roof + 7.4);
    }

    if (tallest && style === 'glass') {
      trimGeometries.push(cylinder(0.12, 0.25, 14, 8, x, roof + 7, z, '#c9cdd1'));
      trimGeometries.push(box(0.35, 0.35, 0.35, x, roof + 14.1, z, '#ff2a1a'));
    }
  }

  // A building of `height` meters (rounded to whole floors). Tall towers step back near the top.
  function addBuilding(x, z, width, depth, height, options = {}) {
    const style = options.style ?? chooseStyle(looks, height);
    const tint = pick(looks, STYLES[style].tints);
    const floors = Math.max(2, Math.round((height - STOREFRONT - CAP) / FLOOR));

    if (!options.flat && floors > 18 && width > 18 && depth > 18 && looks() < 0.8) {
      const lowerFloors = Math.round(floors * (0.45 + looks() * 0.2));
      const lowerRoof = addSection(x, z, width, depth, 0, lowerFloors, style, tint, true);
      const inset = 3 + looks() * 2;
      const roof = addSection(x, z, width - 2 * inset, depth - 2 * inset, lowerRoof, floors - lowerFloors, style, tint, false);
      addRooftop(x, z, width - 2 * inset, depth - 2 * inset, roof, style, true);
      return roof;
    }

    const roof = addSection(x, z, width, depth, 0, floors, style, tint, true);
    if (!options.flat) addRooftop(x, z, width, depth, roof, style, floors > 22);
    return roof;
  }

  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const cx = blockCenter(i);
      const cz = blockCenter(j);
      sidewalkGeometries.push(
        worldUV(new THREE.BoxGeometry(BLOCK, SIDEWALK_HEIGHT, BLOCK).translate(cx, SIDEWALK_HEIGHT / 2, cz), 2),
      );

      // Buildings get taller toward the middle of the city.
      const centerness = 1 - Math.max(Math.abs(i - middle), Math.abs(j - middle)) / (middle + 1);
      const lot = BLOCK - SIDEWALK * 2;

      if (i === middle && j === middle) {
        // The start building: a flat, empty roof where the menu floats.
        const roof = addBuilding(cx, cz, lot - 4, lot - 4, 60, { style: 'glass', flat: true });
        spawn = new THREE.Vector3(cx, roof, cz - 8);
        addHelipad(trimGeometries, cx, roof, cz + 3);
      } else if (random() < 0.3) {
        const size = lot - 2 - random() * 6;
        addBuilding(cx, cz, size, size, 35 + random() * 90 * centerness);
      } else {
        const sub = lot / 2;
        for (const ox of [-1, 1]) {
          for (const oz of [-1, 1]) {
            if (random() < 0.08) continue;
            addBuilding(
              cx + (ox * sub) / 2,
              cz + (oz * sub) / 2,
              sub - 2 - random() * 3,
              sub - 2 - random() * 3,
              10 + random() * (15 + 55 * centerness),
            );
          }
        }
      }
    }
  }

  const addMesh = (geometry, material, { cast = true, receive = true } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };

  for (const style of Object.keys(facadeGeometries)) {
    const facade = facades[style];
    addMesh(
      mergeGeometries(facadeGeometries[style]),
      patchMaterial(
        new THREE.MeshLambertMaterial({
          map: facade.map,
          specularMap: facade.mask,
          envMap: skyMap,
          combine: THREE.MixOperation,
          reflectivity: 0.7,
          vertexColors: true,
        }),
        { groundShade: true, fresnel: true },
      ),
    );
  }

  const storefront = createStorefrontTexture();
  addMesh(
    mergeGeometries(storefrontGeometries),
    patchMaterial(
      new THREE.MeshLambertMaterial({
        map: storefront.map,
        specularMap: storefront.mask,
        envMap: skyMap,
        combine: THREE.MixOperation,
        reflectivity: 0.6,
      }),
      { groundShade: true, fresnel: true },
    ),
  );
  addMesh(mergeGeometries(trimGeometries), new THREE.MeshLambertMaterial({ vertexColors: true }));
  addMesh(mergeGeometries(roofGeometries), new THREE.MeshLambertMaterial({ map: createRoofTexture() }), { cast: false });

  // The island: roads, sidewalks, a promenade with a sea wall, then water and a far shore.
  const paving = new THREE.MeshLambertMaterial({ map: createPavingTexture() });
  addMesh(mergeGeometries(sidewalkGeometries), paving, { cast: false });

  const asphalt = createAsphaltTexture();
  asphalt.repeat.set((HALF * 2) / 8, (HALF * 2) / 8);
  const ground = addMesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ map: asphalt }), {
    cast: false,
  });
  ground.rotation.x = -Math.PI / 2;

  const edge = HALF + PROMENADE;
  const wallDepth = SIDEWALK_HEIGHT - WATER_LEVEL + 1;
  const promenade = [];
  const railing = [];
  for (const side of [-1, 1]) {
    promenade.push(
      new THREE.BoxGeometry(edge * 2, wallDepth, PROMENADE).translate(0, SIDEWALK_HEIGHT - wallDepth / 2, side * (HALF + PROMENADE / 2)),
      new THREE.BoxGeometry(PROMENADE, wallDepth, HALF * 2).translate(side * (HALF + PROMENADE / 2), SIDEWALK_HEIGHT - wallDepth / 2, 0),
    );
    railing.push(
      box(edge * 2, 0.9, 0.35, 0, SIDEWALK_HEIGHT + 0.45, side * (edge - 0.2), '#a9a59c'),
      box(0.35, 0.9, edge * 2, side * (edge - 0.2), SIDEWALK_HEIGHT + 0.45, 0, '#a9a59c'),
    );
  }
  addMesh(worldUV(mergeGeometries(promenade), 2), paving, { cast: false });
  addMesh(mergeGeometries(railing), new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: false });

  scene.add(createWater(skyMap));
  scene.add(createSkyline(facades.office.map));

  const inBlock = (v) => {
    const local = v + HALF;
    return local >= 0 && local <= 2 * HALF && local % PITCH >= ROAD;
  };

  return {
    colliders,
    spawn,
    bounds: HALF + 20,
    groundHeightAt: (x, z) =>
      (inBlock(x) && inBlock(z)) || Math.abs(x) > HALF || Math.abs(z) > HALF ? SIDEWALK_HEIGHT : 0,
  };
}

// Yellow circle with an H, painted on the start roof.
function addHelipad(geometries, x, roof, z) {
  const y = roof + 0.04;
  const flat = (geometry, color) => paint(geometry.rotateX(-Math.PI / 2).translate(x, y, z), color);
  geometries.push(
    flat(new THREE.CircleGeometry(7, 48), '#3a3d42'),
    flat(new THREE.RingGeometry(5.6, 6.2, 48), '#f2c200').translate(0, 0.005, 0),
    flat(new THREE.PlaneGeometry(0.7, 5), '#f4f4f4').translate(-1.6, 0.005, 0),
    flat(new THREE.PlaneGeometry(0.7, 5), '#f4f4f4').translate(1.6, 0.005, 0),
    flat(new THREE.PlaneGeometry(2.6, 0.7), '#f4f4f4').translate(0, 0.005, 0),
  );
}

// Sea around the island: reflects the sky (and the sun) more at grazing angles, with moving ripples.
function createWater(skyMap) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { time: { value: 0 }, skyMap: { value: null } },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float time;
      uniform samplerCube skyMap;
      varying vec3 vWorld;

      vec2 wave(vec2 p, vec2 dir, float frequency, float speed) {
        float phase = dot(p, dir) * frequency + time * speed;
        return dir * cos(phase) * frequency;
      }

      void main() {
        vec2 p = vWorld.xz;
        vec2 slope = wave(p, vec2(0.8, 0.6), 0.21, 1.3) * 0.5
                   + wave(p, vec2(-0.5, 0.86), 0.37, 1.7) * 0.3
                   + wave(p, vec2(0.95, -0.3), 0.63, 2.3) * 0.15
                   + wave(p, vec2(-0.2, -0.98), 1.1, 3.1) * 0.08;
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 view = normalize(vWorld - cameraPosition);
        vec3 reflected = reflect(view, normal);
        reflected.y = abs(reflected.y);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-view, normal), 0.0), 5.0);
        vec3 deep = vec3(0.015, 0.06, 0.075);
        vec3 color = mix(deep, textureCube(skyMap, reflected).rgb, fresnel);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  material.uniforms.skyMap.value = skyMap;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), material);
  water.position.y = WATER_LEVEL;
  water.onBeforeRender = () => {
    material.uniforms.time.value = performance.now() / 1000;
  };
  return water;
}

// Far-away towers across the water, mostly hidden in haze, so the world doesn't end at the island.
function createSkyline(facadeMap) {
  const random = createRandom(31);
  const geometries = [];
  for (let k = 0; k < 170; k++) {
    const angle = random() * Math.PI * 2;
    const distance = 560 + random() * 320;
    const width = 14 + random() * 30;
    const depth = 14 + random() * 30;
    const height = 15 + random() ** 2 * 150;
    const geometry = facadeBox(width, height, depth, 14, (faceWidth, u) => (u * faceWidth) / 16);
    geometries.push(
      paint(geometry, pick(random, ['#c9c9c4', '#b7bcc2', '#d6d0c4', '#a7aeb5'])).translate(
        Math.cos(angle) * distance,
        height / 2 - 1,
        Math.sin(angle) * distance,
      ),
    );
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeometries(geometries), new THREE.MeshLambertMaterial({ map: facadeMap, vertexColors: true })));
  group.add(
    new THREE.Mesh(
      new THREE.RingGeometry(520, 1100, 64).rotateX(-Math.PI / 2).translate(0, -0.6, 0),
      new THREE.MeshLambertMaterial({ color: 0x5d6158 }),
    ),
  );
  return group;
}
