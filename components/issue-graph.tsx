'use client';
import { useEffect, useRef, useState } from 'react';
import SpriteText from 'three-spritetext';
import {
  createGravityLayout,
  createNebulaLayout,
  memoryLinkKey,
  nebulaVerticalOffset,
  rotateNebulaPosition,
  type GraphPosition,
  type GravityLayout,
} from '@/lib/gravity-layout';
import {
  linkEndpointId,
  type MemoryLink,
  type MemoryNode,
} from '@/lib/memory-graph';

type GraphForce = ((alpha: number) => void) & {
  initialize?: (nodes: MemoryNode[]) => void;
};

type GraphLinkForce = GraphForce & {
  distance: (accessor: (link: MemoryLink) => number) => GraphLinkForce;
  strength: (value: number) => GraphLinkForce;
};

type GraphInstance = {
  graphData: (data?: unknown) => GraphInstance;
  backgroundColor: (color: string) => GraphInstance;
  showNavInfo: (enabled: boolean) => GraphInstance;
  width: (width: number) => GraphInstance;
  height: (height: number) => GraphInstance;
  nodeId: (key: string) => GraphInstance;
  nodeLabel: (accessor: (node: MemoryNode) => string) => GraphInstance;
  nodeColor: (accessor: (node: MemoryNode) => string) => GraphInstance;
  nodeVal: (accessor: (node: MemoryNode) => number) => GraphInstance;
  nodeOpacity: (value: number) => GraphInstance;
  nodeResolution: (value: number) => GraphInstance;
  nodeThreeObjectExtend: (value: boolean) => GraphInstance;
  nodeThreeObject: (accessor: (node: MemoryNode) => unknown) => GraphInstance;
  linkColor: (accessor: (link: MemoryLink) => string) => GraphInstance;
  linkWidth: (accessor: (link: MemoryLink) => number) => GraphInstance;
  linkOpacity: (value: number) => GraphInstance;
  linkDirectionalParticles: (
    accessor: (link: MemoryLink) => number,
  ) => GraphInstance;
  linkDirectionalParticleWidth: (
    accessor: (link: MemoryLink) => number,
  ) => GraphInstance;
  linkDirectionalParticleColor: (
    accessor: (link: MemoryLink) => string,
  ) => GraphInstance;
  linkDirectionalParticleSpeed: (
    accessor: (link: MemoryLink) => number,
  ) => GraphInstance;
  linkDirectionalArrowLength: (
    accessor: (link: MemoryLink) => number,
  ) => GraphInstance;
  linkDirectionalArrowColor: (
    accessor: (link: MemoryLink) => string,
  ) => GraphInstance;
  linkCurvature: (accessor: (link: MemoryLink) => number) => GraphInstance;
  onNodeClick: (handler: (node: MemoryNode) => void) => GraphInstance;
  onNodeHover: (handler: (node: MemoryNode | null) => void) => GraphInstance;
  onNodeDrag: (
    handler: (node: MemoryNode, translate: GraphPosition) => void,
  ) => GraphInstance;
  onNodeDragEnd: (
    handler: (node: MemoryNode, translate: GraphPosition) => void,
  ) => GraphInstance;
  onBackgroundClick: (handler: () => void) => GraphInstance;
  onEngineStop: (handler: () => void) => GraphInstance;
  cooldownTicks: (value: number) => GraphInstance;
  warmupTicks: (value: number) => GraphInstance;
  d3ReheatSimulation: () => GraphInstance;
  d3Force: {
    (name: string): GraphForce | undefined;
    (name: string, force: GraphForce | null): GraphInstance;
  };
  d3AlphaDecay: (value: number) => GraphInstance;
  d3VelocityDecay: (value: number) => GraphInstance;
  cooldownTime: (value: number) => GraphInstance;
  enableNodeDrag: (value: boolean) => GraphInstance;
  cameraPosition: (
    position: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number },
    duration?: number,
  ) => GraphInstance;
  controls: () => {
    autoRotate: boolean;
    autoRotateSpeed: number;
    enabled: boolean;
    target: import('three').Vector3;
    update: () => void;
  };
  camera: () => import('three').PerspectiveCamera;
  renderer: () => import('three').WebGLRenderer;
  graph2ScreenCoords: (
    x: number,
    y: number,
    z: number,
  ) => { x: number; y: number };
  scene: () => import('three').Scene;
  refresh: () => GraphInstance;
  pauseAnimation: () => GraphInstance;
  _destructor?: () => void;
};

export type GravitySummary = Pick<
  GravityLayout,
  'directCount' | 'treeCount' | 'sedimentCount'
>;

type GraphSafeRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

// Camera distance—not node geometry—sets the presentation scale. The overview
// keeps the outer node centres visible while spending most of the former halo
// allowance; focused issues move materially closer than their tree overview.
const OVERVIEW_CAMERA_DISTANCE_FACTOR = 0.96;
const GRAVITY_CAMERA_MINIMUM_SCALE = 0.82;
const RELATED_FOCUS_CAMERA_DISTANCE_FACTOR = 0.72;

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;
  const number = Number.parseInt(full, 16);
  return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
}

function escapeGraphLabel(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character,
  );
}

function graphSeed(value: string) {
  let seed = 2166136261;
  for (const character of value) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function seededGraphRandom(initialSeed: number) {
  let seed = initialSeed;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function compactGraphTitle(value: string) {
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

function measureGraphSafeRect(container: HTMLElement): GraphSafeRect {
  const bounds = container.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const safeRect: GraphSafeRect = {
    left: 18,
    right: width - 18,
    top: 18,
    bottom: height - 18,
  };
  const shell = container.closest('main') ?? document;

  for (const obstruction of shell.querySelectorAll<HTMLElement>(
    '[data-graph-obstruction]',
  )) {
    const rect = obstruction.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (
      rect.right <= bounds.left ||
      rect.left >= bounds.right ||
      rect.bottom <= bounds.top ||
      rect.top >= bounds.bottom
    )
      continue;
    const left = rect.left - bounds.left;
    const right = rect.right - bounds.left;
    const top = rect.top - bounds.top;
    const bottom = rect.bottom - bounds.top;
    const edge = obstruction.dataset.graphObstruction;

    if (edge === 'top') safeRect.top = Math.max(safeRect.top, bottom + 18);
    if (edge === 'left') safeRect.left = Math.max(safeRect.left, right + 18);
    if (edge === 'bottom')
      safeRect.bottom = Math.min(safeRect.bottom, top - 18);
    if (edge === 'adaptive') {
      if (top > height * 0.2 && rect.width >= width * 0.62)
        safeRect.bottom = Math.min(safeRect.bottom, top - 24);
      else safeRect.right = Math.min(safeRect.right, left - 24);
    }
  }

  if (safeRect.right - safeRect.left < 96) {
    safeRect.left = 18;
    safeRect.right = width - 18;
  }
  if (safeRect.bottom - safeRect.top < 64)
    safeRect.bottom = Math.min(height - 18, safeRect.top + 64);
  return safeRect;
}

/**
 * Fit the actual nebula, not the origin. Solve the perspective bounds once for
 * each camera-space node envelope, including living motion and node radius.
 * This is event-driven; pointer movement and simulation frames never refit.
 */
function fitNebulaCamera(
  THREE: typeof import('three'),
  camera: import('three').PerspectiveCamera,
  points: Iterable<GraphPosition>,
  container: HTMLElement,
  resetOrientation = false,
  distanceFactor = 1,
) {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  const safe = measureGraphSafeRect(container);
  const padding = Math.min(
    14,
    (safe.right - safe.left) * 0.08,
    (safe.bottom - safe.top) * 0.08,
  );
  const left = ((safe.left + padding) / width) * 2 - 1;
  const right = ((safe.right - padding) / width) * 2 - 1;
  const bottom = 1 - ((safe.bottom - padding) / height) * 2;
  const top = 1 - ((safe.top + padding) / height) * 2;
  const centerX = (left + right) / 2;
  const centerY = (bottom + top) / 2;
  const orientationCamera = camera.clone();
  if (resetOrientation) {
    orientationCamera.position.set(340, 210, 640);
    orientationCamera.lookAt(0, -12, 0);
  }
  const orientation = orientationCamera.quaternion;
  const inverse = orientation.clone().invert();
  const localPoints = [...points]
    .filter((point) => Number.isFinite(point.x + point.y + point.z))
    .map((point) =>
      new THREE.Vector3(point.x, point.y, point.z).applyQuaternion(inverse),
    );
  if (!localPoints.length) return null;
  const center = new THREE.Box3()
    .setFromPoints(localPoints)
    .getCenter(new THREE.Vector3());
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanX = tanY * (width / height);
  let distance = 80;
  const nodeEnvelope = 30;
  for (const point of localPoints) {
    const local = point.clone().sub(center);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = local.x + sx * nodeEnvelope;
          const y = local.y + sy * nodeEnvelope;
          const z = local.z + sz * nodeEnvelope;
          distance = Math.max(
            distance,
            z + camera.near + 20,
            (x / tanX + right * z) / Math.max(0.001, right - centerX),
            (-x / tanX - left * z) / Math.max(0.001, centerX - left),
            (y / tanY + top * z) / Math.max(0.001, top - centerY),
            (-y / tanY - bottom * z) / Math.max(0.001, centerY - bottom),
          );
        }
      }
    }
  }
  distance = Math.max(80, distance * distanceFactor);
  const target = center
    .clone()
    .add(
      new THREE.Vector3(
        -centerX * distance * tanX,
        -centerY * distance * tanY,
        0,
      ),
    )
    .applyQuaternion(orientation);
  const position = target
    .clone()
    .add(new THREE.Vector3(0, 0, distance).applyQuaternion(orientation));
  return {
    position: { x: position.x, y: position.y, z: position.z },
    target: { x: target.x, y: target.y, z: target.z },
  };
}

