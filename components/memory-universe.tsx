'use client';

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Box,
  Braces,
  CircleDot,
  Code2,
  Command,
  Cpu,
  GitBranch,
  Maximize2,
  Network,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import SpriteText from 'three-spritetext';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  createGravityLayout,
  createNebulaLayout,
  memoryLinkKey,
  nebulaCenters,
  type GraphPosition,
  type GravityLayout,
} from '@/lib/gravity-layout';
import {
  clusters,
  createMemoryGraph,
  linkEndpointId,
  type MemoryLink,
  type MemoryNode,
  storyChapters,
  storyPath,
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
  linkDirectionalParticles: (accessor: (link: MemoryLink) => number) => GraphInstance;
  linkDirectionalParticleWidth: (accessor: (link: MemoryLink) => number) => GraphInstance;
  linkDirectionalParticleColor: (accessor: (link: MemoryLink) => string) => GraphInstance;
  linkDirectionalParticleSpeed: (accessor: (link: MemoryLink) => number) => GraphInstance;
  linkDirectionalArrowLength: (accessor: (link: MemoryLink) => number) => GraphInstance;
  linkDirectionalArrowColor: (accessor: (link: MemoryLink) => string) => GraphInstance;
  linkCurvature: (accessor: (link: MemoryLink) => number) => GraphInstance;
  onNodeClick: (handler: (node: MemoryNode) => void) => GraphInstance;
  onNodeHover: (handler: (node: MemoryNode | null) => void) => GraphInstance;
  onNodeDrag: (handler: (node: MemoryNode, translate: GraphPosition) => void) => GraphInstance;
  onNodeDragEnd: (handler: (node: MemoryNode, translate: GraphPosition) => void) => GraphInstance;
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
  graph2ScreenCoords: (x: number, y: number, z: number) => { x: number; y: number };
  scene: () => { add: (object: unknown) => void };
  refresh: () => GraphInstance;
  _destructor?: () => void;
};

type GravitySummary = Pick<GravityLayout, 'directCount' | 'treeCount' | 'sedimentCount'>;

type GraphSafeRect = { left: number; right: number; top: number; bottom: number };

const kindLabels: Record<MemoryNode['kind'], string> = {
  query: 'QUERY NODE',
  issue: 'ISSUE',
  decision: 'DECISION',
  code: 'CODE CHANGE',
  incident: 'INCIDENT',
  resolution: 'RESOLUTION',
};

const kindIcons: Record<MemoryNode['kind'], typeof CircleDot> = {
  query: Sparkles,
  issue: CircleDot,
  decision: GitBranch,
  code: Code2,
  incident: AlertTriangle,
  resolution: ShieldCheck,
};

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((character) => character + character).join('') : value;
  const number = Number.parseInt(full, 16);
  return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
}

function escapeGraphLabel(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character);
}

function measureGraphSafeRect(container: HTMLElement): GraphSafeRect {
  const bounds = container.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const safeRect: GraphSafeRect = { left: 18, right: width - 18, top: 18, bottom: height - 18 };
  const shell = container.closest('main') ?? document;

  for (const obstruction of shell.querySelectorAll<HTMLElement>('[data-graph-obstruction]')) {
    const rect = obstruction.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const left = rect.left - bounds.left;
    const right = rect.right - bounds.left;
    const top = rect.top - bounds.top;
    const bottom = rect.bottom - bounds.top;
    const edge = obstruction.dataset.graphObstruction;

    if (edge === 'top') safeRect.top = Math.max(safeRect.top, bottom + 18);
    if (edge === 'left') safeRect.left = Math.max(safeRect.left, right + 18);
    if (edge === 'bottom') safeRect.bottom = Math.min(safeRect.bottom, top - 18);
    if (edge === 'adaptive') {
      if (rect.width >= width * 0.62) safeRect.bottom = Math.min(safeRect.bottom, top - 24);
      else safeRect.right = Math.min(safeRect.right, left - 24);
    }
  }

  if (safeRect.right - safeRect.left < 96) {
    safeRect.left = 18;
    safeRect.right = width - 18;
  }
  if (safeRect.bottom - safeRect.top < 64) safeRect.bottom = Math.min(height - 18, safeRect.top + 64);
  return safeRect;
}

