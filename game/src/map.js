// Kestrel Depot: an original desert depot at dusk. Two bomb sites, A (the
// silo yard, west) and B (the tank yard, east), joined by a mid lane and two
// long lanes, with crates and containers for cover. Every box is a collider
// for movement and a surface a bullet stops on. The waypoint graph is what
// the bots walk: nodes at spawns, lane joints, site entries and hold spots,
// edges only where the straight line between them is open ground.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes: [name, x, z]
const NODES = [
  ['AS0', -6, 18], ['AS1', 0, 18], ['AS2', 6, 18],
  ['M0', 0, 12], ['M1', 0, 6], ['M2', 0, 0], ['M3', 0, -6], ['M4', 0, -12],
  ['AL0', -28, 14], ['AL1', -28, 6], ['AL2', -28, -2], ['AL3', -28, -8],
  ['BL0', 28, 14], ['BL1', 28, 6], ['BL2', 28, -2], ['BL3', 28, -8],
  ['AX0', -12, 2], ['AX1', -18, -6], ['BX0', 12, 2], ['BX1', 18, -6],
  ['A0', -24, -12], ['B0', 24, -12],
  ['DS0', -6, -18], ['DS1', 0, -18], ['DS2', 6, -18],
  ['HA1', -20, -10], ['HA2', -27, -16], ['HB1', 20, -10], ['HB2', 27, -16],
  ['HM', 0, -14], ['HCT', -13, -16], ['HCT2', 13, -16],
];

// Edges by node name; the straight line between each pair is open ground.
const EDGES = [
  ['AS0', 'AS1'], ['AS1', 'AS2'], ['AS0', 'M0'], ['AS1', 'M0'], ['AS2', 'M0'],
  ['AS0', 'AL0'], ['AS2', 'BL0'], ['AS0', 'AX0'], ['AS1', 'AX0'], ['AS1', 'BX0'], ['AS2', 'BX0'],
  ['M0', 'M1'], ['M1', 'M2'], ['M2', 'M3'], ['M3', 'M4'],
  ['M1', 'AX0'], ['M1', 'BX0'], ['AX0', 'AX1'], ['BX0', 'BX1'],
  ['M3', 'AX1'], ['M3', 'BX1'], ['AX1', 'A0'], ['BX1', 'B0'],
  ['AL0', 'AL1'], ['AL1', 'AL2'], ['AL2', 'AL3'], ['AL3', 'A0'], ['AL2', 'AX1'],
  ['BL0', 'BL1'], ['BL1', 'BL2'], ['BL2', 'BL3'], ['BL3', 'B0'], ['BL2', 'BX1'],
  ['AX1', 'HA1'], ['BX1', 'HB1'],
  ['DS0', 'DS1'], ['DS1', 'DS2'], ['DS0', 'HCT'], ['DS2', 'HCT2'],
  ['HCT', 'HA1'], ['HCT2', 'HB1'], ['HA1', 'A0'], ['HB1', 'B0'],
  ['HA1', 'HA2'], ['HB1', 'HB2'], ['A0', 'HA2'], ['B0', 'HB2'],
  ['DS1', 'HM'], ['HM', 'M4'], ['HM', 'HCT'], ['HM', 'HCT2'],
  ['M4', 'HA1'], ['M4', 'HB1'],
];

export const SITES = {
  A: { letter: 'A', center: { x: -24, z: -12 }, rect: { x0: -29, x1: -19, z0: -16, z1: -8 } },
  B: { letter: 'B', center: { x: 24, z: -12 }, rect: { x0: 19, x1: 29, z0: -16, z1: -8 } },
};

export const SPAWNS = {
  ember: [[-6, 18], [-2, 19], [2, 19], [6, 18], [0, 16.5]],
  vanguard: [[-6, -18], [-2, -19], [2, -19], [6, -18], [0, -16.5]],
};

function letterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(20, 14, 8, 0.55)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = color;
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.55 : 0.92,
      metalness: name === 'steel' || name === 'rust' ? 0.25 : 0.03,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, z, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), materials[mat]);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - radius, 0, z - radius), new THREE.Vector3(x + radius, height, z + radius)));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: packed sand, 64 x 44 m.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-32, -0.4, -22), new THREE.Vector3(32, 0, 22)));

  // Perimeter walls, 4.5 m high.
  box(64.8, 4.5, 0.6, 0, 2.25, -22.3, 'surface');
  box(64.8, 4.5, 0.6, 0, 2.25, 22.3, 'surface');
  box(0.6, 4.5, 44.8, -32.3, 2.25, 0, 'surface');
  box(0.6, 4.5, 44.8, 32.3, 2.25, 0, 'surface');

  // Mid choke: a wall across the lane at z = 0 with a 3.4 m gap at x = 0.
  box(13.5, 3.4, 0.8, -10.6, 1.7, 0, 'surface');
  box(13.5, 3.4, 0.8, 10.6, 1.7, 0, 'surface');
  box(3.4, 1.0, 0.8, -3.4, 0.5, 0, 'steel');
  box(3.4, 1.0, 0.8, 3.4, 0.5, 0, 'steel');

  // Site A: the silo yard. A tall silo, crates, and a low wall for cover.
  cylinder(2.1, 6.5, -26.5, -14.5, 'rust');
  box(2.4, 1.2, 2.4, -20.5, 0.6, -14.5, 'crate');
  box(1.2, 1.2, 1.2, -22.5, 0.6, -10, 'crate');
  box(1.2, 2.4, 1.2, -27.5, 1.2, -9.5, 'crate');
  box(5.0, 1.1, 0.6, -24, 0.55, -8.6, 'steel');

  // Site B: the tank yard. A squat tank, containers, crates.
  box(4.2, 3.0, 4.2, 26.5, 1.5, -14.5, 'steel');
  box(2.4, 1.2, 2.4, 20.5, 0.6, -14.5, 'crate');
  box(1.2, 1.2, 1.2, 22.5, 0.6, -10, 'crate');
  box(1.2, 2.4, 1.2, 27.5, 1.2, -9.5, 'crate');
  box(5.0, 1.1, 0.6, 24, 0.55, -8.6, 'steel');

  // Mid lane cover: crates the lane's duels play around.
  box(1.2, 1.2, 1.2, -2.5, 0.6, 7, 'crate');
  box(2.4, 1.2, 1.2, 2.5, 0.6, 3, 'crate');
  box(1.2, 1.1, 1.2, 3.2, 0.55, -4, 'crate');
  box(1.2, 1.1, 1.2, -3.2, 0.55, -9, 'crate');

  // Long lanes: one container each, mid-lane cover for the push.
  box(6.0, 2.4, 2.4, -28, 1.2, 2, 'rust');
  box(6.0, 2.4, 2.4, 28, 1.2, 2, 'rust');
  box(2.4, 2.4, 2.4, -28, 1.2, -5.5, 'steel');
  box(2.4, 2.4, 2.4, 28, 1.2, -5.5, 'steel');

  // Short connectors: a crate each, and low walls near the spawns.
  box(2.4, 1.2, 1.2, -13, 0.6, -6, 'crate');
  box(2.4, 1.2, 1.2, 13, 0.6, -6, 'crate');
  box(4.0, 1.1, 0.6, -8, 0.55, 15.5, 'steel');
  box(4.0, 1.1, 0.6, 8, 0.55, -15.5, 'steel');

  // Site markers: a floating letter board above each site and a tinted
  // zone decal on the ground, so a site reads at a glance.
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, key === 'A' ? '#ff8c2e' : '#2fb3a3'), transparent: true, side: THREE.DoubleSide }),
    );
    board.position.set(site.center.x, 5.4, site.center.z);
    group.add(board);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(site.rect.x1 - site.rect.x0, site.rect.z1 - site.rect.z0),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xff8c2e : 0x2fb3a3, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.02, site.center.z);
    group.add(decal);
  }

  // Dusk light: a low warm sun, a cool sky fill, and a warm horizon glow.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a6a4a'), new THREE.Color(PALETTE.canvas), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.8);
  sun.position.set(-28, 16, 26);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a7a9a'), 0.7);
  fill.position.set(20, 12, -18);
  scene.add(fill);

  // Waypoint graph with adjacency for BFS.
  const nodes = new Map();
  for (const [name, x, z] of NODES) nodes.set(name, { name, x, z, links: [] });
  for (const [a, b] of EDGES) {
    nodes.get(a).links.push(b);
    nodes.get(b).links.push(a);
  }

  return { colliders, shootables, group, nodes, sites: SITES, spawns: SPAWNS };
}

// Breadth-first search over the waypoint graph; returns node names from
// start to goal, or an empty list when no route exists.
export function findPath(nodes, startName, goalName) {
  if (startName === goalName) return [goalName];
  const cameFrom = new Map([[startName, null]]);
  const queue = [startName];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of nodes.get(current).links) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      if (next === goalName) {
        const path = [goalName];
        let at = current;
        while (at !== null) {
          path.unshift(at);
          at = cameFrom.get(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

// The nearest waypoint to a point on the map.
export function nearestNode(nodes, x, z) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes.values()) {
    const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
    if (d < bestDistance) {
      bestDistance = d;
      best = node.name;
    }
  }
  return best;
}
