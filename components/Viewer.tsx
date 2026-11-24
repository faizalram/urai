"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { applyExplode, buildBeat, type PartNode } from "@/lib/model";
import { PART_BY_ID } from "@/lib/parts";
import type { Likelihood } from "@/lib/symptoms";

export type Highlight = { id: string; likelihood: Likelihood };

type Props = {
  explode: number;
  xray: boolean;
  highlights: Highlight[];
  selected: string | null;
  focus: { ids: string[]; n: number }; // empty ids = overview
  onSelect: (id: string | null) => void;
};

const GLOW: Record<Likelihood, number> = { high: 0xff2d3d, medium: 0xffa51f, low: 0xd9cf3a };
const SELECT = 0x2dd4bf;
const HOME = { pos: new THREE.Vector3(1.95, 1.2, 2.3), target: new THREE.Vector3(-0.08, 0.55, 0) };

function contactShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(-0.02, 0.002, 0);
  return plane;
}

export default function Viewer(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const api = useRef<{ focus: (ids: string[]) => void } | null>(null);

  useEffect(() => {
    const container = box.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2230, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 2.5);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
    camera.position.copy(HOME.pos);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(HOME.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.45;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.53;

    const grid = new THREE.GridHelper(6, 30, 0x3b4a5e, 0x263243);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);
    scene.add(contactShadow());

    const { root, nodes } = buildBeat();
    scene.add(root);
    const allMeshes: THREE.Mesh[] = [];
    for (const n of nodes.values()) {
      for (const m of n.meshes) {
        const material = m.material as THREE.MeshStandardMaterial;
        m.userData.emissive = material.emissive.getHex();
        m.userData.emissiveIntensity = material.emissiveIntensity;
        m.userData.opacity = material.opacity;
        allMeshes.push(m);
      }
    }

    // ---- sizing ----
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Narrow screens: pull the camera back so the whole bike fits
      camera.fov = w / h < 1 ? 48 : 35;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // ---- camera moves ----
    let tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null;
    const boxOf = (n: PartNode) => new THREE.Box3().setFromObject(n.group);
    function focus(ids: string[]) {
      const spread = latest.current.explode;
      // Exploded parts spread wider (most of it forward), so recentre and step back
      let target = HOME.target.clone().add(new THREE.Vector3(0.06 * spread, 0.05 * spread, 0));
      let pos = target.clone().add(HOME.pos.clone().sub(HOME.target).multiplyScalar(1 + 0.75 * spread));
      const found = ids.map((id) => nodes.get(id)).filter((n): n is PartNode => !!n);
      if (found.length) {
        const b = new THREE.Box3();
        for (const n of found) b.union(boxOf(n));
        target = b.getCenter(new THREE.Vector3());
        const size = b.getSize(new THREE.Vector3()).length();
        // Look from the side the parts are on (CVT is on the left, exhaust on the right)
        let dir = camera.position.clone().sub(controls.target).normalize();
        if (Math.abs(target.z) > 0.04) dir = new THREE.Vector3(0.5, 0.42, Math.sign(target.z)).normalize();
        else if (dir.y < 0.15) dir = dir.setY(0.3).normalize();
        // Keep enough of the bike in view to see where the parts sit
        const dist = THREE.MathUtils.clamp(size * 3, found.length > 1 ? 1.55 : 1.2, 2.8);
        pos = target.clone().addScaledVector(dir, dist);
      }
      tween = { from: [camera.position.clone(), controls.target.clone()], to: [pos, target], t: 0 };
    }
    api.current = { focus };

    // ---- picking ----
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): string | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(allMeshes, false);
      const solid = hits.find((h) => ((h.object as THREE.Mesh).material as THREE.Material).opacity >= 0.3) ?? hits[0];
      return (solid?.object.userData.partId as string) ?? null;
    };
    let down: { x: number; y: number } | null = null;
    let hovered: string | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) latest.current.onSelect(pick(e));
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      hovered = pick(e);
      const tip = tipRef.current;
      if (!tip) return;
      if (hovered) {
        const r = container.getBoundingClientRect();
        tip.textContent = PART_BY_ID.get(hovered)?.name ?? "";
        tip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 10}px)`;
        tip.style.opacity = "1";
      } else tip.style.opacity = "0";
      renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
    };
    const onLeave = () => {
      hovered = null;
      if (tipRef.current) tipRef.current.style.opacity = "0";
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    // ---- labels for highlighted parts ----
    const labelEls = new Map<string, HTMLDivElement>();
    function syncLabels(hl: Highlight[]) {
      const host = labelsRef.current;
      if (!host) return;
      const want = new Set(hl.map((h) => h.id));
      for (const [id, el] of labelEls) if (!want.has(id)) (el.remove(), labelEls.delete(id));
      hl.forEach((h, i) => {
        let el = labelEls.get(h.id);
        if (!el) {
          el = document.createElement("div");
          el.className = `tag tag-${h.likelihood}`;
          el.textContent = `${i + 1}. ${PART_BY_ID.get(h.id)?.name ?? h.id}`;
          el.onclick = () => latest.current.onSelect(h.id);
          host.appendChild(el);
          labelEls.set(h.id, el);
        } else {
          el.className = `tag tag-${h.likelihood}`;
          el.textContent = `${i + 1}. ${PART_BY_ID.get(h.id)?.name ?? h.id}`;
        }
      });
    }

    // ---- frame loop ----
    let explodeNow = latest.current.explode;
    const clock = new THREE.Clock();
    let raf = 0;
    const tmp = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.05);
      const time = clock.elapsedTime;
      const p = latest.current;

      explodeNow += (p.explode - explodeNow) * Math.min(1, Math.min(rawDt, 0.3) * 6);
      applyExplode(nodes, explodeNow);

      if (tween) {
        // time-based so slow devices still finish the move on time
        tween.t = Math.min(1, tween.t + Math.min(rawDt, 0.3) / 0.8);
        const k = 1 - Math.pow(1 - tween.t, 3);
        camera.position.lerpVectors(tween.from[0], tween.to[0], k);
        controls.target.lerpVectors(tween.from[1], tween.to[1], k);
        if (tween.t >= 1) tween = null;
      }

      const hl = new Map(p.highlights.map((h) => [h.id, h.likelihood]));
      const ghost = hl.size > 0;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      for (const n of nodes.values()) {
        const lik = hl.get(n.id);
        const isSel = p.selected === n.id;
        const isHover = hovered === n.id;
        const isBody = PART_BY_ID.get(n.id)?.group === "bodi";
        let opacity = 1;
        if (ghost && !lik && !isSel) opacity = n.id === "frame_esaf" || n.id.endsWith("_wheel") ? 0.16 : 0.08;
        else if (p.xray && isBody && !lik && !isSel) opacity = 0.12;
        for (const m of n.meshes) {
          const mat = m.material as THREE.MeshStandardMaterial;
          const base = m.userData.opacity as number;
          mat.opacity = Math.min(base, opacity);
          mat.depthWrite = mat.opacity > 0.5;
          if (isSel) {
            mat.emissive.setHex(SELECT);
            mat.emissiveIntensity = 0.45 + 0.15 * pulse;
          } else if (lik) {
            mat.emissive.setHex(GLOW[lik]);
            mat.emissiveIntensity = (lik === "high" ? 0.45 : 0.3) + (lik === "high" ? 0.45 : 0.25) * pulse;
          } else if (isHover) {
            mat.emissive.setHex(0x8fb4d9);
            mat.emissiveIntensity = 0.25;
          } else {
            mat.emissive.setHex(m.userData.emissive as number);
            mat.emissiveIntensity = m.userData.emissiveIntensity as number;
          }
        }
      }

      syncLabels(p.highlights);
      const r = container.getBoundingClientRect();
      const placed: { x: number; y: number; w: number; el: HTMLDivElement; hidden: boolean }[] = [];
      for (const [id, el] of labelEls) {
        const n = nodes.get(id);
        if (!n) continue;
        boxOf(n).getCenter(tmp).project(camera);
        placed.push({ x: ((tmp.x + 1) / 2) * r.width, y: ((1 - tmp.y) / 2) * r.height, w: el.offsetWidth || 120, el, hidden: tmp.z > 1 });
      }
      // Nudge labels apart vertically so they don't sit on top of each other
      placed.sort((a, b) => a.y - b.y);
      for (let i = 1; i < placed.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = placed[j];
          const b = placed[i];
          if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 6 && b.y - a.y < 28) b.y = a.y + 28;
        }
      }
      for (const l of placed) {
        l.el.style.opacity = l.hidden ? "0" : "1";
        l.el.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -140%)`;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      for (const el of labelEls.values()) el.remove();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.focus(props.focus.ids);
  }, [props.focus]);

  return (
    <div className="viewer" ref={box}>
      <div className="labels" ref={labelsRef} />
      <div className="tip" ref={tipRef} />
    </div>
  );
}
