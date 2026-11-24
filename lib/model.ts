// A stylized, to-scale Honda BeAT eSAF built from primitives. Not a CAD model:
// sizes follow the spec sheet (wheelbase 1.256 m, 14" wheels, seat 742 mm), positions are approximate.
// Axes: x forward, y up, z to the rider's right. Units: metres.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PART_BY_ID } from "./parts";

export type PartNode = {
  id: string;
  group: THREE.Group;
  explode: THREE.Vector3; // where the whole part goes at full explode
  meshes: THREE.Mesh[];
};

type V3 = [number, number, number];

const COLORS = {
  body: 0xe9edf2,
  bodyDark: 0x2b3138,
  frame: 0x30363e,
  alu: 0x9aa3ad,
  aluDark: 0x6f7882,
  steel: 0xc3c9d0,
  rubber: 0x16181b,
  copper: 0xb8743a,
  bronze: 0xc9a15a,
  black: 0x1d2025,
  lining: 0x6b4a2f,
  red: 0xc8102e,
  amberLens: 0xffa21f,
  fuel: 0x3b4450,
  matteBlack: 0x15171a,
  trim: 0x24272c,
  amber: 0xff9a1f,
};

type MatOpts = { metal?: number; rough?: number; emissive?: number; emissiveIntensity?: number; opacity?: number };

function mat(color: number, o: MatOpts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.1,
    roughness: o.rough ?? 0.55,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: true,
    opacity: o.opacity ?? 1,
  });
  return m;
}

const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

/** Cylinder whose axis runs from a to b. */
function cylBetween(a: V3, b: V3, rTop: number, rBottom = rTop, seg = 24) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
  const m = new THREE.Matrix4();
  const dir = vb.clone().sub(va).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  m.compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** Disc/cylinder with its axis along z (wheels, pulleys). */
function discZ(r: number, thick: number, at: V3, seg = 40, rBack = r) {
  const g = new THREE.CylinderGeometry(r, rBack, thick, seg);
  g.rotateX(Math.PI / 2);
  g.translate(...at);
  return g;
}

function tube(points: V3[], radius: number, closed = false, seg = 64) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, "catmullrom", 0.4);
  return new THREE.TubeGeometry(curve, seg, radius, 12, closed);
}

/** Side profile (x, y) extruded across z, centred on zCenter. */
function profile(points: [number, number][], depth: number, zCenter: number, bevel = 0.012) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - 2 * bevel, 0.002),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  g.translate(0, 0, zCenter - depth / 2 + bevel);
  return g;
}

/** Narrow a geometry across z depending on position (for tapering body panels). */
function taperZ(g: THREE.BufferGeometry, scale: (x: number, y: number) => number, zCenter = 0) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = scale(pos.getX(i), pos.getY(i));
    pos.setZ(i, zCenter + (pos.getZ(i) - zCenter) * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function helix(center: V3, axis: "y" | "z", radius: number, length: number, turns: number, wire: number) {
  const pts: V3[] = [];
  const steps = turns * 16;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 16) * Math.PI * 2;
    const t = i / steps - 0.5;
    if (axis === "z") pts.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius, center[2] + t * length]);
    else pts.push([center[0] + Math.cos(a) * radius, center[1] + t * length, center[2] + Math.sin(a) * radius]);
  }
  return tube(pts, wire, false, steps * 2);
}

const deg = (d: number) => (d * Math.PI) / 180;

