'use client';

import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CONTAINERS, footprintLength, packPallets, PlacedPallet } from '@/lib/engine/floorPlan';
import { PALLET_BASE_HEIGHT_MM } from '@/lib/constants';
import { familyColorMap } from '@/lib/familyColors';
import { PalletPlan, ShipmentResult } from '@/lib/types';
import {
  loadThree, Mesh, Object3D, OrbitControls, PerspectiveCamera, Raycaster, Scene, ThreeLib, Vector3, WebGLRenderer,
} from '@/lib/loadThree';

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
  placed?: PlacedPallet[];
  // False while another tab is showing: the render loop is paused
  active: boolean;
}

const OVERFLOW_COLOR = '#ef4444';
const WOOD_COLOR = '#8b5a2b';
const HOVER_EMISSIVE = 0x333333;

// Leaves some page showing on a phone, where the canvas takes every drag
const VIEW_HEIGHT = 'min(520px, 70vh)';
const TAP_MAX_MOVE_PX = 10;
const LAYER_GAP_MM = 3;
const FOV_DEG = 40;
const NEAR_MM = 100;
const FRAME_MARGIN = 1.08;
// Stops the walls z-fighting with pallets that touch them
const SHELL_BLEED_MM = 2;

// A box in container coordinates. Scene units are raw mm with the origin at the
// container's front floor corner: X = engine x (length), Y = up, Z = engine y
// (width), which puts the top-down view the same way round as the 2D floor plan.
interface Box {
  x: number;
  y: number;
  z: number;
  l: number;
  h: number;
  w: number;
}

interface Stage {
  three: ThreeLib;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  raycaster: Raycaster;
  pickable: Mesh[];
  solids: Box[];
  bounds: { l: number; h: number; w: number };
  safePosition: Vector3 | null;
  safeTarget: Vector3 | null;
}

interface Tooltip {
  pallet: PalletPlan;
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isInside(p: Vector3, b: Box) {
  return (
    p.x > b.x - NEAR_MM && p.x < b.x + b.l + NEAR_MM &&
    p.y > b.y - NEAR_MM && p.y < b.y + b.h + NEAR_MM &&
    p.z > b.z - NEAR_MM && p.z < b.z + b.w + NEAR_MM
  );
}

// Camera distance from the box's centre, along unit vector `dir`, at which all
// eight corners just fit in view
function fitDistance(size: { l: number; h: number; w: number }, dir: { x: number; y: number; z: number }, aspect: number) {
  const tanV = Math.tan((FOV_DEG * Math.PI) / 360);
  const tanH = tanV * aspect;
  // Camera's right and up axes; world up is +Y
  const rightLen = Math.hypot(dir.x, dir.z);
  const right = { x: dir.z / rightLen, z: -dir.x / rightLen };
  const up = {
    x: -dir.x * dir.y / rightLen,
    y: rightLen,
    z: -dir.z * dir.y / rightLen,
  };
  let distance = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = { x: (sx * size.l) / 2, y: (sy * size.h) / 2, z: (sz * size.w) / 2 };
    const towardCamera = c.x * dir.x + c.y * dir.y + c.z * dir.z;
    const across = Math.abs(c.x * right.x + c.z * right.z);
    const upward = Math.abs(c.x * up.x + c.y * up.y + c.z * up.z);
    distance = Math.max(distance, towardCamera + across / tanH, towardCamera + upward / tanV);
  }
  return distance;
}

// Wood base plus one box per layer, bottom first, from `floorMm` up. Gaps are taken
// out of each layer's height so the top still lands on the pallet's real height.
// Motor pallets and older saved results have no layers, so draw as one block.
function palletBoxes(pallet: PalletPlan, x: number, z: number, floorMm: number) {
  const base = PALLET_BASE_HEIGHT_MM;
  const parts: Array<Box & { wood: boolean }> = [
    { x, y: floorMm, z, l: pallet.lengthMm, h: base, w: pallet.widthMm, wood: true },
  ];
  const layers = pallet.layers?.length
    ? pallet.layers
    : [{ lengthMm: pallet.lengthMm, heightMm: pallet.heightMm - base }];
  let y = floorMm + base;
  for (const layer of layers) {
    parts.push({
      x,
      y: y + LAYER_GAP_MM,
      z,
      l: layer.lengthMm,
      h: Math.max(1, layer.heightMm - LAYER_GAP_MM),
      w: pallet.widthMm,
      wood: false,
    });
    y += layer.heightMm;
  }
  return parts;
}