/* oxlint-disable react/react-compiler -- The imperative WebGL lifecycle is intentionally isolated from React compilation. */
export function GraphStage({
  nodes,
  links,
  gravityRootId,
  selectedId,
  activeCluster,
  highlightStrength,
  highlightedIds,
  viewResetVersion,
  selectionFocusVersion,
  birthNodeId,
  birthVersion,
  onSelect,
  onGravityChange,
  onReady,
  onError,
}: {
  nodes: MemoryNode[];
  links: MemoryLink[];
  gravityRootId: string | null;
  selectedId: string | null;
  activeCluster: string | null;
  highlightStrength: number;
  highlightedIds: Set<string>;
  viewResetVersion: number;
  selectionFocusVersion: number;
  birthNodeId: string | null;
  birthVersion: number;
  onSelect: (node: MemoryNode | null) => void;
  onGravityChange: (summary: GravitySummary | null) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const graphInitializedRef = useRef(false);
  const [graphMounted, setGraphMounted] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [layoutSettledVersion, setLayoutSettledVersion] = useState(0);
  const overviewResetRef = useRef(viewResetVersion);
  const runtimeNodesRef = useRef<MemoryNode[]>([]);
  const nebulaPositionsRef = useRef<Map<string, GraphPosition>>(new Map());
  const gravityLayoutRef = useRef<GravityLayout | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const hoverRefreshFrameRef = useRef<number | null>(null);
  const clickFallbackFrameRef = useRef<number | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const draggedNodeIdRef = useRef<string | null>(null);
  const lastGraphClickRef = useRef({ id: '', at: 0 });
  const pointerStateRef = useRef({
    x: -1000,
    y: -1000,
    active: false,
    pressed: false,
    lastFrame: 0,
    downX: -1000,
    downY: -1000,
    downNodeId: '' as string,
  });
  const overviewRotationRef = useRef({ angle: 0, lastTimestamp: 0 });
  const nodeObjectRefs = useRef<Map<string, import('three').Group>>(new Map());
  const neighborIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const nebulaMaterialsRef = useRef<Array<{ opacity: number }>>([]);
  const nebulaObjectsRef = useRef<
    Array<{
      points: import('three').Points;
      geometry: import('three').BufferGeometry;
      material: import('three').PointsMaterial;
    }>
  >([]);
  const floorMaterialsRef = useRef<Array<{ opacity: number }>>([]);
  const floorGroupRef = useRef<import('three').Group | null>(null);
  const gravityCameraRef = useRef<{
    position: GraphPosition;
    target: GraphPosition;
  } | null>(null);
  const gravityOverviewCameraRef = useRef<{
    position: GraphPosition;
    target: GraphPosition;
  } | null>(null);
  const selectionFocusFrameRef = useRef<number | null>(null);
  const birthAnimationFrameRef = useRef<number | null>(null);
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  const stateRef = useRef({
    gravityRootId,
    selectedId,
    activeCluster,
    highlightStrength,
    highlightedIds,
  });
  const onSelectRef = useRef(onSelect);
  const onGravityChangeRef = useRef(onGravityChange);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const reducedMotionRef = useRef(false);
  const birthNodeIdRef = useRef(birthNodeId);

  nodesRef.current = nodes;
  linksRef.current = links;
  stateRef.current = {
    gravityRootId,
    selectedId,
    activeCluster,
    highlightStrength,
    highlightedIds,
  };
  onSelectRef.current = onSelect;
  onGravityChangeRef.current = onGravityChange;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  birthNodeIdRef.current = birthNodeId;

  useEffect(() => {
    let cancelled = false;
    let mountedGraph: GraphInstance | null = null;
    let readyReported = false;
    graphInitializedRef.current = false;
    setGraphMounted(false);
    let resizeObserver: ResizeObserver | null = null;
    let motionQuery: MediaQueryList | null = null;
    let disposePointerInteraction: (() => void) | null = null;
    let softGlowTexture: import('three').CanvasTexture | null = null;
    let activeGlowTexture: import('three').CanvasTexture | null = null;
    const nodeObjects = nodeObjectRefs.current;
    const orientNebulaObjects = (angle: number) => {
      for (const nebula of nebulaObjectsRef.current) {
        nebula.points.rotation.y = angle;
        nebula.points.position.set(0, 0, 0);
      }
    };
    const updateMotionPreference = (
      event: MediaQueryListEvent | MediaQueryList,
    ) => {
      reducedMotionRef.current = event.matches;
      overviewRotationRef.current.lastTimestamp = performance.now();
      if (event.matches) {
        overviewRotationRef.current.angle = 0;
        pointerStateRef.current.active = false;
        draggedNodeIdRef.current = null;
        orientNebulaObjects(0);
        for (const marker of nodeObjects.values()) {
          const object = marker.parent;
          object?.scale.setScalar(1);
          if (object) object.rotation.set(0, 0, 0);
        }
      }

      const graph = graphRef.current;
      if (
        !graph ||
        !graphInitializedRef.current ||
        stateRef.current.gravityRootId ||
        gravityLayoutRef.current ||
        animationFrameRef.current !== null
      )
        return;
      for (const node of runtimeNodesRef.current) {
        const anchor = nebulaPositionsRef.current.get(node.id);
        if (event.matches && anchor) {
          node.x = anchor.x;
          node.y = anchor.y;
          node.z = anchor.z;
          node.fx = anchor.x;
          node.fy = anchor.y;
          node.fz = anchor.z;
        } else {
          node.fx = undefined;
          node.fy = undefined;
          node.fz = undefined;
        }
        node.vx = 0;
        node.vy = 0;
        node.vz = 0;
      }
      if (event.matches) graph.cooldownTicks(0).refresh();
      else
        graph
          .cooldownTicks(Number.POSITIVE_INFINITY)
          .cooldownTime(Number.POSITIVE_INFINITY)
          .d3ReheatSimulation();
    };

    async function mountGraph() {
      const element = containerRef.current;
      if (!element) return;
      const testCanvas = document.createElement('canvas');
      if (
        !(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'))
      ) {
        onErrorRef.current();
        return;
      }

      try {
        motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        updateMotionPreference(motionQuery);
        motionQuery.addEventListener('change', updateMotionPreference);
        const [{ default: ForceGraph3D }, THREE] = await Promise.all([
          import('3d-force-graph'),
          import('three'),
        ]);
        if (cancelled || !containerRef.current) return;
        threeRef.current = THREE;
        const createGlowTexture = (withFlare: boolean) => {
          const surface = document.createElement('canvas');
          surface.width = 128;
          surface.height = 128;
          const context = surface.getContext('2d');
          if (context) {
            const glow = context.createRadialGradient(64, 64, 1, 64, 64, 62);
            glow.addColorStop(0, 'rgba(255,255,255,1)');
            glow.addColorStop(0.08, 'rgba(255,255,255,.92)');
            glow.addColorStop(0.28, 'rgba(255,255,255,.3)');
            glow.addColorStop(0.62, 'rgba(255,255,255,.075)');
            glow.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = glow;
            context.fillRect(0, 0, 128, 128);
            if (withFlare) {
              context.globalCompositeOperation = 'screen';
              const horizontal = context.createLinearGradient(0, 64, 128, 64);
              horizontal.addColorStop(0, 'rgba(255,255,255,0)');
              horizontal.addColorStop(0.47, 'rgba(255,255,255,.08)');
              horizontal.addColorStop(0.5, 'rgba(255,255,255,.88)');
              horizontal.addColorStop(0.53, 'rgba(255,255,255,.08)');
              horizontal.addColorStop(1, 'rgba(255,255,255,0)');
              context.fillStyle = horizontal;
              context.fillRect(0, 61, 128, 6);
              const vertical = context.createLinearGradient(64, 0, 64, 128);
              vertical.addColorStop(0, 'rgba(255,255,255,0)');
              vertical.addColorStop(0.47, 'rgba(255,255,255,.05)');
              vertical.addColorStop(0.5, 'rgba(255,255,255,.68)');
              vertical.addColorStop(0.53, 'rgba(255,255,255,.05)');
              vertical.addColorStop(1, 'rgba(255,255,255,0)');
              context.fillStyle = vertical;
              context.fillRect(61, 0, 6, 128);
            }
          }
          const texture = new THREE.CanvasTexture(surface);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          return texture;
        };
        softGlowTexture = createGlowTexture(false);
        activeGlowTexture = createGlowTexture(true);
        const finePointer = window.matchMedia(
          '(hover: hover) and (pointer: fine)',
        );

        const nebulaPositions = createNebulaLayout(
          nodesRef.current,
          linksRef.current,
        );
        nebulaPositionsRef.current = nebulaPositions;
        const runtimeNodes: MemoryNode[] = nodesRef.current.map((node) => {
          const position = nebulaPositions.get(node.id) ?? {
            x: node.x,
            y: node.y,
            z: node.z,
          };
          return {
            ...node,
            ...position,
            fx: position.x,
            fy: position.y,
            fz: position.z,
          };
        });
        runtimeNodesRef.current = runtimeNodes;
        const runtimeNodeById = new Map(
          runtimeNodes.map((node) => [node.id, node]),
        );
        const neighborIds = new Map(
          nodesRef.current.map((node) => [node.id, new Set<string>()]),
        );
        for (const link of linksRef.current) {
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          neighborIds.get(source)?.add(target);
          neighborIds.get(target)?.add(source);
        }
        neighborIdsRef.current = neighborIds;
        const nodeById = new Map(
          nodesRef.current.map((node) => [node.id, node]),
        );
        const restDistanceByLink = new Map(
          linksRef.current.map((link) => {
            const source = nebulaPositions.get(linkEndpointId(link.source));
            const target = nebulaPositions.get(linkEndpointId(link.target));
            const distance =
              source && target
                ? Math.hypot(
                    target.x - source.x,
                    target.y - source.y,
                    target.z - source.z,
                  )
                : 30;
            return [memoryLinkKey(link), distance] as const;
          }),
        );
        let neighborLabelAnchor = '';
        let neighborLabelIds = new Set<string>();
        const getNeighborLabelIds = () => {
          const anchorId =
            hoveredIdRef.current ?? stateRef.current.selectedId ?? '';
          if (anchorId === neighborLabelAnchor) return neighborLabelIds;
          neighborLabelAnchor = anchorId;
          neighborLabelIds = new Set(
            [...(neighborIdsRef.current.get(anchorId) ?? [])]
              .map((id) => nodeById.get(id))
              .filter((node): node is MemoryNode => Boolean(node))
              .sort((a, b) => {
                const aPriority = a.importance;
                const bPriority = b.importance;
                return bPriority - aPriority || a.id.localeCompare(b.id);
              })
              .slice(0, 10)
              .map((node) => node.id),
          );
          return neighborLabelIds;
        };

        const graph = new ForceGraph3D(containerRef.current, {
          controlType: 'orbit',
          rendererConfig: { antialias: true, alpha: true },
        }) as unknown as GraphInstance;
        mountedGraph = graph;
        graphRef.current = graph;
        const reportInitialized = () => {
          if (cancelled || readyReported || graphRef.current !== graph) return;
          readyReported = true;
          graphInitializedRef.current = true;
          setGraphMounted(true);
          onReadyRef.current();
        };
        const selectNodeOnce = (node: MemoryNode) => {
          const now = performance.now();
          const lastClick = lastGraphClickRef.current;
          if (lastClick.id === node.id && now - lastClick.at < 120) return;
          lastGraphClickRef.current = { id: node.id, at: now };
          onSelectRef.current(node);
        };
        let simulationNodes = runtimeNodes;
        const cameraRight = new THREE.Vector3();
        const cameraUp = new THREE.Vector3();
        const livingForce = ((alpha: number) => {
          const now = performance.now();
          const rotation = overviewRotationRef.current;
          if (
            stateRef.current.gravityRootId ||
            gravityLayoutRef.current ||
            reducedMotionRef.current ||
            animationFrameRef.current !== null ||
            selectionFocusFrameRef.current !== null
          ) {
            rotation.lastTimestamp = now;
            return;
          }

          const elapsedSeconds = rotation.lastTimestamp
            ? Math.min(0.05, Math.max(0, (now - rotation.lastTimestamp) / 1000))
            : 0;
          rotation.lastTimestamp = now;
          rotation.angle =
            (rotation.angle + elapsedSeconds * 0.055) % (Math.PI * 2);
          const pointer = pointerStateRef.current;
          const pointerResponds = pointer.active && !pointer.pressed;
          if (pointerResponds) {
            const camera = graph.camera();
            cameraRight
              .set(1, 0, 0)
              .applyQuaternion(camera.quaternion)
              .normalize();
            cameraUp
              .set(0, 1, 0)
              .applyQuaternion(camera.quaternion)
              .normalize();
          }

          for (const node of simulationNodes) {
            if (
              node.id === draggedNodeIdRef.current ||
              node.fx !== undefined ||
              node.fy !== undefined ||
              node.fz !== undefined
            )
              continue;
            const anchor = nebulaPositions.get(node.id);
            if (!anchor) continue;
            const target = rotateNebulaPosition(anchor, rotation.angle);
            target.y += nebulaVerticalOffset(node.id, rotation.angle);
            const spring = 0.022;
            node.vx = (node.vx ?? 0) + (target.x - node.x) * spring * alpha;
            node.vy = (node.vy ?? 0) + (target.y - node.y) * spring * alpha;
            node.vz = (node.vz ?? 0) + (target.z - node.z) * spring * alpha;

            if (pointerResponds && node.id !== hoveredIdRef.current) {
              const screen = graph.graph2ScreenCoords(node.x, node.y, node.z);
              const differenceX = screen.x - pointer.x;
              const differenceY = screen.y - pointer.y;
              const distance = Math.hypot(differenceX, differenceY);
              if (distance > 4 && distance < 140) {
                const strength = Math.pow(1 - distance / 140, 2) * 0.11 * alpha;
                const normalX = differenceX / distance;
                const normalY = -differenceY / distance;
                node.vx +=
                  (cameraRight.x * normalX + cameraUp.x * normalY) * strength;
                node.vy +=
                  (cameraRight.y * normalX + cameraUp.y * normalY) * strength;
                node.vz +=
                  (cameraRight.z * normalX + cameraUp.z * normalY) * strength;
              }
            }
          }
          orientNebulaObjects(rotation.angle);
        }) as GraphForce;
        livingForce.initialize = (nextNodes) => {
          simulationNodes = nextNodes;
        };

        const isHoverIncident = (link: MemoryLink) => {
          const hover = hoveredIdRef.current;
          if (!hover) return false;
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          return source === hover || target === hover;
        };

        const isSelectedIncident = (link: MemoryLink) => {
          const state = stateRef.current;
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          return Boolean(
            state.selectedId &&
            (source === state.selectedId || target === state.selectedId),
          );
        };

        const isActiveIncident = (link: MemoryLink) => {
          const source = nodeById.get(linkEndpointId(link.source));
          const target = nodeById.get(linkEndpointId(link.target));
          return source?.phase === 'active' || target?.phase === 'active';
        };

        const isPrimaryTreeLink = (link: MemoryLink) => {
          return (
            gravityLayoutRef.current?.primaryLinkKeys.has(
              memoryLinkKey(link),
            ) ?? false
          );
        };

        const isFocusedCrossLink = (link: MemoryLink) => {
          const gravity = gravityLayoutRef.current;
          if (!gravity) return false;
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          return (
            gravity.focusIds.has(source) &&
            gravity.focusIds.has(target) &&
            !isPrimaryTreeLink(link)
          );
        };

        graph
          .backgroundColor('rgba(0,0,0,0)')
          .showNavInfo(false)
          .width(containerRef.current.clientWidth)
          .height(containerRef.current.clientHeight)
          .graphData({
            nodes: runtimeNodes,
            links: linksRef.current.map((link) => ({ ...link })),
          })
          .nodeId('id')
          .nodeLabel(
            (node) =>
              `<div class="graph-tooltip"><span>${node.phase === 'active' ? '진행 중 · 처리 전 이슈' : '처리 완료 · 이슈 기억'}</span><strong>${escapeGraphLabel(node.issueKey)}</strong><p>${escapeGraphLabel(node.name)}</p></div>`,
          )
          .nodeColor((node) => {
            const state = stateRef.current;
            const gravity = gravityLayoutRef.current;
            const hover = hoveredIdRef.current;
            const selectedNeighbor = Boolean(
              state.selectedId &&
              neighborIdsRef.current.get(state.selectedId)?.has(node.id),
            );
            const hoverNeighbor = Boolean(
              hover && neighborIdsRef.current.get(hover)?.has(node.id),
            );
            const bright = new THREE.Color(node.color).lerp(
              new THREE.Color('#ffffff'),
              state.highlightStrength * 0.55,
            );
            if (
              node.id === state.selectedId ||
              node.id === hover ||
              node.id === state.gravityRootId
            )
              return '#' + bright.getHexString();
            if (
              selectedNeighbor ||
              hoverNeighbor ||
              state.highlightedIds.has(node.id)
            )
              return hexToRgba(node.color, 0.96);
            const dim = 0.76 - state.highlightStrength * 0.58;
            if (gravity) {
              const depth = gravity.depthById.get(node.id);
              return hexToRgba(
                node.color,
                depth === undefined
                  ? Math.max(0.18, dim * 0.8)
                  : Math.max(
                      0.28,
                      0.82 - depth * state.highlightStrength * 0.19,
                    ),
              );
            }
            if (
              hover ||
              state.selectedId ||
              state.highlightedIds.size ||
              (state.activeCluster && node.cluster !== state.activeCluster)
            )
              return hexToRgba(node.color, dim);
            return hexToRgba(node.color, 0.85);
          })
          .nodeVal((node) => {
            const gravity = gravityLayoutRef.current;
            const depth = gravity?.depthById.get(node.id);
            const state = stateRef.current;
            const hover = hoveredIdRef.current;
            const selectedNeighbor = Boolean(
              state.selectedId &&
              neighborIdsRef.current.get(state.selectedId)?.has(node.id),
            );
            const hoverNeighbor = Boolean(
              hover && neighborIdsRef.current.get(hover)?.has(node.id),
            );
            if (node.id === hover || node.id === state.selectedId) return 10;
            if (node.id === state.gravityRootId) return 9.5;
            if (node.phase === 'active') return 8.5;
            if (selectedNeighbor || hoverNeighbor)
              return 5.8 + node.importance * 2;
            if (depth === 1) return 5.5 + node.importance * 2;
            if (depth === 2) return 4 + node.importance;
            if (depth === 3) return 2.7 + node.importance * 0.7;
            return 3;
          })
          .nodeOpacity(1)
          .nodeResolution(12)
          .nodeThreeObjectExtend(true)
          .nodeThreeObject((node) => {
            const gravity = gravityLayoutRef.current;
            const depth = gravity?.depthById.get(node.id);
            const state = stateRef.current;
            const hover = hoveredIdRef.current;
            const isHovered = node.id === hover;
            const isSelected = node.id === state.selectedId;
            const isRoot = node.id === state.gravityRootId;
            const isActive = node.phase === 'active';
            const isBorn = node.id === birthNodeIdRef.current;
            const showNeighborLabel = getNeighborLabelIds().has(node.id);
            const group = new THREE.Group();
            nodeObjects.set(node.id, group);
            const haloTexture = isActive ? activeGlowTexture : softGlowTexture;
            if (haloTexture) {
              const halo = new THREE.Sprite(
                new THREE.SpriteMaterial({
                  map: haloTexture,
                  color: node.color,
                  transparent: true,
                  opacity: isSelected
                    ? 1
                    : isRoot
                      ? 0.86
                      : isHovered
                        ? 0.72
                        : isActive
                          ? 0.78
                          : 0.2,
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                  toneMapped: false,
                }),
              );
              const haloSize = isSelected
                ? isActive
                  ? 32
                  : 20
                : isActive
                  ? 24
                  : 11 + node.importance * 4;
              halo.scale.set(haloSize, haloSize, 1);
              halo.renderOrder = 1;
              group.add(halo);
            }
            if (
              !(
                isSelected ||
                isRoot ||
                isHovered ||
                isBorn ||
                showNeighborLabel ||
                depth === 1
              )
            )
              return group;
            const detailedLabel = isSelected || isRoot || isHovered || isBorn;
            const sprite = new SpriteText(
              `${isActive ? '진행 · ' : ''}${node.issueKey}${
                detailedLabel ? `\n${compactGraphTitle(node.name)}` : ''
              }`,
            );
            sprite.color = isActive
              ? '#ffffff'
              : isBorn
                ? '#ffffff'
                : isHovered
                  ? '#dcdcaa'
                  : isSelected
                    ? '#f3f3f3'
                    : isRoot
                      ? '#f3f3f3'
                      : node.color;
            sprite.textHeight = depth === 1 || showNeighborLabel ? 2.7 : 3.1;
            sprite.fontWeight = '600';
            sprite.backgroundColor =
              isActive || isSelected || isRoot || isHovered || isBorn
                ? 'rgba(37,37,38,.94)'
                : false;
            sprite.padding =
              isActive || isSelected || isRoot || isHovered || isBorn
                ? [3, 5]
                : 0;
            sprite.borderRadius = 1;
            sprite.position.y = isActive ? 14 : detailedLabel ? 10 : 8;
            group.add(sprite);

            if (isActive || isSelected || isRoot || isHovered || isBorn) {
              const ringColor = isActive
                ? '#ffffff'
                : isHovered
                  ? '#dcdcaa'
                  : node.color;
              const innerOpacity = isHovered
                ? 0.9
                : isActive || isSelected
                  ? 0.82
                  : isRoot
                    ? 0.46
                    : 0.38;
              const outerOpacity = isHovered
                ? 0.34
                : isSelected
                  ? 0.28
                  : isRoot
                    ? 0.14
                    : 0.11;
              const ring = new THREE.Mesh(
                new THREE.TorusGeometry(
                  isActive ? 10 : 8.5,
                  isSelected ? 0.24 : isActive ? 0.15 : 0.12,
                  8,
                  64,
                ),
                new THREE.MeshBasicMaterial({
                  color: ringColor,
                  transparent: true,
                  opacity: innerOpacity,
                }),
              );
              const orbit = new THREE.Mesh(
                new THREE.TorusGeometry(
                  isActive ? 12.2 : 9.8,
                  isSelected ? 0.07 : 0.055,
                  7,
                  64,
                ),
                new THREE.MeshBasicMaterial({
                  color: ringColor,
                  transparent: true,
                  opacity: outerOpacity,
                }),
              );
              orbit.position.set(0.45, -0.3, -0.25);
              orbit.rotation.z = Math.PI * 0.025;
              group.add(ring);
              if (isSelected || isRoot || isHovered || isBorn) group.add(orbit);
            }
            if (isBorn) {
              const burst = new THREE.Group();
              const materials: import('three').MeshBasicMaterial[] = [];
              for (const [radius, opacity] of [
                [7, 0.95],
                [13, 0.66],
                [19, 0.34],
              ] as const) {
                const material = new THREE.MeshBasicMaterial({
                  color: radius === 7 ? '#ffffff' : '#dcdcaa',
                  transparent: true,
                  opacity,
                  depthWrite: false,
                });
                materials.push(material);
                const flare = new THREE.Mesh(
                  new THREE.TorusGeometry(
                    radius,
                    radius === 7 ? 0.5 : 0.18,
                    8,
                    72,
                  ),
                  material,
                );
                flare.rotation.x = radius === 13 ? Math.PI / 2.8 : 0;
                flare.rotation.y = radius === 19 ? Math.PI / 3.2 : 0;
                burst.add(flare);
              }
              group.userData.birthBurst = burst;
              group.userData.birthMaterials = materials;
              group.add(burst);
            }
            return group;
          })
          .linkColor((link) => {
            if (isSelectedIncident(link)) return 'rgba(245,248,252,.96)';
            if (isHoverIncident(link)) return 'rgba(220,220,190,.8)';
            if (isPrimaryTreeLink(link)) {
              const gravity = gravityLayoutRef.current;
              const depth = Math.max(
                gravity?.depthById.get(linkEndpointId(link.source)) ?? 0,
                gravity?.depthById.get(linkEndpointId(link.target)) ?? 0,
              );
              return `rgba(86,156,214,${depth <= 1 ? 0.62 : depth === 2 ? 0.43 : 0.28})`;
            }
            if (isFocusedCrossLink(link)) return 'rgba(197,134,192,.2)';
            if (gravityLayoutRef.current) return 'rgba(133,148,162,.11)';
            if (
              stateRef.current.activeCluster &&
              nodeById.get(linkEndpointId(link.source))?.cluster !==
                stateRef.current.activeCluster
            )
              return 'rgba(123,137,151,.08)';
            if (isActiveIncident(link))
              return `rgba(237,243,249,${0.26 + link.score * 0.16})`;
            return `rgba(132,153,174,${0.12 + link.score * 0.16})`;
          })
          .linkWidth((link) => {
            if (isSelectedIncident(link)) return 1.35;
            if (isHoverIncident(link)) return 1;
            if (isPrimaryTreeLink(link)) return 0.55;
            if (isFocusedCrossLink(link)) return 0.22;
            if (gravityLayoutRef.current) return 0.09;
            if (isActiveIncident(link)) return 0.28 + link.score * 0.24;
            return 0.16 + link.score * 0.18;
          })
          .linkOpacity(1)
          .linkDirectionalParticles(() => 0)
          .linkDirectionalParticleWidth(() => 0)
          .linkDirectionalParticleColor(() => '#4daafc')
          .linkDirectionalParticleSpeed(() => 0)
          .linkDirectionalArrowLength(() => 0)
          .linkDirectionalArrowColor((link) =>
            isHoverIncident(link)
              ? 'rgba(220,220,170,.16)'
              : isSelectedIncident(link)
                ? 'rgba(79,193,255,.17)'
                : 'rgba(133,133,133,0)',
          )
          .linkCurvature((link) =>
            gravityLayoutRef.current
              ? isFocusedCrossLink(link)
                ? 0.065
                : 0
              : Math.max(0.015, (link.score - 0.35) * 0.04),
          )
          .onNodeClick((node) => {
            selectNodeOnce(node);
          })
          .onNodeHover((node) => {
            const nextHoveredId = node?.id ?? null;
            if (nextHoveredId === hoveredIdRef.current) return;
            hoveredIdRef.current = nextHoveredId;
            if (hoverRefreshFrameRef.current === null) {
              hoverRefreshFrameRef.current = window.requestAnimationFrame(
                () => {
                  hoverRefreshFrameRef.current = null;
                  graphRef.current?.refresh();
                },
              );
            }
          })
          .onNodeDrag((node) => {
            const gravityTarget = gravityLayoutRef.current?.positions.get(
              node.id,
            );
            if (stateRef.current.gravityRootId) {
              if (gravityTarget)
                Object.assign(node, gravityTarget, {
                  fx: gravityTarget.x,
                  fy: gravityTarget.y,
                  fz: gravityTarget.z,
                  vx: 0,
                  vy: 0,
                  vz: 0,
                });
              return;
            }

            draggedNodeIdRef.current = node.id;
            node.vx = 0;
            node.vy = 0;
            node.vz = 0;
          })
          .onNodeDragEnd((node) => {
            draggedNodeIdRef.current = null;
            const gravityTarget = gravityLayoutRef.current?.positions.get(
              node.id,
            );
            if (stateRef.current.gravityRootId && gravityTarget) {
              Object.assign(node, gravityTarget, {
                fx: gravityTarget.x,
                fy: gravityTarget.y,
                fz: gravityTarget.z,
                vx: 0,
                vy: 0,
                vz: 0,
              });
              return;
            }

            if (reducedMotionRef.current) {
              const anchor = nebulaPositions.get(node.id);
              if (anchor)
                Object.assign(node, anchor, {
                  fx: anchor.x,
                  fy: anchor.y,
                  fz: anchor.z,
                  vx: 0,
                  vy: 0,
                  vz: 0,
                });
              graph.cooldownTicks(0).refresh();
              return;
            }

            node.fx = undefined;
            node.fy = undefined;
            node.fz = undefined;
            node.vx = 0;
            node.vy = 0;
            node.vz = 0;
            graph
              .cooldownTicks(Number.POSITIVE_INFINITY)
              .cooldownTime(Number.POSITIVE_INFINITY)
              .d3ReheatSimulation();
          })
          .onBackgroundClick(() => onSelectRef.current(null))
          .enableNodeDrag(finePointer.matches)
          .warmupTicks(0)
          .cooldownTicks(0)
          // Kapsule applies graphData in a debounced update. Only this first
          // completed engine cycle proves state.layout exists; an immediate
          // React effect could reheat it early and crash with undefined.tick.
          .onEngineStop(reportInitialized);

        const linkForce = graph.d3Force('link') as GraphLinkForce | undefined;
        if (finePointer.matches) {
          linkForce
            ?.distance(
              (link) => restDistanceByLink.get(memoryLinkKey(link)) ?? 30,
            )
            .strength(0.016);
        } else {
          graph.d3Force('link', null);
        }
        graph
          .d3Force('center', null)
          .d3Force('charge', null)
          .d3Force('living', livingForce)
          .d3AlphaDecay(0)
          .d3VelocityDecay(0.56)
          .cooldownTime(Number.POSITIVE_INFINITY);

        const controls = graph.controls();
        controls.autoRotate = false;
        graph.cameraPosition(
          { x: 340, y: 210, z: 640 },
          { x: 0, y: -12, z: 0 },
          0,
        );
        const initialFrame = fitNebulaCamera(
          THREE,
          graph.camera(),
          nebulaPositions.values(),
          element,
          true,
          OVERVIEW_CAMERA_DISTANCE_FACTOR,
        );
        if (initialFrame)
          graph.cameraPosition(initialFrame.position, initialFrame.target, 0);

        const dustPositions: number[] = [];
        const dustColours: number[] = [];
        const coolMist = new THREE.Color('#aebfce');
        for (const node of nodesRef.current) {
          const center = nebulaPositionsRef.current.get(node.id);
          if (!center) continue;
          const random = seededGraphRandom(graphSeed(`dust:${node.id}`));
          const dustCount = node.phase === 'active' ? 4 : 6;
          const baseColour = new THREE.Color(node.color);
          if (node.phase === 'memory') baseColour.lerp(coolMist, 0.54);
          for (let index = 0; index < dustCount; index += 1) {
            const radius =
              Math.cbrt(random()) * (node.phase === 'active' ? 18 : 30);
            const vertical = random() * 2 - 1;
            const angle = random() * Math.PI * 2;
            const equator = Math.sqrt(Math.max(0, 1 - vertical * vertical));
            dustPositions.push(
              center.x + Math.cos(angle) * equator * radius,
              center.y + Math.sin(angle) * equator * radius,
              center.z + vertical * radius,
            );
            const colour = baseColour
              .clone()
              .multiplyScalar(0.66 + random() * 0.34);
            dustColours.push(colour.r, colour.g, colour.b);
          }
        }
        const dustGeometry = new THREE.BufferGeometry();
        dustGeometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(dustPositions, 3),
        );
        dustGeometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(dustColours, 3),
        );
        const dustMaterial = new THREE.PointsMaterial({
          size: 0.96,
          vertexColors: true,
          transparent: true,
          opacity: 0.12,
          sizeAttenuation: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
        dustPoints.renderOrder = -1;
        graph.scene().add(dustPoints);
        nebulaMaterialsRef.current = [dustMaterial];
        nebulaObjectsRef.current = [
          {
            points: dustPoints,
            geometry: dustGeometry,
            material: dustMaterial,
          },
        ];

        const floorGroup = new THREE.Group();
        const floorPlaneMaterial = new THREE.MeshBasicMaterial({
          color: '#15171a',
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const floorPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(760, 440),
          floorPlaneMaterial,
        );
        const floorGrid = new THREE.GridHelper(760, 30, '#264f78', '#2b2b2b');
        const gridMaterial = floorGrid.material as import('three').Material;
        gridMaterial.transparent = true;
        gridMaterial.opacity = 0;
        floorGroup.add(floorPlane, floorGrid);
        floorGroup.visible = false;
        floorGroupRef.current = floorGroup;
        floorMaterialsRef.current = [floorPlaneMaterial, gridMaterial];
        graph.scene().add(floorGroup);

        const canvas = graph.renderer().domElement;
        const requestPointerFrame = () => {
          if (pointerFrameRef.current === null)
            pointerFrameRef.current =
              window.requestAnimationFrame(updatePointerObjects);
        };

        const updatePointerObjects = (timestamp: number) => {
          pointerFrameRef.current = null;
          const pointer = pointerStateRef.current;
          if (timestamp - pointer.lastFrame < 30) {
            requestPointerFrame();
            return;
          }
          const deltaSeconds = pointer.lastFrame
            ? Math.min(0.05, (timestamp - pointer.lastFrame) / 1000)
            : 1 / 30;
          pointer.lastFrame = timestamp;
          const canRespond =
            pointer.active &&
            !pointer.pressed &&
            !reducedMotionRef.current &&
            animationFrameRef.current === null &&
            selectionFocusFrameRef.current === null;
          const blend = 1 - Math.exp(-14 * deltaSeconds);
          let unsettled = false;

          for (const node of runtimeNodesRef.current) {
            const marker = nodeObjects.get(node.id);
            const object = marker?.parent;
            if (!object) continue;
            let strength = 0;
            let tiltX = 0;
            let tiltY = 0;
            if (canRespond) {
              const screen = graph.graph2ScreenCoords(node.x, node.y, node.z);
              const differenceX = screen.x - pointer.x;
              const differenceY = screen.y - pointer.y;
              const distance = Math.hypot(differenceX, differenceY);
              if (distance < 120) {
                strength = Math.pow(1 - distance / 120, 2);
                tiltX = Math.max(
                  -0.052,
                  Math.min(0.052, (-differenceY / 120) * 0.052 * strength),
                );
                tiltY = Math.max(
                  -0.052,
                  Math.min(0.052, (differenceX / 120) * 0.052 * strength),
                );
              }
            }
            const targetScale = 1 + strength * 0.045;
            const nextScale =
              object.scale.x + (targetScale - object.scale.x) * blend;
            object.scale.setScalar(nextScale);
            object.rotation.x += (tiltX - object.rotation.x) * blend;
            object.rotation.y += (tiltY - object.rotation.y) * blend;
            if (
              Math.abs(targetScale - nextScale) > 0.0006 ||
              Math.abs(tiltX - object.rotation.x) > 0.0006 ||
              Math.abs(tiltY - object.rotation.y) > 0.0006
            )
              unsettled = true;
          }

          if (unsettled) requestPointerFrame();
          else pointer.lastFrame = 0;
        };

        const setPointerFromEvent = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect();
          const pointer = pointerStateRef.current;
          pointer.x = event.clientX - bounds.left;
          pointer.y = event.clientY - bounds.top;
          pointer.pressed = event.buttons !== 0;
          pointer.active =
            finePointer.matches &&
            event.pointerType !== 'touch' &&
            !pointer.pressed &&
            pointer.x >= 0 &&
            pointer.x <= bounds.width &&
            pointer.y >= 0 &&
            pointer.y <= bounds.height;
          requestPointerFrame();
        };
        const deactivatePointer = () => {
          const pointer = pointerStateRef.current;
          pointer.active = false;
          pointer.pressed = false;
          pointer.downNodeId = '';
          requestPointerFrame();
        };
        const pressPointer = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect();
          const pointer = pointerStateRef.current;
          pointer.x = event.clientX - bounds.left;
          pointer.y = event.clientY - bounds.top;
          pointer.downX = pointer.x;
          pointer.downY = pointer.y;
          pointer.downNodeId = hoveredIdRef.current ?? '';
          pointer.pressed = true;
          pointer.active = false;
          requestPointerFrame();
        };
        const releasePointer = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect();
          const pointer = pointerStateRef.current;
          const releaseX = event.clientX - bounds.left;
          const releaseY = event.clientY - bounds.top;
          const downNodeId = pointer.downNodeId;
          const travel = Math.hypot(
            releaseX - pointer.downX,
            releaseY - pointer.downY,
          );
          pointer.downNodeId = '';
          setPointerFromEvent(event);

          if (
            event.button !== 0 ||
            !downNodeId ||
            hoveredIdRef.current !== downNodeId ||
            travel > 4
          )
            return;
          if (clickFallbackFrameRef.current !== null)
            window.cancelAnimationFrame(clickFallbackFrameRef.current);
          clickFallbackFrameRef.current = window.requestAnimationFrame(() => {
            clickFallbackFrameRef.current = null;
            if (hoveredIdRef.current !== downNodeId) return;
            const node = runtimeNodeById.get(downNodeId);
            if (!node) return;
            selectNodeOnce(node);
          });
        };
        canvas.addEventListener('pointermove', setPointerFromEvent, {
          passive: true,
        });
        canvas.addEventListener('pointerdown', pressPointer, { passive: true });
        canvas.addEventListener('pointerup', releasePointer, { passive: true });
        canvas.addEventListener('pointerleave', deactivatePointer, {
          passive: true,
        });
        canvas.addEventListener('pointercancel', deactivatePointer, {
          passive: true,
        });
        disposePointerInteraction = () => {
          canvas.removeEventListener('pointermove', setPointerFromEvent);
          canvas.removeEventListener('pointerdown', pressPointer);
          canvas.removeEventListener('pointerup', releasePointer);
          canvas.removeEventListener('pointerleave', deactivatePointer);
          canvas.removeEventListener('pointercancel', deactivatePointer);
        };

        let observedWidth = element.clientWidth;
        let observedHeight = element.clientHeight;
        resizeObserver = new ResizeObserver(([entry]) => {
          const nextWidth = entry.contentRect.width;
          const nextHeight = entry.contentRect.height;
          graph.width(nextWidth).height(nextHeight);
          if (
            Math.abs(nextWidth - observedWidth) > 1 ||
            Math.abs(nextHeight - observedHeight) > 1
          ) {
            observedWidth = nextWidth;
            observedHeight = nextHeight;
            setViewportVersion((version) => version + 1);
          }
        });
        resizeObserver.observe(element);
      } catch (error) {
        if (cancelled) return;
        mountedGraph?.pauseAnimation();
        console.error('Unable to initialize the memory universe', error);
        onErrorRef.current();
      }
    }

    void mountGraph();
    return () => {
      cancelled = true;
      graphInitializedRef.current = false;
      resizeObserver?.disconnect();
      motionQuery?.removeEventListener('change', updateMotionPreference);
      disposePointerInteraction?.();
      if (animationFrameRef.current !== null)
        window.cancelAnimationFrame(animationFrameRef.current);
      if (pointerFrameRef.current !== null)
        window.cancelAnimationFrame(pointerFrameRef.current);
      if (hoverRefreshFrameRef.current !== null)
        window.cancelAnimationFrame(hoverRefreshFrameRef.current);
      if (clickFallbackFrameRef.current !== null)
        window.cancelAnimationFrame(clickFallbackFrameRef.current);
      if (selectionFocusFrameRef.current !== null)
        window.cancelAnimationFrame(selectionFocusFrameRef.current);
      if (birthAnimationFrameRef.current !== null)
        window.cancelAnimationFrame(birthAnimationFrameRef.current);
      for (const nebula of nebulaObjectsRef.current) {
        mountedGraph?.scene().remove(nebula.points);
        nebula.geometry.dispose();
        nebula.material.dispose();
      }
      nebulaObjectsRef.current = [];
      nebulaMaterialsRef.current = [];
      softGlowTexture?.dispose();
      activeGlowTexture?.dispose();
      nodeObjects.clear();
      if (mountedGraph) {
        mountedGraph
          .pauseAnimation()
          .onEngineStop(() => {})
          .enableNodeDrag(false);
        mountedGraph._destructor?.();
      }
      if (graphRef.current === mountedGraph) graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.controls().autoRotate = false;
    graph
      .enableNodeDrag(
        !gravityRootId &&
          window.matchMedia('(hover: hover) and (pointer: fine)').matches,
      )
      .refresh();
  }, [
    activeCluster,
    highlightStrength,
    highlightedIds,
    gravityRootId,
    selectedId,
  ]);

  useEffect(() => {
    const graph = graphRef.current;
    const THREE = threeRef.current;
    const runtimeNodes = runtimeNodesRef.current;
    if (
      !graphMounted ||
      !graphInitializedRef.current ||
      !graph ||
      !THREE ||
      !runtimeNodes.length
    )
      return;

    if (animationFrameRef.current !== null)
      window.cancelAnimationFrame(animationFrameRef.current);
    if (selectionFocusFrameRef.current !== null)
      window.cancelAnimationFrame(selectionFocusFrameRef.current);
    draggedNodeIdRef.current = null;
    for (const node of runtimeNodes) {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    }
    const starts = new Map(
      runtimeNodes.map((node) => [
        node.id,
        { x: node.x, y: node.y, z: node.z },
      ]),
    );
    const floorGroup = floorGroupRef.current;
    const camera = graph.camera();
    const controls = graph.controls();
    controls.update();
    const cameraStart = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      target: {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      },
    };
    let cameraTarget = cameraStart;
    let clearGravityCamera = false;
    let targets = nebulaPositionsRef.current;
    let nextGravity: GravityLayout | null = null;
    const resetOverview = overviewResetRef.current !== viewResetVersion;
    overviewResetRef.current = viewResetVersion;

    if (gravityRootId) {
      const root = runtimeNodes.find((node) => node.id === gravityRootId);
      if (!root) return;
      gravityCameraRef.current ??= cameraStart;
      const anchor = { x: root.x, y: root.y, z: root.z };
      const rightVector = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      const upVector = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      const forwardVector = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize();
      nextGravity = createGravityLayout({
        nodes: nodesRef.current,
        links: linksRef.current,
        rootId: gravityRootId,
        anchor,
        basis: {
          right: { x: rightVector.x, y: rightVector.y, z: rightVector.z },
          up: { x: upVector.x, y: upVector.y, z: upVector.z },
          forward: {
            x: forwardVector.x,
            y: forwardVector.y,
            z: forwardVector.z,
          },
        },
      });
      targets = nextGravity.positions;
      gravityLayoutRef.current = nextGravity;
      onGravityChangeRef.current({
        directCount: nextGravity.directCount,
        treeCount: nextGravity.treeCount,
        sedimentCount: nextGravity.sedimentCount,
      });

      const container = containerRef.current;
      const width = Math.max(1, container?.clientWidth ?? window.innerWidth);
      const height = Math.max(1, container?.clientHeight ?? window.innerHeight);
      const safeRect = container
        ? measureGraphSafeRect(container)
        : { left: 18, right: width - 18, top: 86, bottom: height - 108 };
      const anchorVector = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
      const toFrame = (
        position: GraphPosition,
        target: GraphPosition,
        scale: number,
      ) => ({
        position: anchorVector
          .clone()
          .add(
            new THREE.Vector3(position.x, position.y, position.z)
              .sub(anchorVector)
              .multiplyScalar(scale),
          ),
        target: anchorVector
          .clone()
          .add(
            new THREE.Vector3(target.x, target.y, target.z)
              .sub(anchorVector)
              .multiplyScalar(scale),
          ),
      });
      const projectionFits = (
        position: GraphPosition,
        target: GraphPosition,
        scale: number,
      ) => {
        const frame = toFrame(position, target, scale);
        const testCamera = camera.clone();
        testCamera.position.copy(frame.position);
        testCamera.lookAt(frame.target);
        testCamera.updateMatrixWorld(true);
        for (const point of targets.values()) {
          const projected = new THREE.Vector3(
            point.x,
            point.y,
            point.z,
          ).project(testCamera);
          const screenX = ((projected.x + 1) * width) / 2;
          const screenY = ((1 - projected.y) * height) / 2;
          if (
            projected.z < -1 ||
            projected.z > 1 ||
            screenX < safeRect.left ||
            screenX > safeRect.right ||
            screenY < safeRect.top ||
            screenY > safeRect.bottom
          )
            return false;
        }
        return true;
      };
      const findFitScale = (
        position: GraphPosition,
        target: GraphPosition,
        maximum: number,
      ) => {
        if (projectionFits(position, target, GRAVITY_CAMERA_MINIMUM_SCALE))
          return GRAVITY_CAMERA_MINIMUM_SCALE;
        if (!projectionFits(position, target, maximum)) return null;
        let low = GRAVITY_CAMERA_MINIMUM_SCALE;
        let high = maximum;
        for (let index = 0; index < 12; index += 1) {
          const candidate = (low + high) / 2;
          if (projectionFits(position, target, candidate)) high = candidate;
          else low = candidate;
        }
        return high;
      };

      const availableWidth = Math.max(80, safeRect.right - safeRect.left);
      const availableHeight = Math.max(100, safeRect.bottom - safeRect.top);
      const desiredScreen = {
        x: safeRect.left + availableWidth / 2,
        y: safeRect.top + Math.min(108, availableHeight * 0.24),
      };
      const desiredNdc = {
        x: (desiredScreen.x / width) * 2 - 1,
        y: 1 - (desiredScreen.y / height) * 2,
      };
      const rootInCamera = anchorVector
        .clone()
        .applyMatrix4(camera.matrixWorldInverse);
      const halfHeightAtRoot =
        Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * -rootInCamera.z;
      const cameraTranslation = rightVector
        .clone()
        .multiplyScalar(
          rootInCamera.x - desiredNdc.x * halfHeightAtRoot * camera.aspect,
        )
        .add(
          upVector
            .clone()
            .multiplyScalar(rootInCamera.y - desiredNdc.y * halfHeightAtRoot),
        );
      const framePosition = new THREE.Vector3(
        cameraStart.position.x,
        cameraStart.position.y,
        cameraStart.position.z,
      ).add(cameraTranslation);
      const frameTarget = new THREE.Vector3(
        cameraStart.target.x,
        cameraStart.target.y,
        cameraStart.target.z,
      ).add(cameraTranslation);
      const fitScale = findFitScale(framePosition, frameTarget, 12) ?? 12;

      const framed = toFrame(framePosition, frameTarget, fitScale);
      cameraTarget = {
        position: {
          x: framed.position.x,
          y: framed.position.y,
          z: framed.position.z,
        },
        target: { x: framed.target.x, y: framed.target.y, z: framed.target.z },
      };
      gravityOverviewCameraRef.current = cameraTarget;

      if (floorGroup) {
        const floorCenter = new THREE.Vector3(anchor.x, anchor.y, anchor.z)
          .addScaledVector(upVector, -355)
          .addScaledVector(forwardVector, 78);
        floorGroup.position.copy(floorCenter);
        floorGroup.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          upVector,
        );
        floorGroup.children[1].rotation.x = Math.PI / 2;
        floorGroup.visible = true;
      }
    } else {
      onGravityChangeRef.current(null);
      targets = new Map(
        [...nebulaPositionsRef.current].map(([id, position]) => {
          const target = rotateNebulaPosition(
            position,
            overviewRotationRef.current.angle,
          );
          if (!reducedMotionRef.current)
            target.y += nebulaVerticalOffset(
              id,
              overviewRotationRef.current.angle,
            );
          return [id, target];
        }),
      );
      const overviewCamera = camera.clone();
      if (gravityCameraRef.current) {
        const previous = gravityCameraRef.current;
        overviewCamera.position.set(
          previous.position.x,
          previous.position.y,
          previous.position.z,
        );
        overviewCamera.lookAt(
          previous.target.x,
          previous.target.y,
          previous.target.z,
        );
        clearGravityCamera = true;
      }
      const container = containerRef.current;
      if (container) {
        const fitted = fitNebulaCamera(
          THREE,
          overviewCamera,
          targets.values(),
          container,
          resetOverview,
          OVERVIEW_CAMERA_DISTANCE_FACTOR,
        );
        if (fitted) cameraTarget = fitted;
      }
    }

    graph.controls().autoRotate = false;
    graph.controls().enabled = reducedMotionRef.current;
    graph
      .refresh()
      .cooldownTicks(Number.POSITIVE_INFINITY)
      .d3ReheatSimulation();
    const duration = reducedMotionRef.current ? 1 : gravityRootId ? 920 : 680;
    const startedAt = performance.now();
    const nebulaStartOpacity = nebulaMaterialsRef.current[0]?.opacity ?? 0.12;
    const floorStartOpacity = floorMaterialsRef.current[0]?.opacity ?? 0;
    const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);
    const easeInOut = (value: number) =>
      value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const startCameraPosition = new THREE.Vector3(
      cameraStart.position.x,
      cameraStart.position.y,
      cameraStart.position.z,
    );
    const targetCameraPosition = new THREE.Vector3(
      cameraTarget.position.x,
      cameraTarget.position.y,
      cameraTarget.position.z,
    );
    const startCameraTarget = new THREE.Vector3(
      cameraStart.target.x,
      cameraStart.target.y,
      cameraStart.target.z,
    );
    const targetCameraTarget = new THREE.Vector3(
      cameraTarget.target.x,
      cameraTarget.target.y,
      cameraTarget.target.z,
    );

    const animate = (now: number) => {
      const elapsed = now - startedAt;
      const overall = clamp(elapsed / duration);
      for (const node of runtimeNodes) {
        const start = starts.get(node.id) ?? {
          x: node.x,
          y: node.y,
          z: node.z,
        };
        const target = targets.get(node.id) ?? start;
        const depth = nextGravity?.depthById.get(node.id);
        const isRoot = node.id === gravityRootId;
        const isSediment = Boolean(gravityRootId && depth === undefined);
        const delay =
          reducedMotionRef.current || isRoot
            ? 0
            : isSediment
              ? 40 + ((node.id.length * 37 + node.id.charCodeAt(0) * 13) % 110)
              : gravityRootId
                ? 60 + (depth ?? 0) * 62
                : (node.id.length * 19) % 70;
        const local = clamp((elapsed - delay) / Math.max(1, duration - delay));
        const horizontalProgress = easeInOut(local);
        let verticalProgress = easeInOut(local);
        if (isSediment) {
          verticalProgress = local * local * (3 - 2 * local);
        } else if (gravityRootId && !isRoot) {
          verticalProgress = easeOut(local);
        }
        node.x = start.x + (target.x - start.x) * horizontalProgress;
        node.y = start.y + (target.y - start.y) * verticalProgress;
        node.z = start.z + (target.z - start.z) * horizontalProgress;
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      }

      const materialProgress = easeOut(overall);
      const nebulaTargetOpacity = gravityRootId ? 0.018 : 0.12;
      const floorTargetOpacity = gravityRootId ? 0.07 : 0;
      for (const material of nebulaMaterialsRef.current)
        material.opacity =
          nebulaStartOpacity +
          (nebulaTargetOpacity - nebulaStartOpacity) * materialProgress;
      for (const material of floorMaterialsRef.current)
        material.opacity =
          floorStartOpacity +
          (floorTargetOpacity - floorStartOpacity) * materialProgress;
      const cameraProgress = easeInOut(overall);
      camera.position.lerpVectors(
        startCameraPosition,
        targetCameraPosition,
        cameraProgress,
      );
      controls.target.lerpVectors(
        startCameraTarget,
        targetCameraTarget,
        cameraProgress,
      );
      controls.update();
      if (overall < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        if (!gravityRootId) {
          gravityLayoutRef.current = null;
          gravityOverviewCameraRef.current = null;
          if (floorGroup) floorGroup.visible = false;
        }
        if (clearGravityCamera) gravityCameraRef.current = null;
        graph.controls().enabled = true;
        if (!gravityRootId && !reducedMotionRef.current) {
          for (const node of runtimeNodes) {
            node.fx = undefined;
            node.fy = undefined;
            node.fz = undefined;
            node.vx = 0;
            node.vy = 0;
            node.vz = 0;
          }
          graph
            .refresh()
            .cooldownTicks(Number.POSITIVE_INFINITY)
            .cooldownTime(Number.POSITIVE_INFINITY)
            .d3ReheatSimulation();
        } else {
          graph.cooldownTicks(0).refresh();
        }
        setLayoutSettledVersion((version) => version + 1);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current !== null)
        window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [graphMounted, gravityRootId, nodes, viewportVersion, viewResetVersion]);

  useEffect(() => {
    const graph = graphRef.current;
    const THREE = threeRef.current;
    const overview = gravityOverviewCameraRef.current;
    const selected = runtimeNodesRef.current.find(
      (node) => node.id === selectedId,
    );
    if (
      !graphMounted ||
      !graph ||
      !THREE ||
      !gravityRootId ||
      !selected ||
      !overview ||
      animationFrameRef.current !== null
    )
      return;

    if (selectionFocusFrameRef.current !== null)
      window.cancelAnimationFrame(selectionFocusFrameRef.current);
    const camera = graph.camera();
    const controls = graph.controls();
    const container = containerRef.current;
    const width = Math.max(1, container?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, container?.clientHeight ?? window.innerHeight);
    const safeRect = container
      ? measureGraphSafeRect(container)
      : { left: 18, right: width - 18, top: 86, bottom: height - 108 };
    const desiredScreen = {
      x: (safeRect.left + safeRect.right) / 2,
      y: safeRect.top + (safeRect.bottom - safeRect.top) * 0.38,
    };
    const desiredNdc = {
      x: (desiredScreen.x / width) * 2 - 1,
      y: 1 - (desiredScreen.y / height) * 2,
    };
    const selectedVector = new THREE.Vector3(
      selected.x,
      selected.y,
      selected.z,
    );
    const overviewCamera = camera.clone();
    overviewCamera.position.set(
      overview.position.x,
      overview.position.y,
      overview.position.z,
    );
    overviewCamera.lookAt(
      overview.target.x,
      overview.target.y,
      overview.target.z,
    );
    overviewCamera.updateMatrixWorld(true);
    const selectedInCamera = selectedVector
      .clone()
      .applyMatrix4(overviewCamera.matrixWorldInverse);
    const halfHeightAtSelection =
      Math.tan(THREE.MathUtils.degToRad(overviewCamera.fov) / 2) *
      -selectedInCamera.z;
    const rightVector = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(overviewCamera.quaternion)
      .normalize();
    const upVector = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(overviewCamera.quaternion)
      .normalize();
    const translation = rightVector
      .multiplyScalar(
        selectedInCamera.x -
          desiredNdc.x * halfHeightAtSelection * overviewCamera.aspect,
      )
      .add(
        upVector.multiplyScalar(
          selectedInCamera.y - desiredNdc.y * halfHeightAtSelection,
        ),
      );
    const pannedPosition = new THREE.Vector3(
      overview.position.x,
      overview.position.y,
      overview.position.z,
    ).add(translation);
    const pannedTarget = new THREE.Vector3(
      overview.target.x,
      overview.target.y,
      overview.target.z,
    ).add(translation);
    const isRootFocus = selected.id === gravityRootId;
    const targetPosition = isRootFocus
      ? new THREE.Vector3(
          overview.position.x,
          overview.position.y,
          overview.position.z,
        )
      : selectedVector
          .clone()
          .add(
            pannedPosition
              .sub(selectedVector)
              .multiplyScalar(RELATED_FOCUS_CAMERA_DISTANCE_FACTOR),
          );
    const targetLookAt = isRootFocus
      ? new THREE.Vector3(
          overview.target.x,
          overview.target.y,
          overview.target.z,
        )
      : selectedVector
          .clone()
          .add(
            pannedTarget
              .sub(selectedVector)
              .multiplyScalar(RELATED_FOCUS_CAMERA_DISTANCE_FACTOR),
          );
    const startPosition = camera.position.clone();
    const startLookAt = controls.target.clone();
    if (
      startPosition.distanceToSquared(targetPosition) < 0.0001 &&
      startLookAt.distanceToSquared(targetLookAt) < 0.0001
    )
      return;
    const duration = reducedMotionRef.current ? 1 : 430;
    const startedAt = performance.now();
    controls.enabled = false;

    const focus = (timestamp: number) => {
      const progress = Math.max(
        0,
        Math.min(1, (timestamp - startedAt) / duration),
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(startPosition, targetPosition, eased);
      controls.target.lerpVectors(startLookAt, targetLookAt, eased);
      controls.update();
      if (progress < 1)
        selectionFocusFrameRef.current = window.requestAnimationFrame(focus);
      else {
        selectionFocusFrameRef.current = null;
        controls.enabled = true;
      }
    };

    selectionFocusFrameRef.current = window.requestAnimationFrame(focus);
    return () => {
      if (selectionFocusFrameRef.current !== null)
        window.cancelAnimationFrame(selectionFocusFrameRef.current);
      selectionFocusFrameRef.current = null;
      controls.enabled = true;
    };
  }, [
    graphMounted,
    gravityRootId,
    selectedId,
    selectionFocusVersion,
    viewportVersion,
    layoutSettledVersion,
  ]);

  useEffect(() => {
    if (!graphMounted || !birthNodeId || !birthVersion) return;
    const group = nodeObjectRefs.current.get(birthNodeId);
    const graph = graphRef.current;
    if (!group || !graph) return;
    const burst = group.userData.birthBurst as
      | import('three').Group
      | undefined;
    const materials = (group.userData.birthMaterials ?? []) as Array<{
      opacity: number;
    }>;
    if (reducedMotionRef.current) {
      group.scale.setScalar(1);
      if (burst) burst.visible = false;
      graph.refresh();
      return;
    }
    const initialOpacities = materials.map((material) => material.opacity);
    const startedAt = performance.now();
    const duration = 1500;
    group.scale.setScalar(0.04);
    const animateBirth = (timestamp: number) => {
      const progress = Math.max(
        0,
        Math.min(1, (timestamp - startedAt) / duration),
      );
      const scale =
        progress < 0.68
          ? 1.22 * (1 - Math.pow(1 - progress / 0.68, 3))
          : 1.22 - 0.22 * ((progress - 0.68) / 0.32);
      group.scale.setScalar(Math.max(0.04, scale));
      if (burst) {
        burst.scale.setScalar(0.3 + progress * 2.7);
        burst.rotation.z = progress * Math.PI * 0.7;
      }
      materials.forEach((material, index) => {
        material.opacity =
          initialOpacities[index] * Math.pow(1 - progress, 1.7);
      });
      graph.refresh();
      if (progress < 1)
        birthAnimationFrameRef.current =
          window.requestAnimationFrame(animateBirth);
      else {
        birthAnimationFrameRef.current = null;
        group.scale.setScalar(1);
        if (burst) burst.visible = false;
        graph.refresh();
      }
    };
    birthAnimationFrameRef.current = window.requestAnimationFrame(animateBirth);
    return () => {
      if (birthAnimationFrameRef.current !== null)
        window.cancelAnimationFrame(birthAnimationFrameRef.current);
      birthAnimationFrameRef.current = null;
      group.scale.setScalar(1);
    };
  }, [birthNodeId, birthVersion, graphMounted]);

  return (
    <div
      ref={containerRef}
      className={`graph-stage absolute inset-0 ${gravityRootId ? 'is-tree' : 'is-live'}`}
      aria-hidden="true"
    />
  );
}
/* oxlint-enable react/react-compiler */
