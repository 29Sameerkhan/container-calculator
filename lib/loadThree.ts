// Loads Three.js r128 and its OrbitControls from CDN on first use, so nothing is
// fetched until the 3D tab is opened. There is no `three` package in this project,
// so the types below cover only the parts of the library the 3D view uses.

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const ORBIT_CONTROLS_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): Vector3;
  copy(v: Vector3): Vector3;
  clone(): Vector3;
}

export interface Disposable {
  dispose(): void;
}

export interface Object3D {
  position: Vector3;
  userData: Record<string, unknown>;
  add(...children: Object3D[]): void;
  remove(...children: Object3D[]): void;
}

export interface Material extends Disposable {
  emissive?: { setHex(hex: number): void };
}

export interface Mesh extends Object3D {
  material: Material;
}

export interface Scene extends Object3D {
  background: unknown;
}

export interface PerspectiveCamera extends Object3D {
  aspect: number;
  fov: number;
  far: number;
  updateProjectionMatrix(): void;
}

export interface WebGLRenderer extends Disposable {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
}

export interface OrbitControls extends Disposable {
  target: Vector3;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  update(): void;
}

export interface Raycaster {
  setFromCamera(coords: unknown, camera: PerspectiveCamera): void;
  intersectObjects(objects: Object3D[]): Array<{ object: Object3D }>;
}

interface MaterialOptions {
  color?: unknown;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  side?: number;
}

export interface ThreeLib {
  DoubleSide: number;
  Scene: new () => Scene;
  Color: new (hex: string) => unknown;
  Vector2: new (x?: number, y?: number) => unknown;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => PerspectiveCamera;
  WebGLRenderer: new (options: { canvas: HTMLCanvasElement; antialias?: boolean }) => WebGLRenderer;
  AmbientLight: new (color: number, intensity: number) => Object3D;
  DirectionalLight: new (color: number, intensity: number) => Object3D;
  Group: new () => Object3D;
  BoxGeometry: new (x: number, y: number, z: number) => Disposable;
  EdgesGeometry: new (geometry: Disposable) => Disposable;
  MeshLambertMaterial: new (options: MaterialOptions) => Material;
  MeshBasicMaterial: new (options: MaterialOptions) => Material;
  LineBasicMaterial: new (options: MaterialOptions) => Material;
  Mesh: new (geometry: Disposable, material: Material) => Mesh;
  LineSegments: new (geometry: Disposable, material: Material) => Object3D;
  Raycaster: new () => Raycaster;
  OrbitControls: new (camera: PerspectiveCamera, domElement: HTMLElement) => OrbitControls;
}

declare global {
  interface Window {
    THREE?: ThreeLib;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });
}

let loading: Promise<ThreeLib> | null = null;

export function loadThree(): Promise<ThreeLib> {
  if (!loading) {
    loading = (async () => {
      // OrbitControls attaches itself to the THREE global, so THREE must come first
      if (!window.THREE) await loadScript(THREE_URL);
      if (!window.THREE?.OrbitControls) await loadScript(ORBIT_CONTROLS_URL);
      return window.THREE!;
    })().catch(err => {
      loading = null; // allow a retry after a failed download
      throw err;
    });
  }
  return loading;
}