/* oxlint-disable react/react-compiler -- The imperative WebGL lifecycle is intentionally isolated from React compilation. */
function GraphStage({
  nodes,
  links,
  gravityRootId,
  selectedId,
  activeCluster,
  activeStoryIndex,
  viewResetVersion,
  selectionFocusVersion,
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
  activeStoryIndex: number;
  viewResetVersion: number;
  selectionFocusVersion: number;
  onSelect: (node: MemoryNode | null) => void;
  onGravityChange: (summary: GravitySummary | null) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const [graphMounted, setGraphMounted] = useState(false);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [layoutSettledVersion, setLayoutSettledVersion] = useState(0);
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
  const nodeObjectRefs = useRef<Map<string, import('three').Group>>(new Map());
  const neighborIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const nebulaMaterialsRef = useRef<Array<{ opacity: number }>>([]);
  const floorMaterialsRef = useRef<Array<{ opacity: number }>>([]);
  const floorGroupRef = useRef<import('three').Group | null>(null);
  const gravityCameraRef = useRef<{ position: GraphPosition; target: GraphPosition } | null>(null);
  const gravityOverviewCameraRef = useRef<{ position: GraphPosition; target: GraphPosition } | null>(null);
  const selectionFocusFrameRef = useRef<number | null>(null);
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  const stateRef = useRef({ gravityRootId, selectedId, activeCluster, activeStoryIndex });
  const onSelectRef = useRef(onSelect);
  const onGravityChangeRef = useRef(onGravityChange);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const reducedMotionRef = useRef(false);

  nodesRef.current = nodes;
  linksRef.current = links;
  stateRef.current = { gravityRootId, selectedId, activeCluster, activeStoryIndex };
  onSelectRef.current = onSelect;
  onGravityChangeRef.current = onGravityChange;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let motionQuery: MediaQueryList | null = null;
    let disposePointerInteraction: (() => void) | null = null;
    const nodeObjects = nodeObjectRefs.current;
    const updateMotionPreference = (event: MediaQueryListEvent | MediaQueryList) => {
      reducedMotionRef.current = event.matches;
      if (event.matches) {
        pointerStateRef.current.active = false;
        draggedNodeIdRef.current = null;
        for (const marker of nodeObjects.values()) {
          const object = marker.parent;
          object?.scale.setScalar(1);
          if (object) object.rotation.set(0, 0, 0);
        }
      }

      const graph = graphRef.current;
      if (!graph || stateRef.current.gravityRootId || gravityLayoutRef.current || animationFrameRef.current !== null) return;
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
      else graph.cooldownTicks(Number.POSITIVE_INFINITY).cooldownTime(Number.POSITIVE_INFINITY).d3ReheatSimulation();
    };

    async function mountGraph() {
      const element = containerRef.current;
      if (!element) return;
      const testCanvas = document.createElement('canvas');
      if (!(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'))) {
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
        const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

        const nebulaPositions = createNebulaLayout(nodesRef.current);
        nebulaPositionsRef.current = nebulaPositions;
        const runtimeNodes: MemoryNode[] = nodesRef.current.map((node) => {
          const position = nebulaPositions.get(node.id) ?? { x: node.x, y: node.y, z: node.z };
          return { ...node, ...position, fx: position.x, fy: position.y, fz: position.z };
        });
        runtimeNodesRef.current = runtimeNodes;
        const runtimeNodeById = new Map(runtimeNodes.map((node) => [node.id, node]));
        const neighborIds = new Map(nodesRef.current.map((node) => [node.id, new Set<string>()]));
        for (const link of linksRef.current) {
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          neighborIds.get(source)?.add(target);
          neighborIds.get(target)?.add(source);
        }
        neighborIdsRef.current = neighborIds;
        const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
        const restDistanceByLink = new Map(linksRef.current.map((link) => {
          const source = nebulaPositions.get(linkEndpointId(link.source));
          const target = nebulaPositions.get(linkEndpointId(link.target));
          const distance = source && target
            ? Math.hypot(target.x - source.x, target.y - source.y, target.z - source.z)
            : 30;
          return [memoryLinkKey(link), distance] as const;
        }));
        let neighborLabelAnchor = '';
        let neighborLabelIds = new Set<string>();
        const getNeighborLabelIds = () => {
          const anchorId = hoveredIdRef.current ?? stateRef.current.selectedId ?? '';
          if (anchorId === neighborLabelAnchor) return neighborLabelIds;
          neighborLabelAnchor = anchorId;
          neighborLabelIds = new Set(
            [...(neighborIdsRef.current.get(anchorId) ?? [])]
              .map((id) => nodeById.get(id))
              .filter((node): node is MemoryNode => Boolean(node))
              .sort((a, b) => {
                const aPriority = (a.isStory ? 3 : 0) + (a.isHub ? 1.5 : 0) + a.importance + a.relevance;
                const bPriority = (b.isStory ? 3 : 0) + (b.isHub ? 1.5 : 0) + b.importance + b.relevance;
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
        graphRef.current = graph;
        const selectNodeOnce = (node: MemoryNode) => {
          const now = performance.now();
          const lastClick = lastGraphClickRef.current;
          if (lastClick.id === node.id && now - lastClick.at < 120) return;
          lastGraphClickRef.current = { id: node.id, at: now };
          onSelectRef.current(node);
        };
        let simulationNodes = runtimeNodes;
        const motionById = new Map(runtimeNodes.map((node, index) => [node.id, {
          phase: index * 2.399963229728653 + node.id.length * 0.19,
          speed: 0.45 + (index % 7) * 0.045,
          amplitude: node.isHub ? 1.8 : node.kind === 'query' ? 2.2 : Math.min(3.6, 2.2 + node.importance * 1.4),
        }]));
        const cameraRight = new THREE.Vector3();
        const cameraUp = new THREE.Vector3();
        const livingForce = ((alpha: number) => {
          if (
            stateRef.current.gravityRootId
            || gravityLayoutRef.current
            || reducedMotionRef.current
            || animationFrameRef.current !== null
            || selectionFocusFrameRef.current !== null
          ) return;

          const seconds = performance.now() / 1000;
          const pointer = pointerStateRef.current;
          const pointerResponds = pointer.active && !pointer.pressed;
          if (pointerResponds) {
            const camera = graph.camera();
            cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
            cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
          }

          for (const node of simulationNodes) {
            if (node.id === draggedNodeIdRef.current || node.fx !== undefined || node.fy !== undefined || node.fz !== undefined) continue;
            const anchor = nebulaPositions.get(node.id);
            const motion = motionById.get(node.id);
            if (!anchor || !motion) continue;
            const targetX = anchor.x + Math.sin(seconds * motion.speed + motion.phase) * motion.amplitude;
            const targetY = anchor.y + Math.sin(seconds * motion.speed * 0.83 + motion.phase * 1.37) * motion.amplitude * 0.65;
            const targetZ = anchor.z + Math.cos(seconds * motion.speed * 0.71 + motion.phase * 0.73) * motion.amplitude * 0.8;
            const spring = node.isHub ? 0.018 : 0.014;
            node.vx = (node.vx ?? 0) + (targetX - node.x) * spring * alpha;
            node.vy = (node.vy ?? 0) + (targetY - node.y) * spring * alpha;
            node.vz = (node.vz ?? 0) + (targetZ - node.z) * spring * alpha;

            if (pointerResponds && node.id !== hoveredIdRef.current) {
              const screen = graph.graph2ScreenCoords(node.x, node.y, node.z);
              const differenceX = screen.x - pointer.x;
              const differenceY = screen.y - pointer.y;
              const distance = Math.hypot(differenceX, differenceY);
              if (distance > 4 && distance < 140) {
                const strength = Math.pow(1 - distance / 140, 2) * 0.11 * alpha;
                const normalX = differenceX / distance;
                const normalY = -differenceY / distance;
                node.vx += (cameraRight.x * normalX + cameraUp.x * normalY) * strength;
                node.vy += (cameraRight.y * normalX + cameraUp.y * normalY) * strength;
                node.vz += (cameraRight.z * normalX + cameraUp.z * normalY) * strength;
              }
            }
          }
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
          return Boolean(state.selectedId && (source === state.selectedId || target === state.selectedId));
        };

        const isActiveStoryLink = (link: MemoryLink) => {
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          for (let index = 0; index < Math.max(0, stateRef.current.activeStoryIndex); index += 1) {
            if (source === storyPath[index] && target === storyPath[index + 1]) return true;
          }
          return false;
        };

        const isPrimaryTreeLink = (link: MemoryLink) => {
          return gravityLayoutRef.current?.primaryLinkKeys.has(memoryLinkKey(link)) ?? false;
        };

        const isFocusedCrossLink = (link: MemoryLink) => {
          const gravity = gravityLayoutRef.current;
          if (!gravity) return false;
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          return gravity.focusIds.has(source) && gravity.focusIds.has(target) && !isPrimaryTreeLink(link);
        };

        graph
          .backgroundColor('rgba(0,0,0,0)')
          .width(containerRef.current.clientWidth)
          .height(containerRef.current.clientHeight)
          .graphData({
            nodes: runtimeNodes,
            links: linksRef.current.map((link) => ({ ...link })),
          })
          .nodeId('id')
          .nodeLabel((node) => `<div class="graph-tooltip"><span>${escapeGraphLabel(kindLabels[node.kind])}</span><strong>${escapeGraphLabel(node.issueKey)}</strong><p>${escapeGraphLabel(node.name)}</p></div>`)
          .nodeColor((node) => {
            const state = stateRef.current;
            const gravity = gravityLayoutRef.current;
            const hover = hoveredIdRef.current;
            const selectedNeighbor = Boolean(state.selectedId && neighborIdsRef.current.get(state.selectedId)?.has(node.id));
            const hoverNeighbor = Boolean(hover && neighborIdsRef.current.get(hover)?.has(node.id));
            if (node.id === hover) return '#dcdcaa';
            if (node.id === state.selectedId) return node.color;
            if (node.id === state.gravityRootId) return '#569cd6';
            if (hoverNeighbor) return hexToRgba(node.color, 0.92);
            if (selectedNeighbor) return hexToRgba(node.color, 0.86);
            if (gravity) {
              const depth = gravity.depthById.get(node.id);
              if (depth === 1) return hexToRgba(node.color, 0.54);
              if (depth === 2) return hexToRgba(node.color, 0.4);
              if (depth === 3) return hexToRgba(node.color, 0.26);
              if (depth === undefined) return hexToRgba(node.color, node.isHub ? 0.14 : 0.08);
            }
            if (hover || state.selectedId) return hexToRgba(node.color, node.isHub ? 0.18 : 0.12);
            if (state.activeCluster && node.cluster !== state.activeCluster && !node.isStory) return hexToRgba(node.color, 0.1);
            return hexToRgba(node.color, node.kind === 'query' || node.isHub ? 0.92 : node.isStory ? 0.84 : 0.72);
          })
          .nodeVal((node) => {
            const gravity = gravityLayoutRef.current;
            const depth = gravity?.depthById.get(node.id);
            const state = stateRef.current;
            const hover = hoveredIdRef.current;
            const selectedNeighbor = Boolean(state.selectedId && neighborIdsRef.current.get(state.selectedId)?.has(node.id));
            const hoverNeighbor = Boolean(hover && neighborIdsRef.current.get(hover)?.has(node.id));
            if (node.id === hover || node.id === state.selectedId) return node.kind === 'query' ? 13 : 10;
            if (node.id === state.gravityRootId) return node.kind === 'query' ? 13 : 9.5;
            if (selectedNeighbor || hoverNeighbor) return 5.8 + node.importance * 2;
            if (depth === 1) return 5.5 + node.importance * 2;
            if (depth === 2) return 4 + node.importance;
            if (depth === 3) return 2.7 + node.importance * 0.7;
            if (node.kind === 'query') return 12;
            if (node.isHub) return 9;
            if (node.isStory) return 6;
            return (node.kind === 'decision' ? 3.2 : 1.7) + node.relevance * 2.1;
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
            const showNeighborLabel = getNeighborLabelIds().has(node.id);
            const group = new THREE.Group();
            nodeObjects.set(node.id, group);
            if (!(node.isHub || node.isStory || isSelected || isRoot || isHovered || showNeighborLabel || depth === 1)) return group;
            const sprite = new SpriteText(node.isHub ? node.clusterLabel.toUpperCase() : node.issueKey);
            sprite.color = isHovered ? '#dcdcaa' : isSelected ? '#f3f3f3' : isRoot ? '#9cdcfe' : node.color;
            sprite.textHeight = node.isHub ? 5.1 : depth === 1 || showNeighborLabel ? 2.7 : 3.2;
            sprite.fontWeight = node.isHub ? '700' : '600';
            sprite.backgroundColor = isSelected || isRoot || isHovered ? 'rgba(37,37,38,.94)' : false;
            sprite.padding = isSelected || isRoot || isHovered ? [3, 5] : 0;
            sprite.borderRadius = 1;
            sprite.position.y = node.isHub ? 12 : 8;
            group.add(sprite);

            if (node.kind === 'query' || isSelected || isRoot || isHovered) {
              const ringColor = isHovered ? '#dcdcaa' : isSelected ? node.color : isRoot ? '#569cd6' : '#c586c0';
              const innerOpacity = isHovered ? 0.9 : isSelected ? 0.82 : isRoot ? 0.46 : 0.38;
              const outerOpacity = isHovered ? 0.34 : isSelected ? 0.28 : isRoot ? 0.14 : 0.11;
              const ring = new THREE.Mesh(
                new THREE.TorusGeometry(node.kind === 'query' ? 11.5 : 8.5, isSelected ? 0.15 : 0.12, 8, 64),
                new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: innerOpacity }),
              );
              const orbit = new THREE.Mesh(
                new THREE.TorusGeometry(node.kind === 'query' ? 13.2 : 9.8, isSelected ? 0.07 : 0.055, 7, 64),
                new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: outerOpacity }),
              );
              orbit.position.set(0.45, -0.3, -0.25);
              orbit.rotation.z = Math.PI * 0.025;
              group.add(ring, orbit);
            }
            return group;
          })
          .linkColor((link) => {
            if (isHoverIncident(link)) return 'rgba(220,220,170,.86)';
            if (isSelectedIncident(link)) return 'rgba(79,193,255,.82)';
            if (isActiveStoryLink(link)) return 'rgba(197,134,192,.68)';
            if (isPrimaryTreeLink(link)) {
              const gravity = gravityLayoutRef.current;
              const depth = Math.max(
                gravity?.depthById.get(linkEndpointId(link.source)) ?? 0,
                gravity?.depthById.get(linkEndpointId(link.target)) ?? 0,
              );
              return `rgba(86,156,214,${depth <= 1 ? 0.46 : depth === 2 ? 0.29 : 0.17})`;
            }
            if (isFocusedCrossLink(link)) return 'rgba(197,134,192,.13)';
            const source = nodeById.get(linkEndpointId(link.source));
            if (gravityLayoutRef.current) return 'rgba(133,133,133,.045)';
            if (stateRef.current.activeCluster && source?.cluster !== stateRef.current.activeCluster) return 'rgba(133,133,133,.06)';
            return source ? hexToRgba(source.color, 0.12 + link.score * 0.1) : 'rgba(133,133,133,.12)';
          })
          .linkWidth((link) => isHoverIncident(link) ? 0.72 : isSelectedIncident(link) ? 0.88 : isActiveStoryLink(link) ? 0.6 : 0)
          .linkOpacity(1)
          .linkDirectionalParticles(() => 0)
          .linkDirectionalParticleWidth(() => 0)
          .linkDirectionalParticleColor(() => '#4daafc')
          .linkDirectionalParticleSpeed(() => 0)
          .linkDirectionalArrowLength((link) => (isHoverIncident(link) || isSelectedIncident(link) || isActiveStoryLink(link) ? 1.05 : 0))
          .linkDirectionalArrowColor((link) => isHoverIncident(link)
            ? 'rgba(220,220,170,.16)'
            : isSelectedIncident(link)
              ? 'rgba(79,193,255,.17)'
              : isActiveStoryLink(link) ? 'rgba(197,134,192,.15)' : 'rgba(133,133,133,0)')
          .linkCurvature((link) => gravityLayoutRef.current
            ? isFocusedCrossLink(link) ? 0.065 : 0
            : link.story ? 0.08 : Math.max(0.015, (link.score - 0.35) * 0.04))
          .onNodeClick((node) => {
            selectNodeOnce(node);
          })
          .onNodeHover((node) => {
            const nextHoveredId = node?.id ?? null;
            if (nextHoveredId === hoveredIdRef.current) return;
            hoveredIdRef.current = nextHoveredId;
            if (hoverRefreshFrameRef.current === null) {
              hoverRefreshFrameRef.current = window.requestAnimationFrame(() => {
                hoverRefreshFrameRef.current = null;
                graphRef.current?.refresh();
              });
            }
          })
          .onNodeDrag((node) => {
            const gravityTarget = gravityLayoutRef.current?.positions.get(node.id);
            if (stateRef.current.gravityRootId) {
              if (gravityTarget) Object.assign(node, gravityTarget, {
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
            const gravityTarget = gravityLayoutRef.current?.positions.get(node.id);
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
              if (anchor) Object.assign(node, anchor, {
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
            graph.cooldownTicks(Number.POSITIVE_INFINITY).cooldownTime(Number.POSITIVE_INFINITY).d3ReheatSimulation();
          })
          .onBackgroundClick(() => onSelectRef.current(null))
          .enableNodeDrag(finePointer.matches)
          .warmupTicks(0)
          .cooldownTicks(0)
          .onEngineStop(() => onReadyRef.current());

        const linkForce = graph.d3Force('link') as GraphLinkForce | undefined;
        if (finePointer.matches) {
          linkForce
            ?.distance((link) => restDistanceByLink.get(memoryLinkKey(link)) ?? 30)
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
        graph.cameraPosition({ x: 0, y: 24, z: 690 }, { x: 0, y: -16, z: 0 }, 0);

        const nebulaMaterials: Array<{ opacity: number }> = [];
        for (const cluster of clusters) {
          const center = nebulaCenters.get(cluster.id) ?? { x: 0, y: 0, z: 0 };
          const dustGeometry = new THREE.BufferGeometry();
          const dust = new Float32Array(72 * 3);
          let seed = 913 + cluster.lane * 177;
          const random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          for (let index = 0; index < 72; index += 1) {
            const radius = Math.pow(random(), 0.72);
            const theta = random() * Math.PI * 2;
            const phi = Math.acos(2 * random() - 1);
            dust[index * 3] = center.x + Math.sin(phi) * Math.cos(theta) * radius * 102;
            dust[index * 3 + 1] = center.y + Math.sin(phi) * Math.sin(theta) * radius * 66;
            dust[index * 3 + 2] = center.z + Math.cos(phi) * radius * 92;
          }
          dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust, 3));
          const material = new THREE.PointsMaterial({ color: cluster.color, size: 0.72, transparent: true, opacity: 0.065, sizeAttenuation: true, depthWrite: false });
          nebulaMaterials.push(material);
          graph.scene().add(new THREE.Points(dustGeometry, material));
        }
        nebulaMaterialsRef.current = nebulaMaterials;

        const floorGroup = new THREE.Group();
        const floorPlaneMaterial = new THREE.MeshBasicMaterial({ color: '#15171a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
        const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(760, 440), floorPlaneMaterial);
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
          if (pointerFrameRef.current === null) pointerFrameRef.current = window.requestAnimationFrame(updatePointerObjects);
        };

        const updatePointerObjects = (timestamp: number) => {
          pointerFrameRef.current = null;
          const pointer = pointerStateRef.current;
          if (timestamp - pointer.lastFrame < 30) {
            requestPointerFrame();
            return;
          }
          const deltaSeconds = pointer.lastFrame ? Math.min(0.05, (timestamp - pointer.lastFrame) / 1000) : 1 / 30;
          pointer.lastFrame = timestamp;
          const canRespond = pointer.active && !pointer.pressed && !reducedMotionRef.current
            && animationFrameRef.current === null && selectionFocusFrameRef.current === null;
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
                tiltX = Math.max(-0.052, Math.min(0.052, -differenceY / 120 * 0.052 * strength));
                tiltY = Math.max(-0.052, Math.min(0.052, differenceX / 120 * 0.052 * strength));
              }
            }
            const targetScale = 1 + strength * 0.045;
            const nextScale = object.scale.x + (targetScale - object.scale.x) * blend;
            object.scale.setScalar(nextScale);
            object.rotation.x += (tiltX - object.rotation.x) * blend;
            object.rotation.y += (tiltY - object.rotation.y) * blend;
            if (Math.abs(targetScale - nextScale) > 0.0006 || Math.abs(tiltX - object.rotation.x) > 0.0006 || Math.abs(tiltY - object.rotation.y) > 0.0006) unsettled = true;
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
          pointer.active = finePointer.matches && event.pointerType !== 'touch' && !pointer.pressed
            && pointer.x >= 0 && pointer.x <= bounds.width && pointer.y >= 0 && pointer.y <= bounds.height;
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
          const travel = Math.hypot(releaseX - pointer.downX, releaseY - pointer.downY);
          pointer.downNodeId = '';
          setPointerFromEvent(event);

          if (
            event.button !== 0
            || !downNodeId
            || hoveredIdRef.current !== downNodeId
            || travel > 4
          ) return;
          if (clickFallbackFrameRef.current !== null) window.cancelAnimationFrame(clickFallbackFrameRef.current);
          clickFallbackFrameRef.current = window.requestAnimationFrame(() => {
            clickFallbackFrameRef.current = null;
            if (hoveredIdRef.current !== downNodeId) return;
            const node = runtimeNodeById.get(downNodeId);
            if (!node) return;
            selectNodeOnce(node);
          });
        };
        canvas.addEventListener('pointermove', setPointerFromEvent, { passive: true });
        canvas.addEventListener('pointerdown', pressPointer, { passive: true });
        canvas.addEventListener('pointerup', releasePointer, { passive: true });
        canvas.addEventListener('pointerleave', deactivatePointer, { passive: true });
        canvas.addEventListener('pointercancel', deactivatePointer, { passive: true });
        disposePointerInteraction = () => {
          canvas.removeEventListener('pointermove', setPointerFromEvent);
          canvas.removeEventListener('pointerdown', pressPointer);
          canvas.removeEventListener('pointerup', releasePointer);
          canvas.removeEventListener('pointerleave', deactivatePointer);
          canvas.removeEventListener('pointercancel', deactivatePointer);
        };

        setGraphMounted(true);
        window.requestAnimationFrame(() => onReadyRef.current());

        let observedWidth = element.clientWidth;
        let observedHeight = element.clientHeight;
        resizeObserver = new ResizeObserver(([entry]) => {
          const nextWidth = entry.contentRect.width;
          const nextHeight = entry.contentRect.height;
          graph.width(nextWidth).height(nextHeight);
          if (Math.abs(nextWidth - observedWidth) > 1 || Math.abs(nextHeight - observedHeight) > 1) {
            observedWidth = nextWidth;
            observedHeight = nextHeight;
            setViewportVersion((version) => version + 1);
          }
        });
        resizeObserver.observe(element);
      } catch (error) {
        console.error('Unable to initialize the memory universe', error);
        onErrorRef.current();
      }
    }

    void mountGraph();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      motionQuery?.removeEventListener('change', updateMotionPreference);
      disposePointerInteraction?.();
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
      if (hoverRefreshFrameRef.current !== null) window.cancelAnimationFrame(hoverRefreshFrameRef.current);
      if (clickFallbackFrameRef.current !== null) window.cancelAnimationFrame(clickFallbackFrameRef.current);
      if (selectionFocusFrameRef.current !== null) window.cancelAnimationFrame(selectionFocusFrameRef.current);
      nodeObjects.clear();
      graphRef.current?._destructor?.();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.controls().autoRotate = false;
    graph
      .enableNodeDrag(!gravityRootId && window.matchMedia('(hover: hover) and (pointer: fine)').matches)
      .refresh();
  }, [activeCluster, activeStoryIndex, gravityRootId, selectedId]);

  useEffect(() => {
    const graph = graphRef.current;
    const THREE = threeRef.current;
    const runtimeNodes = runtimeNodesRef.current;
    if (!graphMounted || !graph || !THREE || !runtimeNodes.length) return;

    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (selectionFocusFrameRef.current !== null) window.cancelAnimationFrame(selectionFocusFrameRef.current);
    draggedNodeIdRef.current = null;
    for (const node of runtimeNodes) {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    }
    const starts = new Map(runtimeNodes.map((node) => [node.id, { x: node.x, y: node.y, z: node.z }]));
    const floorGroup = floorGroupRef.current;
    const camera = graph.camera();
    const controls = graph.controls();
    controls.update();
    const cameraStart = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    };
    let cameraTarget = cameraStart;
    let clearGravityCamera = false;
    let targets = nebulaPositionsRef.current;
    let nextGravity: GravityLayout | null = null;

    if (gravityRootId) {
      const root = runtimeNodes.find((node) => node.id === gravityRootId);
      if (!root) return;
      gravityCameraRef.current ??= cameraStart;
      const anchor = { x: root.x, y: root.y, z: root.z };
      const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      nextGravity = createGravityLayout({
        nodes: nodesRef.current,
        links: linksRef.current,
        rootId: gravityRootId,
        anchor,
        basis: {
          right: { x: rightVector.x, y: rightVector.y, z: rightVector.z },
          up: { x: upVector.x, y: upVector.y, z: upVector.z },
          forward: { x: forwardVector.x, y: forwardVector.y, z: forwardVector.z },
        },
      });
      targets = nextGravity.positions;
      gravityLayoutRef.current = nextGravity;
      onGravityChangeRef.current({ directCount: nextGravity.directCount, treeCount: nextGravity.treeCount, sedimentCount: nextGravity.sedimentCount });

      const container = containerRef.current;
      const width = Math.max(1, container?.clientWidth ?? window.innerWidth);
      const height = Math.max(1, container?.clientHeight ?? window.innerHeight);
      const safeRect = container ? measureGraphSafeRect(container) : { left: 18, right: width - 18, top: 86, bottom: height - 108 };
      const anchorVector = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
      const toFrame = (position: GraphPosition, target: GraphPosition, scale: number) => ({
        position: anchorVector.clone().add(new THREE.Vector3(position.x, position.y, position.z).sub(anchorVector).multiplyScalar(scale)),
        target: anchorVector.clone().add(new THREE.Vector3(target.x, target.y, target.z).sub(anchorVector).multiplyScalar(scale)),
      });
      const projectionFits = (position: GraphPosition, target: GraphPosition, scale: number) => {
        const frame = toFrame(position, target, scale);
        const testCamera = camera.clone();
        testCamera.position.copy(frame.position);
        testCamera.lookAt(frame.target);
        testCamera.updateMatrixWorld(true);
        for (const point of targets.values()) {
          const projected = new THREE.Vector3(point.x, point.y, point.z).project(testCamera);
          const screenX = (projected.x + 1) * width / 2;
          const screenY = (1 - projected.y) * height / 2;
          if (projected.z < -1 || projected.z > 1 || screenX < safeRect.left || screenX > safeRect.right || screenY < safeRect.top || screenY > safeRect.bottom) return false;
        }
        return true;
      };
      const findFitScale = (position: GraphPosition, target: GraphPosition, maximum: number) => {
        if (projectionFits(position, target, 1)) return 1;
        if (!projectionFits(position, target, maximum)) return null;
        let low = 1;
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
        x: desiredScreen.x / width * 2 - 1,
        y: 1 - desiredScreen.y / height * 2,
      };
      const rootInCamera = anchorVector.clone().applyMatrix4(camera.matrixWorldInverse);
      const halfHeightAtRoot = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * -rootInCamera.z;
      const cameraTranslation = rightVector.clone().multiplyScalar(rootInCamera.x - desiredNdc.x * halfHeightAtRoot * camera.aspect)
        .add(upVector.clone().multiplyScalar(rootInCamera.y - desiredNdc.y * halfHeightAtRoot));
      const framePosition = new THREE.Vector3(cameraStart.position.x, cameraStart.position.y, cameraStart.position.z).add(cameraTranslation);
      const frameTarget = new THREE.Vector3(cameraStart.target.x, cameraStart.target.y, cameraStart.target.z).add(cameraTranslation);
      const fitScale = findFitScale(framePosition, frameTarget, 12) ?? 12;

      const framed = toFrame(framePosition, frameTarget, fitScale);
      cameraTarget = {
        position: { x: framed.position.x, y: framed.position.y, z: framed.position.z },
        target: { x: framed.target.x, y: framed.target.y, z: framed.target.z },
      };
      gravityOverviewCameraRef.current = cameraTarget;

      if (floorGroup) {
        const floorCenter = new THREE.Vector3(anchor.x, anchor.y, anchor.z)
          .addScaledVector(upVector, -355)
          .addScaledVector(forwardVector, 78);
        floorGroup.position.copy(floorCenter);
        floorGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), upVector);
        floorGroup.children[1].rotation.x = Math.PI / 2;
        floorGroup.visible = true;
      }
    } else {
      onGravityChangeRef.current(null);
      if (gravityCameraRef.current) {
        cameraTarget = gravityCameraRef.current;
        clearGravityCamera = true;
      }
    }

    graph.controls().autoRotate = false;
    graph.controls().enabled = reducedMotionRef.current;
    graph.refresh().cooldownTicks(Number.POSITIVE_INFINITY).d3ReheatSimulation();
    const duration = reducedMotionRef.current ? 1 : gravityRootId ? 920 : 680;
    const startedAt = performance.now();
    const nebulaStartOpacity = nebulaMaterialsRef.current[0]?.opacity ?? 0.065;
    const floorStartOpacity = floorMaterialsRef.current[0]?.opacity ?? 0;
    const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);
    const easeInOut = (value: number) => value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const startCameraPosition = new THREE.Vector3(cameraStart.position.x, cameraStart.position.y, cameraStart.position.z);
    const targetCameraPosition = new THREE.Vector3(cameraTarget.position.x, cameraTarget.position.y, cameraTarget.position.z);
    const startCameraTarget = new THREE.Vector3(cameraStart.target.x, cameraStart.target.y, cameraStart.target.z);
    const targetCameraTarget = new THREE.Vector3(cameraTarget.target.x, cameraTarget.target.y, cameraTarget.target.z);

    const animate = (now: number) => {
      const elapsed = now - startedAt;
      const overall = clamp(elapsed / duration);
      for (const node of runtimeNodes) {
        const start = starts.get(node.id) ?? { x: node.x, y: node.y, z: node.z };
        const target = targets.get(node.id) ?? start;
        const depth = nextGravity?.depthById.get(node.id);
        const isRoot = node.id === gravityRootId;
        const isSediment = Boolean(gravityRootId && depth === undefined);
        const delay = reducedMotionRef.current || isRoot ? 0 : isSediment
          ? 40 + ((node.id.length * 37 + node.id.charCodeAt(0) * 13) % 110)
          : gravityRootId ? 60 + (depth ?? 0) * 62 : ((node.id.length * 19) % 70);
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
      const nebulaTargetOpacity = gravityRootId ? 0.014 : 0.065;
      const floorTargetOpacity = gravityRootId ? 0.07 : 0;
      for (const material of nebulaMaterialsRef.current) material.opacity = nebulaStartOpacity + (nebulaTargetOpacity - nebulaStartOpacity) * materialProgress;
      for (const material of floorMaterialsRef.current) material.opacity = floorStartOpacity + (floorTargetOpacity - floorStartOpacity) * materialProgress;
      const cameraProgress = easeInOut(overall);
      camera.position.lerpVectors(startCameraPosition, targetCameraPosition, cameraProgress);
      controls.target.lerpVectors(startCameraTarget, targetCameraTarget, cameraProgress);
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
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [graphMounted, gravityRootId, nodes, viewportVersion]);

  useEffect(() => {
    const graph = graphRef.current;
    const THREE = threeRef.current;
    const overview = gravityOverviewCameraRef.current;
    const selected = runtimeNodesRef.current.find((node) => node.id === selectedId);
    if (!graphMounted || !graph || !THREE || !gravityRootId || !selected || !overview || animationFrameRef.current !== null) return;

    if (selectionFocusFrameRef.current !== null) window.cancelAnimationFrame(selectionFocusFrameRef.current);
    const camera = graph.camera();
    const controls = graph.controls();
    const container = containerRef.current;
    const width = Math.max(1, container?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, container?.clientHeight ?? window.innerHeight);
    const safeRect = container ? measureGraphSafeRect(container) : { left: 18, right: width - 18, top: 86, bottom: height - 108 };
    const desiredScreen = {
      x: (safeRect.left + safeRect.right) / 2,
      y: safeRect.top + (safeRect.bottom - safeRect.top) * 0.38,
    };
    const desiredNdc = {
      x: desiredScreen.x / width * 2 - 1,
      y: 1 - desiredScreen.y / height * 2,
    };
    const selectedVector = new THREE.Vector3(selected.x, selected.y, selected.z);
    const overviewCamera = camera.clone();
    overviewCamera.position.set(overview.position.x, overview.position.y, overview.position.z);
    overviewCamera.lookAt(overview.target.x, overview.target.y, overview.target.z);
    overviewCamera.updateMatrixWorld(true);
    const selectedInCamera = selectedVector.clone().applyMatrix4(overviewCamera.matrixWorldInverse);
    const halfHeightAtSelection = Math.tan(THREE.MathUtils.degToRad(overviewCamera.fov) / 2) * -selectedInCamera.z;
    const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(overviewCamera.quaternion).normalize();
    const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(overviewCamera.quaternion).normalize();
    const translation = rightVector.multiplyScalar(selectedInCamera.x - desiredNdc.x * halfHeightAtSelection * overviewCamera.aspect)
      .add(upVector.multiplyScalar(selectedInCamera.y - desiredNdc.y * halfHeightAtSelection));
    const pannedPosition = new THREE.Vector3(overview.position.x, overview.position.y, overview.position.z).add(translation);
    const pannedTarget = new THREE.Vector3(overview.target.x, overview.target.y, overview.target.z).add(translation);
    const isRootFocus = selected.id === gravityRootId;
    const focusScale = 0.78;
    const targetPosition = isRootFocus
      ? new THREE.Vector3(overview.position.x, overview.position.y, overview.position.z)
      : selectedVector.clone().add(pannedPosition.sub(selectedVector).multiplyScalar(focusScale));
    const targetLookAt = isRootFocus
      ? new THREE.Vector3(overview.target.x, overview.target.y, overview.target.z)
      : selectedVector.clone().add(pannedTarget.sub(selectedVector).multiplyScalar(focusScale));
    const startPosition = camera.position.clone();
    const startLookAt = controls.target.clone();
    if (startPosition.distanceToSquared(targetPosition) < 0.0001 && startLookAt.distanceToSquared(targetLookAt) < 0.0001) return;
    const duration = reducedMotionRef.current ? 1 : 430;
    const startedAt = performance.now();
    controls.enabled = false;

    const focus = (timestamp: number) => {
      const progress = Math.max(0, Math.min(1, (timestamp - startedAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(startPosition, targetPosition, eased);
      controls.target.lerpVectors(startLookAt, targetLookAt, eased);
      controls.update();
      if (progress < 1) selectionFocusFrameRef.current = window.requestAnimationFrame(focus);
      else {
        selectionFocusFrameRef.current = null;
        controls.enabled = true;
      }
    };

    selectionFocusFrameRef.current = window.requestAnimationFrame(focus);
    return () => {
      if (selectionFocusFrameRef.current !== null) window.cancelAnimationFrame(selectionFocusFrameRef.current);
      selectionFocusFrameRef.current = null;
      controls.enabled = true;
    };
  }, [graphMounted, gravityRootId, selectedId, selectionFocusVersion, viewportVersion, layoutSettledVersion]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || viewResetVersion === 0 || gravityCameraRef.current) return;
    graph.controls().autoRotate = false;
    graph.cameraPosition(
      { x: 0, y: 24, z: 690 },
      { x: 0, y: -16, z: 0 },
      reducedMotionRef.current ? 80 : 650,
    );
  }, [viewResetVersion]);

  return <div ref={containerRef} className={`graph-stage absolute inset-0 ${gravityRootId ? 'is-tree' : 'is-live'}`} aria-hidden="true" />;
}
/* oxlint-enable react/react-compiler */

function ClusterRail({
  activeCluster,
  nodes,
  totalLinks,
  onSelect,
}: {
  activeCluster: string | null;
  nodes: MemoryNode[];
  totalLinks: number;
  onSelect: (cluster: string | null) => void;
}) {
  return (
    <aside data-graph-obstruction="left" className="universe-panel pointer-events-auto absolute bottom-[118px] left-5 top-[88px] z-20 hidden w-[246px] flex-col overflow-hidden xl:flex">
      <div className="notebook-rule px-4 pb-3 pt-4">
        <div className="eyebrow">MEMORY EXPLORER</div>
        <div className="mt-2 flex items-end justify-between">
          <div><p className="editorial-heading text-[22px]">8 Service Domains</p><p className="notebook-muted mt-0.5 text-[11px]">24 modules · {nodes.length} memory nodes</p></div>
          <Waypoints className="mb-1 size-4 text-[#4daafc]" />
        </div>
      </div>
      <div className="flex-1 px-2 py-2">
        <button type="button" onClick={() => onSelect(null)} className={`cluster-item ${activeCluster === null ? 'is-active' : ''}`}>
          <span className="cluster-dot bg-[#cccccc]" />
          <span className="min-w-0 flex-1"><strong>전체 개발 기록</strong><small>ALL MEMORIES VISIBLE</small></span><span className="cluster-count">{nodes.length}</span>
        </button>
        {clusters.map((cluster) => (
          <button type="button" key={cluster.id} onClick={() => onSelect(activeCluster === cluster.id ? null : cluster.id)} className={`cluster-item ${activeCluster === cluster.id ? 'is-active' : ''}`} style={{ '--cluster-color': cluster.color } as React.CSSProperties}>
            <span className="cluster-dot" style={{ backgroundColor: cluster.color }} />
            <span className="min-w-0 flex-1"><strong>{cluster.korean}</strong><small>{cluster.modules[0]} · +2 modules</small></span><span className="cluster-count">{nodes.filter((node) => node.cluster === cluster.id).length}</span>
          </button>
        ))}
      </div>
      <div className="index-summary m-3 p-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.1em]"><Activity className="size-3" /> GRAPH INDEX</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([[String(nodes.length), 'records'], [String(totalLinks), 'relations'], ['8', 'sections']] as const).map(([value, label]) => (
            <div key={label}><div className="font-mono text-[13px]">{value}</div><div className="notebook-muted text-[9px] uppercase tracking-[0.08em]">{label}</div></div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AxisCompass({ nodeCount, linkCount }: { nodeCount: number; linkCount: number }) {
  return (
    <div className="axis-compass pointer-events-none absolute right-5 top-[88px] z-20 hidden xl:block">
      <div className="notebook-rule flex items-center justify-between gap-4 px-3.5 py-2.5">
        <div><div className="eyebrow">GRAPH WORKBENCH</div><p className="notebook-muted mt-1 text-[10px]">모든 개발 기록과 관계를 펼친 작업 영역입니다.</p></div>
        <span className="notebook-stamp">ALL VISIBLE</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-[#2b2b2b]">
        <div className="axis-cell"><b className="text-[#4ec9b0]">{nodeCount}</b><span>NODES</span><small>8 service domains</small></div>
        <div className="axis-cell"><b className="text-[#c586c0]">{linkCount}</b><span>RELATIONS</span><small>every edge indexed</small></div>
        <div className="axis-cell"><b className="text-[#569cd6]">3</b><span>HOPS</span><small>click → context tree</small></div>
      </div>
    </div>
  );
}

function GravityLegend({ root, selected, directCount, summary }: { root: MemoryNode; selected: MemoryNode; directCount: number; summary: GravitySummary | null }) {
  return (
    <div data-graph-obstruction="top" className="gravity-legend pointer-events-auto absolute left-1/2 top-[86px] z-20 flex -translate-x-1/2 items-center gap-1.5">
      <span className="gravity-token is-root"><i />{root.issueKey} · ROOT</span>
      <span className="gravity-token is-direct"><i />{selected.issueKey} · {directCount} DIRECT · 86%</span>
      <span className="gravity-token is-history"><i />2–3 HOP · 40 / 26%</span>
      <span className="gravity-token is-floor"><i />{summary?.sedimentCount ?? 0} BACKGROUND · 8%</span>
    </div>
  );
}

function Inspector({ node, directCount, gravitySummary, onClose }: { node: MemoryNode; directCount: number; gravitySummary: GravitySummary | null; onClose: () => void }) {
  const Icon = kindIcons[node.kind];
  return (
    <aside data-graph-obstruction="adaptive" className="universe-panel inspector pointer-events-auto absolute bottom-[106px] right-5 top-[88px] z-30 flex w-[390px] max-w-[calc(100vw-40px)] flex-col overflow-hidden max-lg:bottom-[92px] max-lg:top-auto max-lg:h-[34vh]">
      <div className="notebook-rule relative overflow-hidden px-5 pb-5 pt-5">
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="node-kind-mark flex size-8 items-center justify-center border" style={{ borderColor: hexToRgba(node.color, 0.52), backgroundColor: hexToRgba(node.color, 0.08), color: node.color }}><Icon className="size-4" /></span>
            <div><div className="eyebrow" style={{ color: node.color }}>{kindLabels[node.kind]}</div><div className="notebook-muted mt-0.5 font-mono text-[11px]">{node.issueKey}</div></div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="메모리 상세 닫기" className="notebook-icon-button"><X /></Button>
        </div>
        <h2 className="editorial-heading relative mt-4 text-[22px] leading-[1.34]">{node.name}</h2>
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {[node.clusterLabel, node.date, node.owner].map((item) => <Badge key={item} className="notebook-badge text-[10px]">{item}</Badge>)}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-5 py-5">
          <section className="coordinate-card gravity-card">
            <div className="flex items-center justify-between"><div className="section-label"><Waypoints /> Context Gravity</div><span className="font-mono text-[8px] text-[#4daafc]">ROOT PINNED</span></div>
            <div className="mt-3 space-y-2.5">
              <div className="coordinate-row"><b className="text-[#4fc1ff]">1</b><span><small>현재 선택 100% · 직접 연결 강조</small><strong>{directCount}개 Memory Node</strong></span><code>86%</code></div>
              <div className="coordinate-row"><b className="text-[#c586c0]">3</b><span><small>History Tree</small><strong>{gravitySummary?.treeCount ?? '—'}개 노드를 3-hop으로 정렬</strong><em>주 관계선 + 보조 교차 관계선</em></span><code>40 / 26%</code></div>
              <div className="coordinate-row"><b className="text-[#858585]">↓</b><span><small>Background Layer</small><strong>{gravitySummary?.sedimentCount ?? '—'}개 비관련 기록도 배경에 유지</strong><i><span style={{ width: `${node.relevance * 100}%` }} /></i></span><code>8%</code></div>
            </div>
          </section>
          <section><div className="section-label"><Network /> 관련도 산정 근거</div><div className="mt-2.5 space-y-1.5">{node.relevanceReasons.map((reason) => <div key={reason} className="evidence-reason"><span />{reason}</div>)}</div></section>
          <section><div className="section-label"><CircleDot /> 발견된 맥락</div><p className="inspector-copy">{node.summary}</p></section>
          <section><div className="section-label"><Sparkles /> 당시의 기획 의도</div><p className="inspector-copy">{node.intent}</p></section>
          <section><div className="section-label"><ShieldCheck /> 처리 및 결정</div><p className="inspector-copy">{node.resolution}</p></section>
          <section className="margin-warning p-3.5"><div className="section-label"><AlertTriangle /> 사이드 이펙트</div><p className="mt-2 text-[12px] leading-5">{node.risk}</p></section>
          <section><div className="section-label"><Braces /> 변경 소스 파일</div><div className="mt-2.5 space-y-1.5">
            {node.files.map((file) => <button key={file} type="button" className="code-file"><Code2 className="size-3.5" /><span>{file}</span><ArrowUpRight className="ml-auto size-3 opacity-45" /></button>)}
          </div></section>
        </div>
      </ScrollArea>
      <div className="notebook-rule-top p-3"><Button className="brief-button h-10 w-full text-[12px] font-semibold"><Sparkles data-icon="inline-start" /> 현재 이슈 관점으로 Brief 생성</Button></div>
    </aside>
  );
}

function HistoryRail({ activeIndex, playing, gravityMode, onPlay, onSelect }: { activeIndex: number; playing: boolean; gravityMode: boolean; onPlay: () => void; onSelect: (index: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    const button = activeButtonRef.current;
    if (!scroller || !button || activeIndex < 0) return;
    scroller.scrollTo({
      left: button.offsetLeft - scroller.clientWidth / 2 + button.clientWidth / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [activeIndex]);

  return (
    <div data-graph-obstruction="bottom" className={`history-rail universe-panel pointer-events-auto absolute bottom-5 left-5 right-5 z-40 h-[88px] overflow-hidden max-lg:h-[82px] ${gravityMode ? 'is-gravity' : ''}`}>
      <div className="flex h-full items-center">
        <div className={`notebook-rule-right flex h-full shrink-0 items-center gap-3 max-md:w-auto max-md:border-r-0 max-md:px-3 ${gravityMode ? 'w-[150px] px-3' : 'w-[220px] px-4'}`}>
          <Button type="button" onClick={onPlay} size="icon-lg" className="replay-button size-11" aria-label={playing ? '기억 경로 일시 정지' : '기억 경로 재생'}>{playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}</Button>
          <div className="max-md:hidden"><div className="eyebrow">HISTORY OUTPUT</div><div className="mt-1 text-[12px]">Query 탐색 경로</div></div>
        </div>
        <div ref={scrollRef} className={`relative flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${gravityMode ? 'px-2' : 'px-4'}`}>
          <div className="absolute left-8 right-8 top-[31px] h-px bg-white/[0.12]" />
          <div className="history-progress absolute left-8 top-[31px] h-px transition-[width] duration-500" style={{ width: `${Math.max(0, activeIndex) / (storyChapters.length - 1) * 88}%` }} />
          <div className={`relative z-10 flex min-w-max flex-1 items-center justify-between ${gravityMode ? 'gap-2' : 'gap-6'}`}>
            {storyChapters.map((chapter, index) => {
              const isActive = index <= activeIndex;
              const isCurrent = index === activeIndex;
              return <button ref={isCurrent ? activeButtonRef : null} type="button" key={chapter.id} onClick={() => onSelect(index)} className={`group flex flex-col items-center text-center ${gravityMode ? 'min-w-[68px]' : 'min-w-[112px]'}`}>
                <span className={`history-step ${isCurrent ? 'is-current' : isActive ? 'is-active' : ''}`}>{chapter.step}</span>
                <span className={`history-label mt-1.5 font-mono text-[7px] tracking-[0.08em] ${isCurrent ? 'is-current' : ''}`}>{chapter.label}</span>
                <span className={`history-title mt-0.5 text-[10px] font-medium ${isCurrent ? 'is-current' : isActive ? 'is-active' : ''}`}>{chapter.title}</span>
              </button>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MemoryUniverse() {
  const graph = useMemo(() => createMemoryGraph(), []);
  const [gravityRootId, setGravityRootId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(-1);
  const [gravitySummary, setGravitySummary] = useState<GravitySummary | null>(null);
  const [playing, setPlaying] = useState(false);
  const [viewResetVersion, setViewResetVersion] = useState(0);
  const [selectionFocusVersion, setSelectionFocusVersion] = useState(0);
  const [graphReady, setGraphReady] = useState(false);
  const [graphError, setGraphError] = useState(false);
  const [query, setQuery] = useState('결제 승인 후 잔액이 늦게 반영돼요');
  const timerRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const rootNode = graph.nodes.find((node) => node.id === gravityRootId) ?? null;
  const selectedDirectCount = useMemo(() => {
    if (!selectedId) return 0;
    const neighbors = new Set<string>();
    for (const link of graph.links) {
      const source = linkEndpointId(link.source);
      const target = linkEndpointId(link.target);
      if (source === selectedId) neighbors.add(target);
      if (target === selectedId) neighbors.add(source);
    }
    return neighbors.size;
  }, [graph.links, selectedId]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStory = useCallback(() => {
    clearTimer();
    setPlaying(false);
  }, [clearTimer]);

  const playStory = useCallback(() => {
    clearTimer();
    setPlaying(true);
    setActiveCluster(null);
    setActiveStoryIndex(0);
    setGravityRootId(storyPath[0]);
    setSelectedId(storyPath[0]);
    setSelectionFocusVersion((version) => version + 1);
    let index = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timerRef.current = window.setInterval(() => {
      index += 1;
      if (index >= storyPath.length) {
        clearTimer();
        setPlaying(false);
        return;
      }
      setActiveStoryIndex(index);
      setSelectedId(storyPath[index]);
      setSelectionFocusVersion((version) => version + 1);
    }, reduced ? 240 : 2200);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        stopStory();
        setGravityRootId(null);
        setSelectedId(null);
        setActiveStoryIndex(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stopStory]);

  const handleSelect = (node: MemoryNode | null) => {
    stopStory();
    if (node) {
      setActiveCluster(null);
      setGravityRootId((current) => current ?? node.id);
      setSelectedId(node.id);
      setSelectionFocusVersion((version) => version + 1);
    } else {
      setGravityRootId(null);
      setSelectedId(null);
    }
    if (node?.isStory) {
      const storyIndex = storyPath.indexOf(node.id);
      if (storyIndex >= 0) setActiveStoryIndex(storyIndex);
    } else setActiveStoryIndex(-1);
  };

  const selectStoryStep = (index: number) => {
    stopStory();
    setActiveStoryIndex(index);
    setGravityRootId(storyPath[0]);
    setSelectedId(storyPath[index]);
    setSelectionFocusVersion((version) => version + 1);
  };

  const submitQuery = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim()) playStory();
  };

  return (
    <TooltipProvider delay={300}>
      <main className="memory-shell fixed inset-0 overflow-clip">
        <div className="memory-aurora" /><div className="memory-grid" />
        <GraphStage nodes={graph.nodes} links={graph.links} gravityRootId={gravityRootId} selectedId={selectedId} activeCluster={activeCluster} activeStoryIndex={activeStoryIndex} viewResetVersion={viewResetVersion} selectionFocusVersion={selectionFocusVersion} onSelect={handleSelect} onGravityChange={setGravitySummary} onReady={() => setGraphReady(true)} onError={() => setGraphError(true)} />
        <div className="sr-only" aria-live="polite">{selectedNode ? `${selectedNode.issueKey} 선택. 직접 연결 ${selectedDirectCount}개, History Tree ${gravitySummary?.treeCount ?? 0}개.` : '전체 Development Memory Graph 보기.'}</div>

        <header data-graph-obstruction="top" className="notebook-header pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-[68px] items-center gap-4 px-5">
          <div className="pointer-events-auto flex min-w-[248px] items-center gap-3 max-lg:min-w-0">
            <div className="logo-mark"><Network className="size-[17px]" /></div>
            <div><div className="flex items-center gap-2"><span className="editorial-heading text-[15px] tracking-[0.12em]">WEBSIDIAN</span><span className="notebook-stamp hidden sm:inline">GRAPH 01</span></div><p className="notebook-muted mt-0.5 hidden text-[9px] uppercase tracking-[0.16em] sm:block">DEVELOPMENT MEMORY GRAPH</p></div>
          </div>
          <form onSubmit={submitQuery} className="pointer-events-auto mx-auto w-full max-w-[620px]">
            <div className="search-orbit group relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9d9d9d]" /><Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="새로운 이슈 검색" className="notebook-search h-10 pl-10 pr-20 text-[12px]" placeholder="새로운 이슈를 입력해 History를 탐색하세요" /><span className="search-shortcut absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 font-mono text-[8px]"><Command className="mr-1 inline size-2.5" />K</span></div>
          </form>
          <div className="pointer-events-auto flex min-w-[248px] items-center justify-end gap-2 max-lg:min-w-0">
            <div className="notebook-rule-right hidden items-center gap-3 pr-4 2xl:flex"><div className="text-right"><div className="font-mono text-[11px]">{graph.nodes.length} / {graph.links.length}</div><div className="notebook-muted text-[8px] uppercase tracking-[0.1em]">records / relations</div></div><span className="status-pulse" /></div>
            <Tooltip><TooltipTrigger render={<Button onClick={() => { stopStory(); setGravityRootId(null); setSelectedId(null); setActiveStoryIndex(-1); setActiveCluster(null); setViewResetVersion((value) => value + 1); }} variant="ghost" size="icon-lg" aria-label="전체 기록 보기로 복귀" className="notebook-icon-button" />}><RotateCcw /></TooltipTrigger><TooltipContent>전체 기록으로 복귀</TooltipContent></Tooltip>
            <Button type="button" variant="outline" disabled={!selectedNode} onClick={() => setSelectionFocusVersion((version) => version + 1)} className="context-badge hidden h-9 px-3 text-[10px] font-semibold tracking-[0.08em] md:flex"><Maximize2 data-icon="inline-start" /> CONTEXT FOCUS</Button>
          </div>
        </header>

        <div data-graph-obstruction="top" className="pointer-events-auto absolute left-3 right-3 top-[76px] z-30 flex gap-1.5 overflow-x-auto [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => { setActiveCluster(null); setGravityRootId(null); setSelectedId(null); }} className={`source-chip ${activeCluster === null ? 'is-active' : ''}`}>ALL</button>
          {clusters.map((cluster) => (
            <button key={cluster.id} type="button" onClick={() => { stopStory(); setActiveStoryIndex(-1); setActiveCluster(activeCluster === cluster.id ? null : cluster.id); setGravityRootId(null); setSelectedId(null); }} className={`source-chip ${activeCluster === cluster.id ? 'is-active' : ''}`} style={{ '--chip-color': cluster.color } as React.CSSProperties}>
              <span style={{ backgroundColor: cluster.color }} />{cluster.label}
            </button>
          ))}
        </div>

        <ClusterRail activeCluster={activeCluster} nodes={graph.nodes} totalLinks={graph.links.length} onSelect={(cluster) => { stopStory(); setActiveStoryIndex(-1); setActiveCluster(cluster); setGravityRootId(null); setSelectedId(null); }} />
        {rootNode && selectedNode && <GravityLegend root={rootNode} selected={selectedNode} directCount={selectedDirectCount} summary={gravitySummary} />}
        {selectedNode && <Inspector key={selectedNode.id} node={selectedNode} directCount={selectedDirectCount} gravitySummary={gravitySummary} onClose={() => { setGravityRootId(null); setSelectedId(null); setActiveStoryIndex(-1); }} />}
        {!rootNode && <AxisCompass nodeCount={graph.nodes.length} linkCount={graph.links.length} />}
        <div className="pointer-events-none absolute left-[286px] top-[92px] z-10 hidden xl:block"><div className="eyebrow">{rootNode ? 'CONTEXT TREE · ACTIVE' : 'GRAPH WORKBENCH · LIVE'}</div><div className="notebook-muted mt-2 flex items-center gap-2 text-[11px]"><span className="status-pulse !size-1.5" />{activeStoryIndex >= 0 ? storyChapters[activeStoryIndex]?.caption : selectedNode ? `${selectedNode.issueKey}의 직접 연결 ${selectedDirectCount}개를 밝게 강조했습니다.` : '마우스는 노드를 밀어내고, 드래그한 기억은 연결을 흔든 뒤 원래 성운으로 복귀합니다.'}</div></div>
        <div className="pointer-events-auto absolute bottom-[128px] left-[286px] z-20 hidden items-center gap-2 xl:flex"><div className="interaction-pill"><Sparkles /> MOVE · REPEL</div><div className="interaction-pill"><RotateCcw /> DRAG · NODE / ORBIT</div><div className="interaction-pill"><Box /> SCROLL · SCALE</div><div className="interaction-pill"><CircleDot /> CLICK · FOCUS</div></div>

        {!graphReady && !graphError && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><div className="flex flex-col items-center"><div className="loading-orbit"><span /><span /><span /></div><div className="notebook-muted mt-5 font-mono text-[9px] tracking-[0.2em]">INITIALIZING MEMORY GRAPH</div></div></div>}
        {graphError && <div className="graph-error-backdrop pointer-events-auto absolute inset-0 z-20 flex items-center justify-center px-6"><div className="universe-panel max-w-md p-6 text-center"><Cpu className="mx-auto size-7 text-[#f85149]" /><h2 className="editorial-heading mt-4 text-lg">3D 기록 지도를 열 수 없습니다</h2><p className="notebook-muted mt-2 text-sm leading-6">WebGL이 활성화된 브라우저에서 다시 열면 Development Memory Graph를 확인할 수 있습니다.</p></div></div>}
        <HistoryRail activeIndex={activeStoryIndex} playing={playing} gravityMode={Boolean(rootNode)} onPlay={() => (playing ? stopStory() : playStory())} onSelect={selectStoryStep} />
      </main>
    </TooltipProvider>
  );
}