export default function Container3DView({ pallets, recommendation, placed: savedPlaced, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hovered = useRef<{ id: string; meshes: Mesh[] } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const [three, setThree] = useState<ThreeLib | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // LCL has no container or saved positions, so it previews the load as if booked
  // as FCL: flat on the floor of a 20ft if it fits there, otherwise a 40ft
  const isLcl = recommendation === 'LCL';
  const containerKey = useMemo(() => {
    if (recommendation === 'FCL_20FT') return 'FCL_20FT';
    if (!isLcl) return 'FCL_40FT';
    return packPallets(pallets, CONTAINERS.FCL_20FT.LENGTH).every(p => !p.overflow) ? 'FCL_20FT' : 'FCL_40FT';
  }, [recommendation, isLcl, pallets]);
  const container = CONTAINERS[containerKey];

  const placed = useMemo(
    () => (isLcl ? null : savedPlaced) ?? packPallets(pallets, container.LENGTH),
    [isLcl, savedPlaced, pallets, container.LENGTH],
  );

  const familyColors = useMemo(() => familyColorMap(pallets), [pallets]);

  const overflowCount = placed.filter(p => p.overflow).length;

  // Fetch the library
  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadThree()
      .then(lib => { if (!cancelled) setThree(() => lib); })
      .catch(() => { if (!cancelled) setError('Could not load the 3D library. Check your internet connection and try again.'); });
    return () => { cancelled = true; };
  }, [attempt]);

  // Renderer, camera and controls live as long as the component
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!three || !canvas || !wrap) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new three.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setError('3D view needs WebGL, which is not available in this browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new three.Scene();
    scene.background = new three.Color('#f8faff');
    scene.add(new three.AmbientLight(0xffffff, 0.75));
    const sun = new three.DirectionalLight(0xffffff, 0.55);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);

    const camera = new three.PerspectiveCamera(FOV_DEG, 1, NEAR_MM, 200000);
    const controls = new three.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the floor

    const resize = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (!width || !height) return; // hidden tab
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    // Fires on window resize and on anything else that changes the panel's size
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    setStage({
      three, renderer, scene, camera, controls,
      raycaster: new three.Raycaster(),
      pickable: [],
      solids: [],
      bounds: { l: 0, h: 0, w: 0 },
      safePosition: null,
      safeTarget: null,
    });

    return () => {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      setStage(null);
    };
  }, [three]);

  // Container and pallets; rebuilt when the result changes
  useEffect(() => {
    if (!stage) return;
    const { three: T, scene, camera, controls } = stage;
    const group = new T.Group();
    const disposables: Array<{ dispose(): void }> = [];
    const pickable: Mesh[] = [];
    const solids: Box[] = [];

    const edgeMaterial = new T.LineBasicMaterial({ color: new T.Color('#0f172a'), transparent: true, opacity: 0.3 });
    disposables.push(edgeMaterial);

    const addBox = (box: Box, color: string, palletId: string) => {
      const geometry = new T.BoxGeometry(box.l, box.h, box.w);
      const material = new T.MeshLambertMaterial({ color: new T.Color(color) });
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(box.x + box.l / 2, box.y + box.h / 2, box.z + box.w / 2);
      mesh.userData.palletId = palletId;
      const edgesGeometry = new T.EdgesGeometry(geometry);
      const edges: Object3D = new T.LineSegments(edgesGeometry, edgeMaterial);
      edges.position.copy(mesh.position);
      group.add(mesh, edges);
      disposables.push(geometry, material, edgesGeometry);
      pickable.push(mesh);
      solids.push(box);
    };

    const { LENGTH: L, HEIGHT: H, WIDTH: W } = container;

    // Floor: solid, its top surface at y = 0
    const floorGeometry = new T.BoxGeometry(L, 20, W);
    const floorMaterial = new T.MeshLambertMaterial({ color: new T.Color('#cbd5e1') });
    const floor = new T.Mesh(floorGeometry, floorMaterial);
    floor.position.set(L / 2, -10, W / 2);
    group.add(floor);
    disposables.push(floorGeometry, floorMaterial);

    // Walls: see-through, with solid edges
    const shellGeometry = new T.BoxGeometry(L + SHELL_BLEED_MM, H + SHELL_BLEED_MM, W + SHELL_BLEED_MM);
    const shellMaterial = new T.MeshBasicMaterial({
      color: new T.Color('#9ca3af'), transparent: true, opacity: 0.08, depthWrite: false, side: T.DoubleSide,
    });
    const shell = new T.Mesh(shellGeometry, shellMaterial);
    shell.position.set(L / 2, H / 2, W / 2);
    const shellEdgesGeometry = new T.EdgesGeometry(shellGeometry);
    const shellEdgeMaterial = new T.LineBasicMaterial({ color: new T.Color('#1e40af') });
    const shellEdges: Object3D = new T.LineSegments(shellEdgesGeometry, shellEdgeMaterial);
    shellEdges.position.copy(shell.position);
    group.add(shell, shellEdges);
    disposables.push(shellGeometry, shellMaterial, shellEdgesGeometry, shellEdgeMaterial);

    // Pallets, at the positions the floor plan draws them. A top pallet of a stack
    // sits on its bottom pallet. Overflow pallets stay at their true position, past
    // the container end, in red.
    let extentL = L;
    for (const p of placed) {
      extentL = Math.max(extentL, p.x + footprintLength(p));
      const stack = p.stackedPallet
        ? [{ pallet: p.pallet, floorMm: 0 }, { pallet: p.stackedPallet, floorMm: p.pallet.heightMm }]
        : [{ pallet: p.pallet, floorMm: 0 }];
      for (const { pallet, floorMm } of stack) {
        const familyColor = p.overflow ? OVERFLOW_COLOR : (familyColors[pallet.family] ?? '#94a3b8');
        for (const { wood, ...box } of palletBoxes(pallet, p.x, p.y, floorMm)) {
          addBox(box, wood ? WOOD_COLOR : familyColor, pallet.palletId);
        }
      }
    }

    scene.add(group);
    stage.pickable = pickable;
    stage.solids = solids;
    stage.bounds = { l: extentL, h: H, w: W };

    // Opening view: above and to the front-right, far enough to frame everything
    const dir = { x: 0.5, y: 0.42, z: 0.757 }; // unit length
    const distance = FRAME_MARGIN * fitDistance({ l: extentL, h: H, w: W }, dir, camera.aspect);
    const radius = Math.hypot(extentL, H, W) / 2;
    controls.target.set(extentL / 2, H / 2, W / 2);
    camera.position.set(
      controls.target.x + dir.x * distance,
      controls.target.y + dir.y * distance,
      controls.target.z + dir.z * distance,
    );
    controls.minDistance = 1500;
    controls.maxDistance = distance * 2.5;
    camera.far = controls.maxDistance + radius * 2;
    camera.updateProjectionMatrix();
    controls.update();
    stage.safePosition = null;
    stage.safeTarget = null;

    return () => {
      hovered.current = null;
      setTooltip(null);
      scene.remove(group);
      stage.pickable = [];
      stage.solids = [];
      disposables.forEach(d => d.dispose());
    };
  }, [stage, placed, familyColors, container]);

  // Render loop: runs only while this tab is showing
  useEffect(() => {
    if (!stage || !active) return;
    const { renderer, scene, camera, controls } = stage;
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const { target } = controls;
      // Panning can't drag the view away from the container
      target.set(
        clamp(target.x, 0, stage.bounds.l),
        clamp(target.y, 0, stage.bounds.h),
        clamp(target.z, 0, stage.bounds.w),
      );
      controls.update();
      // minDistance only measures from the target, so stop the camera entering a box directly
      if (stage.safePosition && stage.safeTarget && stage.solids.some(b => isInside(camera.position, b))) {
        camera.position.copy(stage.safePosition);
        target.copy(stage.safeTarget);
      } else {
        stage.safePosition = camera.position.clone();
        stage.safeTarget = target.clone();
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      setHover(null);
      setTooltip(null);
    };
    // setHover only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, active]);

  function setHover(id: string | null) {
    if (hovered.current?.id === id) return;
    hovered.current?.meshes.forEach(m => m.material.emissive?.setHex(0x000000));
    hovered.current = null;
    if (!id || !stage) return;
    const meshes = stage.pickable.filter(m => m.userData.palletId === id);
    meshes.forEach(m => m.material.emissive?.setHex(HOVER_EMISSIVE));
    hovered.current = { id, meshes };
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!stage) return;
    // No hover while dragging the view
    if (e.buttons !== 0) {
      setHover(null);
      setTooltip(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    stage.raycaster.setFromCamera(
      new stage.three.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1),
      stage.camera,
    );
    const id = stage.raycaster.intersectObjects(stage.pickable)[0]?.object.userData.palletId as string | undefined;
    const pallet = id ? pallets.find(p => p.palletId === id) : undefined;
    setHover(pallet ? pallet.palletId : null);
    if (!pallet) {
      setTooltip(null);
      return;
    }
    // Keep the tooltip inside the panel by flipping it near the right and bottom edges
    const TOOLTIP_W = 260;
    const TOOLTIP_H = 110;
    setTooltip({
      pallet,
      left: px + 14 + TOOLTIP_W > rect.width ? Math.max(0, px - 14 - TOOLTIP_W) : px + 14,
      top: py + 14 + TOOLTIP_H > rect.height ? Math.max(0, py - 14 - TOOLTIP_H) : py + 14,
    });
  }

  function handlePointerLeave(e: PointerEvent<HTMLCanvasElement>) {
    // A finger "leaves" as soon as it lifts, which would hide a tooltip just tapped open
    if (e.pointerType === 'touch') return;
    setHover(null);
    setTooltip(null);
  }

  // Touch screens have no hover, so a tap shows the tooltip; a drag doesn't
  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    touchStart.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!touchStart.current) return;
    const moved = Math.hypot(e.clientX - touchStart.current.x, e.clientY - touchStart.current.y);
    touchStart.current = null;
    if (moved < TAP_MAX_MOVE_PX) handlePointerMove(e);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">3D Container View</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {containerKey === 'FCL_20FT' ? '20ft' : '40ft'} · {container.LENGTH/1000}m × {container.WIDTH/1000}m × {container.HEIGHT/1000}m
            {recommendation === 'MULTI_CONTAINER' && (
              <span className="ml-2 text-amber-600 font-medium">· Showing container 1 of split shipment</span>
            )}
            {isLcl && (
              <span className="ml-2 text-amber-600 font-medium">· LCL recommended — preview if booked as FCL</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {overflowCount > 0 && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
              ⚠ {overflowCount} pallet{overflowCount > 1 ? 's' : ''} overflow
            </span>
          )}
          <span className="text-xs text-gray-400">Drag to rotate · Scroll or pinch to zoom · Right-drag or two fingers to pan</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(familyColors).map(([fam, color]) => (
          <span key={fam} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: color }} />
            {fam}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: WOOD_COLOR }} />
          Wood base
        </span>
        {overflowCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-red-600">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: OVERFLOW_COLOR }} />
            Overflow
          </span>
        )}
      </div>

      {/* Scene */}
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-lg border border-gray-200"
        style={{ height: VIEW_HEIGHT }}
      >
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          style={{ display: 'block', width: '100%', height: '100%', cursor: tooltip ? 'pointer' : 'grab' }}
        />

        {!stage && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400" role="status">
            Loading 3D view…
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white p-6 text-center">
            <p className="text-sm text-red-600">{error}</p>
            {!three && (
              <button
                onClick={() => setAttempt(a => a + 1)}
                className="text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition-colors"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-white border border-blue-200 rounded-lg shadow-md px-3 py-2 text-xs text-blue-900 space-y-0.5"
            style={{ left: tooltip.left, top: tooltip.top, maxWidth: 260 }}
          >
            <div className="font-semibold">{tooltip.pallet.palletId}</div>
            <div className="text-blue-700 break-words">
              {tooltip.pallet.productCodes?.length ? tooltip.pallet.productCodes.join(', ') : tooltip.pallet.productCode}
            </div>
            <div className="text-blue-700">{tooltip.pallet.totalGrossKg} kg gross</div>
            <div className="text-blue-700">
              {tooltip.pallet.lengthMm.toLocaleString()} × {tooltip.pallet.widthMm} × {tooltip.pallet.heightMm} mm
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