export function buildBeat() {
  const root = new THREE.Group();
  const nodes = new Map<string, PartNode>();

  function part(id: string, explode: V3, build: (add: (g: THREE.BufferGeometry, m: THREE.Material, ex?: V3) => THREE.Mesh) => void) {
    if (!PART_BY_ID.has(id)) throw new Error(`Unknown part ${id}`);
    const group = new THREE.Group();
    group.name = id;
    const meshes: THREE.Mesh[] = [];
    build((g, m, ex) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.userData.partId = id;
      if (ex) mesh.userData.ex = new THREE.Vector3(...ex); // extra per-mesh spread (left/right panels)
      group.add(mesh);
      meshes.push(mesh);
      return mesh;
    });
    root.add(group);
    nodes.set(id, { id, group, explode: new THREE.Vector3(...explode), meshes });
  }

  const F: V3 = [0.628, 0.25, 0]; // front axle
  const R: V3 = [-0.628, 0.25, 0]; // rear axle
  const forkDir = new THREE.Vector2(-Math.sin(deg(26.5)), Math.cos(deg(26.5)));
  const forkTop: V3 = [F[0] + forkDir.x * 0.58, F[1] + forkDir.y * 0.58, 0];

  // ---------------- Wheels ----------------
  function wheel(add: (g: THREE.BufferGeometry, m: THREE.Material) => THREE.Mesh, c: V3, hubWidth: number) {
    const tire = new THREE.TorusGeometry(0.203, 0.047, 24, 80);
    tire.scale(1, 1, 0.92);
    tire.translate(...c);
    add(tire, mat(COLORS.rubber, { rough: 0.92 }));
    const alloy = mat(COLORS.matteBlack, { metal: 0.5, rough: 0.38 });
    const rim = new THREE.TorusGeometry(0.162, 0.014, 12, 80);
    rim.scale(1, 1, 2.2);
    rim.translate(...c);
    add(rim, alloy);
    // Five pairs of spokes that meet at the hub (cast "double Y" look)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.25;
      for (const off of [-0.11, 0.11]) {
        const inner: V3 = [c[0] + Math.cos(a) * 0.045, c[1] + Math.sin(a) * 0.045, c[2]];
        const outer: V3 = [c[0] + Math.cos(a + off) * 0.152, c[1] + Math.sin(a + off) * 0.152, c[2]];
        const sp = cylBetween(inner, outer, 0.0075, 0.011, 8);
        add(sp, alloy);
      }
    }
    add(discZ(0.045, hubWidth, c, 28), alloy);
    add(discZ(0.016, hubWidth + 0.02, c, 16), mat(COLORS.steel, { metal: 0.9, rough: 0.25 }));
  }

  part("front_wheel", [0.55, 0, 0], (add) => wheel(add, F, 0.09));
  part("rear_wheel", [-0.42, 0, 0], (add) => wheel(add, R, 0.11));

  part("front_disc", [0.55, 0, -0.24], (add) => {
    add(discZ(0.11, 0.004, [F[0], F[1], -0.058], 48), mat(COLORS.steel, { metal: 0.85, rough: 0.3 }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(discZ(0.008, 0.006, [F[0] + Math.cos(a) * 0.085, F[1] + Math.sin(a) * 0.085, -0.058], 12), mat(COLORS.black));
    }
  });
  part("front_caliper", [0.45, 0.05, -0.32], (add) => {
    const g = rbox(0.07, 0.05, 0.035, 0.01);
    g.rotateZ(deg(-30));
    g.translate(F[0] - 0.07, F[1] + 0.08, -0.06);
    add(g, mat(COLORS.aluDark, { metal: 0.5, rough: 0.4 }));
    const pad = rbox(0.045, 0.03, 0.006, 0.002);
    pad.rotateZ(deg(-30));
    pad.translate(F[0] - 0.06, F[1] + 0.075, -0.052);
    add(pad, mat(COLORS.lining));
  });
  part("rear_drum", [-0.42, 0, 0.32], (add) => {
    add(discZ(0.07, 0.05, [R[0], R[1], 0.07], 36), mat(COLORS.alu, { metal: 0.55, rough: 0.4 }));
    add(cylBetween([R[0] + 0.02, R[1] + 0.03, 0.1], [R[0] + 0.13, R[1] + 0.07, 0.1], 0.008), mat(COLORS.black));
  });

  // ---------------- Front end ----------------
  part("front_fork", [0.26, 0.1, 0], (add) => {
    for (const z of [-0.065, 0.065]) {
      const low: V3 = [F[0], F[1], z];
      const mid: V3 = [F[0] + forkDir.x * 0.28, F[1] + forkDir.y * 0.28, z];
      const top: V3 = [forkTop[0], forkTop[1], z];
      add(cylBetween(low, mid, 0.025, 0.023, 20), mat(COLORS.matteBlack, { metal: 0.4, rough: 0.4 }));
      add(cylBetween(mid, top, 0.017, 0.017, 20), mat(COLORS.steel, { metal: 0.9, rough: 0.2 }));
    }
    add(cylBetween([forkTop[0], forkTop[1], -0.075], [forkTop[0], forkTop[1], 0.075], 0.018), mat(COLORS.black));
  });

  part("steering", [0.05, 0.4, 0], (add) => {
    const chrome = mat(COLORS.steel, { metal: 0.85, rough: 0.25 });
    add(cylBetween(forkTop, [0.365, 1.0, 0], 0.016), chrome);
    // exposed handlebar with black grips
    add(cylBetween([0.365, 1.02, -0.3], [0.365, 1.02, 0.3], 0.011), mat(COLORS.matteBlack, { metal: 0.5, rough: 0.4 }));
    for (const z of [-1, 1]) add(cylBetween([0.365, 1.02, z * 0.255], [0.365, 1.02, z * 0.34], 0.017), mat(COLORS.rubber, { rough: 0.9 }));
    // compact handlebar cover: white front with a pointed nose, black top
    const front = rbox(0.12, 0.08, 0.22, 0.03);
    taperZ(front, (x) => 1 - 0.45 * THREE.MathUtils.clamp((x - 0.37) / 0.08, 0, 1));
    front.translate(0.395, 1.03, 0);
    add(front, mat(COLORS.body, { rough: 0.3 }));
    const top = rbox(0.11, 0.035, 0.2, 0.015);
    top.translate(0.355, 1.065, 0);
    add(top, mat(COLORS.matteBlack, { rough: 0.5 }));
    // mirrors on stalks
    for (const z of [-1, 1]) {
      add(cylBetween([0.36, 1.05, z * 0.17], [0.345, 1.19, z * 0.25], 0.006), mat(COLORS.matteBlack, { metal: 0.4, rough: 0.4 }));
      const head = new THREE.SphereGeometry(0.05, 24, 16);
      head.scale(0.35, 0.8, 1.15);
      head.rotateX(z * 0.25);
      head.translate(0.34, 1.215, z * 0.275);
      add(head, mat(COLORS.matteBlack, { rough: 0.45 }));
    }
  });

  part("meter_panel", [0.03, 0.56, 0], (add) => {
    const g = rbox(0.09, 0.018, 0.15, 0.008);
    g.rotateZ(deg(-20));
    g.translate(0.345, 1.085, 0);
    add(g, mat(COLORS.black, { rough: 0.3 }));
    const screen = new THREE.PlaneGeometry(0.065, 0.12);
    screen.rotateX(-Math.PI / 2);
    screen.rotateZ(deg(-20));
    screen.translate(0.342, 1.096, 0);
    add(screen, mat(0x0d2733, { emissive: 0x1d7d93, emissiveIntensity: 0.6, rough: 0.2 }));
  });

  part("handlebar_switches", [0.02, 0.46, 0], (add) => {
    for (const z of [-0.225, 0.225]) {
      const g = rbox(0.05, 0.045, 0.045, 0.012);
      g.translate(0.365, 1.02, z);
      add(g, mat(COLORS.black, { rough: 0.6 }));
    }
  });

  part("front_master", [0.05, 0.46, 0.22], (add) => {
    const res = rbox(0.045, 0.03, 0.04, 0.008);
    res.translate(0.35, 1.05, 0.175);
    add(res, mat(COLORS.aluDark, { metal: 0.4 }));
    add(cylBetween([0.39, 1.015, 0.21], [0.45, 1.005, 0.32], 0.006), mat(COLORS.steel, { metal: 0.85 }));
  });

  part("rear_brake_lever", [0.05, 0.46, -0.22], (add) => {
    const stay: V3 = [-0.05, -0.46, 0.22];
    add(cylBetween([0.39, 1.015, -0.21], [0.45, 1.005, -0.32], 0.006), mat(COLORS.steel, { metal: 0.85 }));
    const lock = rbox(0.02, 0.012, 0.03, 0.004);
    lock.translate(0.385, 1.03, -0.21);
    add(lock, mat(COLORS.red));
    add(
      tube(
        [
          [0.365, 1.0, -0.2],
          [0.36, 0.8, -0.12],
          [0.32, 0.5, -0.1],
          [0.25, 0.27, -0.08],
          [0.0, 0.23, -0.06],
          [-0.25, 0.21, 0.04],
          [-0.5, 0.24, 0.12],
          [R[0] + 0.12, R[1] + 0.07, 0.1],
        ],
        0.004,
      ),
      mat(COLORS.black),
      stay,
    );
  });

  part("cbs_unit", [0.3, 0.22, 0.26], (add) => {
    const g = rbox(0.05, 0.04, 0.03, 0.008);
    g.translate(0.4, 0.64, 0.03);
    add(g, mat(COLORS.aluDark, { metal: 0.4 }));
  });

  part("front_cover", [0.4, 0.06, 0], (add) => {
    // Slim apron: wide at the leg shield, narrow at the nose
    const k = (x: number) => 1 - 0.45 * THREE.MathUtils.clamp((x - 0.36) / 0.26, 0, 1);
    const apron = profile(
      [
        [0.3, 0.37],
        [0.38, 0.37],
        [0.47, 0.42],
        [0.54, 0.5],
        [0.585, 0.58],
        [0.615, 0.67],
        [0.627, 0.74],
        [0.607, 0.81],
        [0.562, 0.87],
        [0.5, 0.922],
        [0.44, 0.962],
        [0.39, 0.975],
        [0.36, 0.95],
        [0.345, 0.85],
        [0.33, 0.62],
        [0.31, 0.45],
      ],
      0.3,
      0,
      0.03,
    );
    add(taperZ(apron, k), mat(COLORS.body, { rough: 0.28 }));
    // Black panel between the headlight and the handlebar
    const mask = profile(
      [
        [0.47, 0.905],
        [0.535, 0.875],
        [0.585, 0.83],
        [0.61, 0.79],
        [0.6, 0.775],
        [0.555, 0.82],
        [0.49, 0.87],
        [0.45, 0.895],
      ],
      0.304,
      0,
      0.03,
    );
    add(taperZ(mask, k), mat(COLORS.matteBlack, { rough: 0.35 }));
    // Inner leg shield
    add(
      profile(
        [
          [0.29, 0.36],
          [0.345, 0.37],
          [0.36, 0.7],
          [0.372, 0.96],
          [0.335, 0.97],
          [0.315, 0.7],
        ],
        0.34,
        0,
        0.015,
      ),
      mat(COLORS.trim, { rough: 0.75 }),
    );
    // Red chevron stripes on both sides
    for (const z of [-1, 1]) {
      for (const pts of [
        [
          [0.42, 0.61],
          [0.535, 0.73],
          [0.543, 0.72],
          [0.43, 0.6],
        ],
        [
          [0.535, 0.73],
          [0.47, 0.84],
          [0.462, 0.833],
          [0.526, 0.727],
        ],
      ] as [number, number][][]) {
        add(taperZ(profile(pts, 0.004, z * 0.153, 0), k), mat(COLORS.red, { rough: 0.35 }));
      }
    }
  });

  part("headlight", [0.58, 0.14, 0], (add) => {
    // Smoked lens on the nose with V-shaped LED strips, amber front signals at the corners
    const lens = rbox(0.022, 0.1, 0.15, 0.01);
    lens.rotateZ(deg(16));
    lens.translate(0.622, 0.735, 0);
    add(lens, mat(0x222a33, { metal: 0.3, rough: 0.12, opacity: 0.95 }));
    for (const z of [-1, 1]) {
      const strip = rbox(0.01, 0.016, 0.07, 0.005);
      strip.rotateX(z * deg(-28));
      strip.rotateZ(deg(16));
      strip.translate(0.635, 0.745, z * 0.036);
      add(strip, mat(0xeaf6ff, { emissive: 0xd4ecff, emissiveIntensity: 1.6, rough: 0.1 }));
      const sig = rbox(0.012, 0.016, 0.03, 0.005);
      sig.rotateZ(deg(16));
      sig.translate(0.61, 0.79, z * 0.058);
      add(sig, mat(COLORS.amber, { emissive: 0xff8a00, emissiveIntensity: 0.4, rough: 0.2 }));
    }
    const low = rbox(0.01, 0.014, 0.06, 0.005);
    low.rotateZ(deg(16));
    low.translate(0.632, 0.705, 0);
    add(low, mat(0xeaf6ff, { emissive: 0xd4ecff, emissiveIntensity: 1.2, rough: 0.1 }));
  });

  part("front_fender", [0.3, 0.26, 0], (add) => {
    // Short hugger with a pointed beak, hugging the top front of the tyre
    const pts: [number, number][] = [];
    const ang = (d: number) => (d * Math.PI) / 180;
    for (let d = 120; d >= 40; d -= 5) pts.push([F[0] + Math.cos(ang(d)) * 0.3, F[1] + Math.sin(ang(d)) * 0.3]);
    pts.push([F[0] + Math.cos(ang(33)) * 0.312, F[1] + Math.sin(ang(33)) * 0.312]);
    for (let d = 38; d <= 120; d += 5) pts.push([F[0] + Math.cos(ang(d)) * 0.272, F[1] + Math.sin(ang(d)) * 0.272]);
    const g = profile(pts, 0.13, 0, 0.012);
    taperZ(g, (x) => 1 - 0.3 * THREE.MathUtils.clamp((x - 0.6) / 0.28, 0, 1));
    add(g, mat(COLORS.body, { rough: 0.28 }));
  });

  // ---------------- Electrics up front ----------------
  part("ecm", [0.3, 0.16, 0.32], (add) => {
    const g = rbox(0.1, 0.022, 0.07, 0.006);
    g.translate(0.4, 0.5, 0.08);
    add(g, mat(COLORS.aluDark, { metal: 0.5 }));
    const plug = rbox(0.025, 0.02, 0.05, 0.004);
    plug.translate(0.34, 0.5, 0.08);
    add(plug, mat(COLORS.black));
  });
  part("bank_angle_sensor", [0.36, 0.22, -0.32], (add) => {
    const g = rbox(0.03, 0.03, 0.02, 0.005);
    g.translate(0.4, 0.57, -0.06);
    add(g, mat(COLORS.black));
  });
  part("regulator", [0.3, 0.06, -0.36], (add) => {
    const g = rbox(0.06, 0.018, 0.05, 0.004);
    g.translate(0.37, 0.45, -0.1);
    add(g, mat(COLORS.aluDark, { metal: 0.6 }));
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.06, 0.008, 0.003);
      fin.translate(0.37, 0.463, -0.12 + i * 0.013);
      add(fin, mat(COLORS.aluDark, { metal: 0.6 }));
    }
  });

  // ---------------- Floor, battery ----------------
  part("floorboard", [0.06, 0.24, 0], (add) => {
    const floor = rbox(0.42, 0.028, 0.3, 0.012);
    floor.translate(0.08, 0.338, 0);
    add(floor, mat(COLORS.matteBlack, { rough: 0.85 }));
    // Black under-cover from the front wheel back to the engine
    add(
      profile(
        [
          [0.36, 0.36],
          [0.33, 0.27],
          [0.24, 0.215],
          [0.05, 0.2],
          [-0.1, 0.225],
          [-0.12, 0.33],
          [0.3, 0.335],
        ],
        0.26,
        0,
        0.02,
      ),
      mat(COLORS.matteBlack, { rough: 0.7 }),
    );
  });

  part("battery", [0.05, -0.12, 0.26], (add) => {
    const g = rbox(0.113, 0.085, 0.07, 0.006);
    g.translate(0.16, 0.27, 0);
    add(g, mat(COLORS.black, { rough: 0.7 }));
    add(cylBetween([0.125, 0.312, 0.02], [0.125, 0.325, 0.02], 0.008), mat(COLORS.red));
    add(cylBetween([0.195, 0.312, 0.02], [0.195, 0.325, 0.02], 0.008), mat(COLORS.steel, { metal: 0.8 }));
  });
  part("fuse_box", [0.05, -0.12, 0.36], (add) => {
    const g = rbox(0.045, 0.03, 0.05, 0.006);
    g.translate(0.07, 0.275, 0.065);
    add(g, mat(0x2f5d8a));
  });

  // ---------------- Frame ----------------
  part("frame_esaf", [0, 0, 0], (add) => {
    const m = mat(COLORS.frame, { metal: 0.4, rough: 0.5 });
    add(cylBetween([0.38, 0.75, 0], [0.33, 0.85, 0], 0.03), m);
    add(
      tube(
        [
          [0.36, 0.78, 0],
          [0.32, 0.66, 0],
          [0.27, 0.5, 0],
          [0.22, 0.34, 0],
          [0.13, 0.29, 0],
        ],
        0.024,
      ),
      m,
    );
    for (const z of [-0.085, 0.085]) {
      add(
        tube(
          [
            [0.15, 0.29, 0],
            [0.08, 0.288, z * 0.9],
            [-0.05, 0.29, z],
            [-0.2, 0.4, z * 1.1],
            [-0.4, 0.57, z * 1.1],
            [-0.75, 0.655, z],
            [-0.93, 0.68, z * 0.8],
          ],
          0.016,
        ),
        m,
      );
    }
    for (const x of [-0.06, -0.45, -0.82]) {
      const y = x === -0.06 ? 0.29 : x === -0.45 ? 0.6 : 0.665;
      add(cylBetween([x, y, -0.09], [x, y, 0.09], 0.012), m);
    }
    // engine hanger
    add(cylBetween([-0.05, 0.29, 0], [-0.08, 0.34, 0], 0.02), m);
  });

  // ---------------- Engine (unit swing, cylinder forward) ----------------
  const cylAxis = new THREE.Vector2(Math.cos(deg(5)), Math.sin(deg(5)));
  const cylBase: V3 = [-0.03, 0.285, 0.02];
  const along = (t: number, z = 0.02): V3 => [cylBase[0] + cylAxis.x * t, cylBase[1] + cylAxis.y * t, z];

  part("crankcase", [0, -0.04, 0], (add) => {
    const g = rbox(0.2, 0.17, 0.17, 0.04);
    g.translate(-0.13, 0.31, 0);
    add(g, mat(COLORS.alu, { metal: 0.55, rough: 0.45 }));
    const inner = rbox(0.46, 0.14, 0.03, 0.02);
    inner.translate(-0.37, 0.295, -0.1);
    add(inner, mat(COLORS.alu, { metal: 0.55, rough: 0.45 }));
  });

  part("engine_oil", [0.02, -0.08, 0.32], (add) => {
    add(cylBetween([-0.06, 0.245, 0.085], [-0.06, 0.245, 0.115], 0.014), mat(0xe8b93a, { rough: 0.5 }));
  });

  part("cylinder", [0.18, 0, 0], (add) => {
    const m = mat(COLORS.alu, { metal: 0.55, rough: 0.45 });
    add(cylBetween(along(0), along(0.1), 0.052, 0.052, 28), m);
    for (let i = 1; i <= 5; i++) add(cylBetween(along(i * 0.017 - 0.002), along(i * 0.017 + 0.002), 0.062, 0.062, 28), m);
  });

  part("piston", [0.13, 0.2, 0], (add) => {
    add(cylBetween(along(0.03), along(0.07), 0.042, 0.042, 28), mat(COLORS.steel, { metal: 0.8, rough: 0.25 }));
    for (const t of [0.062, 0.067]) add(cylBetween(along(t), along(t + 0.002), 0.0435, 0.0435, 28), mat(COLORS.black));
    add(cylBetween(along(0.04), [-0.12, 0.3, 0.02], 0.009), mat(COLORS.steel, { metal: 0.8 }));
  });

  part("cylinder_head", [0.34, 0.05, 0], (add) => {
    const m = mat(COLORS.alu, { metal: 0.55, rough: 0.45 });
    const head = rbox(0.07, 0.115, 0.12, 0.015);
    head.rotateZ(deg(5));
    const c = along(0.135);
    head.translate(c[0], c[1], c[2]);
    add(head, m);
    const capC = along(0.185);
    const cap = rbox(0.04, 0.09, 0.095, 0.02);
    cap.rotateZ(deg(5));
    cap.translate(capC[0], capC[1], capC[2]);
    add(cap, mat(COLORS.aluDark, { metal: 0.5 }));
  });

  part("spark_plug", [0.42, 0.22, 0.14], (add) => {
    const c = along(0.12, 0.06);
    add(cylBetween([c[0], c[1] + 0.02, 0.06], [c[0], c[1] + 0.035, 0.1], 0.008), mat(0xf2f2f2, { rough: 0.3 }));
    add(cylBetween([c[0], c[1] + 0.035, 0.1], [c[0], c[1] + 0.04, 0.112], 0.011, 0.011, 6), mat(COLORS.steel, { metal: 0.9 }));
  });

  part("ignition_coil", [0.34, 0.3, 0.26], (add) => {
    const c = along(0.12, 0.06);
    add(cylBetween([c[0], c[1] + 0.04, 0.112], [c[0] - 0.015, c[1] + 0.045, 0.135], 0.014), mat(COLORS.black, { rough: 0.6 }));
    const coil = rbox(0.05, 0.035, 0.04, 0.008);
    coil.translate(-0.06, 0.45, 0.1);
    add(coil, mat(COLORS.black, { rough: 0.6 }));
    add(tube([[c[0] - 0.015, c[1] + 0.045, 0.135], [0.02, 0.33, 0.13], [-0.04, 0.45, 0.105]], 0.005), mat(COLORS.black));
  });

  part("cooling_fan", [0, 0, 0.44], (add) => {
    add(discZ(0.09, 0.02, [-0.13, 0.31, 0.112], 40), mat(COLORS.matteBlack, { rough: 0.7, opacity: 0.95 }));
    // honeycomb grille on the fan cover
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        const x = col * 0.022 + (row % 2 ? 0.011 : 0);
        const y = row * 0.019;
        if (Math.hypot(x, y) > 0.07) continue;
        const cell = new THREE.CylinderGeometry(0.009, 0.009, 0.004, 6);
        cell.rotateX(Math.PI / 2);
        cell.translate(-0.13 + x, 0.31 + y, 0.124);
        add(cell, mat(0x3a3f46, { rough: 0.6 }));
      }
    }
    const shroud = rbox(0.2, 0.15, 0.05, 0.03);
    shroud.rotateZ(deg(12));
    const s = along(0.08, 0.1);
    shroud.translate(s[0], s[1], 0.095);
    add(shroud, mat(COLORS.bodyDark, { rough: 0.7 }));
  });

  part("acg_starter", [0, 0, 0.3], (add) => {
    add(discZ(0.07, 0.03, [-0.13, 0.31, 0.085], 36), mat(COLORS.copper, { metal: 0.6, rough: 0.35 }));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pole = rbox(0.016, 0.016, 0.03, 0.003);
      pole.translate(-0.13 + Math.cos(a) * 0.05, 0.31 + Math.sin(a) * 0.05, 0.085);
      add(pole, mat(COLORS.steel, { metal: 0.8 }));
    }
  });

  part("exhaust", [-0.05, -0.12, 0.46], (add) => {
    const header = along(0.12, 0.03);
    const pts: V3 = [header[0], header[1] - 0.06, 0.03];
    add(
      tube(
        [
          pts,
          [0.07, 0.19, 0.04],
          [-0.05, 0.16, 0.07],
          [-0.18, 0.19, 0.12],
          [-0.26, 0.25, 0.155],
        ],
        0.016,
      ),
      mat(0x3a3d42, { metal: 0.6, rough: 0.45 }),
    );
    add(cylBetween([0.01, 0.17, 0.055], [-0.09, 0.165, 0.085], 0.028), mat(0x3a3d42, { metal: 0.6, rough: 0.45 }));
    add(cylBetween([-0.26, 0.26, 0.16], [-0.62, 0.38, 0.16], 0.058, 0.05, 32), mat(COLORS.matteBlack, { metal: 0.4, rough: 0.45 }));
    const shield = rbox(0.3, 0.07, 0.03, 0.015);
    shield.rotateZ(deg(18));
    shield.translate(-0.44, 0.33, 0.215);
    add(shield, mat(COLORS.matteBlack, { metal: 0.3, rough: 0.5 }));
    add(cylBetween([-0.62, 0.38, 0.16], [-0.66, 0.392, 0.16], 0.018), mat(COLORS.steel, { metal: 0.9 }));
  });

  part("o2_sensor", [0.26, -0.15, 0.32], (add) => {
    add(cylBetween([0.085, 0.225, 0.035], [0.085, 0.225, 0.08], 0.008), mat(COLORS.steel, { metal: 0.85 }));
    add(cylBetween([0.085, 0.225, 0.08], [0.085, 0.225, 0.1], 0.006), mat(COLORS.black));
  });

  // ---------------- Intake & fuel ----------------
  part("throttle_body", [0.1, 0.3, -0.1], (add) => {
    add(cylBetween([-0.125, 0.45, -0.05], [-0.065, 0.448, -0.045], 0.028, 0.028, 24), mat(COLORS.alu, { metal: 0.6 }));
    const sensor = rbox(0.035, 0.022, 0.04, 0.005);
    sensor.translate(-0.095, 0.48, -0.048);
    add(sensor, mat(COLORS.black));
    const head = along(0.13, -0.01);
    add(tube([[-0.065, 0.448, -0.045], [-0.02, 0.42, -0.03], [head[0] - 0.01, head[1] + 0.06, -0.01]], 0.02), mat(COLORS.aluDark, { metal: 0.4 }));
  });

  part("injector", [0.26, 0.3, -0.05], (add) => {
    add(cylBetween([-0.015, 0.415, -0.028], [-0.03, 0.455, -0.02], 0.009), mat(COLORS.black, { rough: 0.4 }));
    add(cylBetween([-0.03, 0.455, -0.02], [-0.033, 0.467, -0.018], 0.007), mat(0x2f5d8a));
  });

  part("air_filter", [-0.05, 0.28, -0.32], (add) => {
    add(
      profile(
        [
          [-0.4, 0.41],
          [-0.1, 0.42],
          [-0.15, 0.5],
          [-0.36, 0.5],
        ],
        0.1,
        -0.135,
        0.012,
      ),
      mat(COLORS.bodyDark, { rough: 0.75 }),
    );
    add(tube([[-0.14, 0.465, -0.1], [-0.14, 0.458, -0.075], [-0.125, 0.45, -0.05]], 0.024), mat(COLORS.rubber, { rough: 0.9 }));
  });

  part("fuel_tank", [-0.1, 0.42, 0], (add) => {
    const g = rbox(0.24, 0.11, 0.2, 0.03);
    g.translate(-0.6, 0.6, 0);
    add(g, mat(COLORS.fuel, { metal: 0.3, rough: 0.5 }));
    add(cylBetween([-0.67, 0.655, 0], [-0.67, 0.685, 0], 0.028, 0.028, 28), mat(COLORS.black));
  });

  part("fuel_pump", [0, 0.64, 0], (add) => {
    add(cylBetween([-0.52, 0.64, 0], [-0.52, 0.675, 0], 0.035, 0.035, 28), mat(0x4a5562, { metal: 0.4 }));
    const conn = rbox(0.025, 0.015, 0.03, 0.004);
    conn.translate(-0.52, 0.685, 0);
    add(conn, mat(COLORS.black));
    add(
      tube(
        [
          [-0.5, 0.68, 0.02],
          [-0.4, 0.62, 0.0],
          [-0.2, 0.56, -0.02],
          [-0.06, 0.5, -0.03],
          [-0.033, 0.47, -0.018],
        ],
        0.004,
      ),
      mat(COLORS.black),
      [0, -0.64, 0],
    );
  });

  // ---------------- CVT (left side) ----------------
  const DRIVE: V3 = [-0.13, 0.31, -0.108];
  const DRIVEN: V3 = [-0.52, 0.29, -0.108];

  part("cvt_cover", [0, 0, -0.56], (add) => {
    add(
      profile(
        [
          [-0.2, 0.215],
          [-0.07, 0.24],
          [-0.03, 0.31],
          [-0.07, 0.39],
          [-0.3, 0.375],
          [-0.6, 0.355],
          [-0.69, 0.31],
          [-0.69, 0.22],
          [-0.6, 0.19],
          [-0.3, 0.2],
        ],
        0.05,
        -0.15,
        0.015,
      ),
      mat(0x2f3339, { metal: 0.45, rough: 0.45 }),
    );
  });

  part("drive_pulley", [0, 0, -0.3], (add) => {
    add(discZ(0.056, 0.012, [DRIVE[0], DRIVE[1], -0.097], 40, 0.03), mat(COLORS.steel, { metal: 0.8, rough: 0.3 }));
    add(discZ(0.03, 0.012, [DRIVE[0], DRIVE[1], -0.119], 40, 0.056), mat(COLORS.steel, { metal: 0.8, rough: 0.3 }));
    add(discZ(0.045, 0.008, [DRIVE[0], DRIVE[1], -0.135], 6), mat(COLORS.aluDark, { metal: 0.5 }));
  });

  part("rollers", [0, 0.1, -0.4], (add) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(discZ(0.009, 0.014, [DRIVE[0] + Math.cos(a) * 0.032, DRIVE[1] + Math.sin(a) * 0.032, -0.128], 16), mat(COLORS.bronze, { metal: 0.3, rough: 0.5 }));
    }
  });

  part("v_belt", [0, 0.22, -0.2], (add) => {
    const r1 = 0.044;
    const r2 = 0.058;
    // Wraps the front of the drive pulley and the back of the driven pulley
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 - (i / 10) * Math.PI;
      pts.push([DRIVE[0] + Math.cos(a) * r1, DRIVE[1] + Math.sin(a) * r1, DRIVE[2]]);
    }
    const back: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 - (i / 10) * Math.PI;
      back.push([DRIVEN[0] + Math.cos(a) * r2, DRIVEN[1] + Math.sin(a) * r2, DRIVEN[2]]);
    }
    add(tube([...pts, ...back], 0.0065, true, 160), mat(COLORS.rubber, { rough: 0.85 }));
  });

  part("driven_pulley", [0, 0, -0.32], (add) => {
    add(discZ(0.066, 0.012, [DRIVEN[0], DRIVEN[1], -0.097], 40, 0.035), mat(COLORS.steel, { metal: 0.8, rough: 0.3 }));
    add(discZ(0.035, 0.012, [DRIVEN[0], DRIVEN[1], -0.119], 40, 0.066), mat(COLORS.steel, { metal: 0.8, rough: 0.3 }));
    add(helix([DRIVEN[0], DRIVEN[1], -0.135], "z", 0.022, 0.03, 4, 0.003), mat(0x3d7fd1, { metal: 0.5 }));
  });

  part("clutch_shoes", [0, 0, -0.42], (add) => {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.TorusGeometry(0.05, 0.009, 8, 24, 1.7);
      g.scale(1, 1, 1.6);
      g.rotateZ((i / 3) * Math.PI * 2);
      g.translate(DRIVEN[0], DRIVEN[1], -0.145);
      add(g, mat(COLORS.lining, { rough: 0.9 }));
    }
  });

  part("clutch_outer", [0, 0, -0.5], (add) => {
    const bell = new THREE.CylinderGeometry(0.063, 0.063, 0.028, 40, 1, true);
    bell.rotateX(Math.PI / 2);
    bell.translate(DRIVEN[0], DRIVEN[1], -0.146);
    const m = mat(COLORS.steel, { metal: 0.8, rough: 0.35 });
    m.side = THREE.DoubleSide;
    add(bell, m);
    add(discZ(0.063, 0.004, [DRIVEN[0], DRIVEN[1], -0.162], 40), mat(COLORS.steel, { metal: 0.8, rough: 0.35 }));
  });

  part("final_gear", [-0.05, 0, -0.24], (add) => {
    const g = rbox(0.1, 0.1, 0.05, 0.02);
    g.translate(R[0] + 0.01, R[1] + 0.02, -0.08);
    add(g, mat(COLORS.alu, { metal: 0.6, rough: 0.4 }));
    add(cylBetween([R[0], R[1], -0.11], [R[0], R[1], -0.05], 0.014), mat(COLORS.steel, { metal: 0.8 }));
  });

  part("kick_starter", [0, -0.08, -0.46], (add) => {
    add(cylBetween([-0.36, 0.22, -0.175], [-0.46, 0.19, -0.18], 0.008), mat(COLORS.steel, { metal: 0.8 }));
    const pedal = rbox(0.04, 0.012, 0.025, 0.004);
    pedal.translate(-0.47, 0.19, -0.19);
    add(pedal, mat(COLORS.black));
  });

  part("rear_shock", [-0.1, 0.16, -0.3], (add) => {
    const a: V3 = [-0.66, 0.34, -0.15];
    const b: V3 = [-0.74, 0.64, -0.13];
    add(cylBetween(a, [-0.69, 0.46, -0.143], 0.017), mat(COLORS.black));
    add(cylBetween([-0.69, 0.46, -0.143], b, 0.009), mat(COLORS.steel, { metal: 0.9 }));
    const spring = helix([0, 0, 0], "y", 0.026, 0.2, 7, 0.004);
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    spring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    spring.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    add(spring, mat(COLORS.matteBlack, { metal: 0.5, rough: 0.35 }));
  });

  part("center_stand", [0, -0.06, 0.28], (add) => {
    add(
      tube(
        [
          [-0.1, 0.22, -0.08],
          [-0.2, 0.1, -0.1],
          [-0.24, 0.04, -0.06],
          [-0.24, 0.04, 0.06],
          [-0.2, 0.1, 0.1],
          [-0.1, 0.22, 0.08],
        ],
        0.012,
      ),
      mat(COLORS.frame, { metal: 0.4 }),
    );
  });

  part("side_stand", [0.04, -0.06, -0.36], (add) => {
    add(cylBetween([-0.02, 0.24, -0.11], [-0.3, 0.19, -0.17], 0.011), mat(COLORS.frame, { metal: 0.4 }));
    const sw = rbox(0.02, 0.02, 0.02, 0.004);
    sw.translate(-0.01, 0.25, -0.1);
    add(sw, mat(COLORS.black));
  });

  // ---------------- Rear body ----------------
  part("luggage_box", [0.05, 0.3, 0], (add) => {
    const g = rbox(0.36, 0.2, 0.24, 0.03);
    g.translate(-0.25, 0.62, 0);
    add(g, mat(0x3a414a, { rough: 0.8 }));
  });

  part("seat", [-0.05, 0.62, 0], (add) => {
    const g = profile(
      [
        [-0.1, 0.735],
        [-0.13, 0.785],
        [-0.3, 0.795],
        [-0.6, 0.805],
        [-0.84, 0.83],
        [-0.92, 0.828],
        [-0.93, 0.795],
        [-0.6, 0.765],
        [-0.3, 0.75],
        [-0.13, 0.74],
      ],
      0.27,
      0,
      0.03,
    );
    taperZ(g, (x) => 1 - 0.3 * THREE.MathUtils.clamp((-x - 0.55) / 0.4, 0, 1));
    add(g, mat(COLORS.black, { rough: 0.85 }));
  });

  part("body_cover", [0, 0.1, 0], (add) => {
    const side: [number, number][] = [
      [-0.07, 0.4],
      [-0.12, 0.53],
      [-0.15, 0.63],
      [-0.12, 0.715],
      [-0.5, 0.74],
      [-0.85, 0.775],
      [-0.97, 0.795],
      [-1.0, 0.765],
      [-0.97, 0.705],
      [-0.8, 0.625],
      [-0.55, 0.535],
      [-0.32, 0.455],
      [-0.18, 0.41],
    ];
    const narrow = (x: number) => 1 - 0.32 * THREE.MathUtils.clamp((-x - 0.45) / 0.55, 0, 1);
    const white = mat(COLORS.body, { rough: 0.28 });
    for (const z of [-1, 1]) {
      const spread: V3 = [0, 0, z * 0.28];
      add(taperZ(profile(side, 0.018, z * 0.19, 0.006), narrow), white, spread);
      // black lower trim above the engine
      add(
        taperZ(
          profile(
            [
              [-0.18, 0.41],
              [-0.32, 0.455],
              [-0.55, 0.535],
              [-0.8, 0.625],
              [-0.8, 0.66],
              [-0.55, 0.572],
              [-0.32, 0.492],
              [-0.17, 0.448],
            ],
            0.022,
            z * 0.1915,
            0,
          ),
          narrow,
        ),
        mat(COLORS.matteBlack, { rough: 0.6 }),
        spread,
      );
      // red and black swoosh stripes
      add(
        taperZ(
          profile(
            [
              [-0.27, 0.565],
              [-0.88, 0.735],
              [-0.87, 0.752],
              [-0.29, 0.592],
            ],
            0.004,
            z * 0.2015,
            0,
          ),
          narrow,
        ),
        mat(COLORS.red, { rough: 0.35 }),
        spread,
      );
      add(
        taperZ(
          profile(
            [
              [-0.36, 0.615],
              [-0.8, 0.735],
              [-0.795, 0.745],
              [-0.37, 0.628],
            ],
            0.004,
            z * 0.2015,
            0,
          ),
          narrow,
        ),
        mat(COLORS.matteBlack, { rough: 0.4 }),
        spread,
      );
    }
    // dark centre cover between floor and seat
    add(
      profile(
        [
          [0.06, 0.345],
          [-0.17, 0.345],
          [-0.17, 0.705],
          [-0.1, 0.72],
          [-0.03, 0.55],
        ],
        0.3,
        0,
        0.02,
      ),
      mat(COLORS.trim, { rough: 0.7 }),
    );
    const tail = rbox(0.06, 0.06, 0.25, 0.025);
    tail.translate(-0.97, 0.75, 0);
    add(tail, white);
    // grab rail
    add(
      tube(
        [
          [-0.7, 0.815, -0.14],
          [-0.88, 0.84, -0.13],
          [-0.96, 0.845, -0.06],
          [-0.96, 0.845, 0.06],
          [-0.88, 0.84, 0.13],
          [-0.7, 0.815, 0.14],
        ],
        0.012,
      ),
      mat(COLORS.matteBlack, { rough: 0.5 }),
    );
  });

  part("rear_fender", [-0.3, 0.26, 0], (add) => {
    const g = new THREE.TorusGeometry(0.285, 0.026, 8, 40, 1.4);
    g.scale(1, 1, 2.2);
    g.rotateZ(1.15);
    g.translate(...R);
    add(g, mat(COLORS.matteBlack, { rough: 0.7 }));
    // plate bracket stalk and plate
    add(tube([[-0.95, 0.7, 0], [-1.0, 0.64, 0], [-1.04, 0.56, 0]], 0.018), mat(COLORS.matteBlack, { rough: 0.6 }));
    const plate = rbox(0.012, 0.1, 0.2, 0.004);
    plate.rotateZ(deg(-12));
    plate.translate(-1.05, 0.5, 0);
    add(plate, mat(COLORS.black));
  });

  part("taillight", [-0.46, 0.26, 0], (add) => {
    const g = rbox(0.035, 0.04, 0.14, 0.012);
    g.translate(-0.995, 0.74, 0);
    add(g, mat(COLORS.red, { emissive: 0xff2030, emissiveIntensity: 0.55, rough: 0.2 }));
    // rear turn signals on the plate bracket
    for (const z of [-1, 1]) {
      add(cylBetween([-1.02, 0.6, z * 0.02], [-1.02, 0.6, z * 0.09], 0.006), mat(COLORS.matteBlack));
      const s = new THREE.SphereGeometry(0.022, 16, 12);
      s.scale(1.3, 0.8, 0.9);
      s.translate(-1.025, 0.6, z * 0.105);
      add(s, mat(COLORS.amber, { emissive: 0xff8a00, emissiveIntensity: 0.35, rough: 0.2 }));
    }
  });

  // Base positions for per-mesh spreading
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.base = o.position.clone();
  });

  return { root, nodes };
}

/** Apply explode amount t in [0, 1]. */
export function applyExplode(nodes: Map<string, PartNode>, t: number) {
  const e = t * t * (3 - 2 * t); // smoothstep for a nicer reveal
  for (const n of nodes.values()) {
    n.group.position.copy(n.explode).multiplyScalar(e);
    for (const m of n.meshes) {
      const ex = m.userData.ex as THREE.Vector3 | undefined;
      if (ex) m.position.copy(m.userData.base as THREE.Vector3).addScaledVector(ex, e);
    }
  }
}
