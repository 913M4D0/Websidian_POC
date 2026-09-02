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
  Orbit,
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
  linkCurvature: (accessor: (link: MemoryLink) => number) => GraphInstance;
  onNodeClick: (handler: (node: MemoryNode) => void) => GraphInstance;
  onNodeHover: (handler: (node: MemoryNode | null) => void) => GraphInstance;
  onBackgroundClick: (handler: () => void) => GraphInstance;
  onEngineStop: (handler: () => void) => GraphInstance;
  cooldownTicks: (value: number) => GraphInstance;
  warmupTicks: (value: number) => GraphInstance;
  d3ReheatSimulation: () => GraphInstance;
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
  scene: () => { add: (object: unknown) => void };
  refresh: () => GraphInstance;
  _destructor?: () => void;
  postProcessingComposer?: () => { addPass: (pass: unknown) => void };
};

type GravitySummary = Pick<GravityLayout, 'directCount' | 'treeCount' | 'sedimentCount'>;

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

/* oxlint-disable react/react-compiler -- The imperative WebGL lifecycle is intentionally isolated from React compilation. */
function GraphStage({
  nodes,
  links,
  gravityRootId,
  selectedId,
  activeCluster,
  activeStoryIndex,
  autoRotate,
  viewResetVersion,
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
  autoRotate: boolean;
  viewResetVersion: number;
  onSelect: (node: MemoryNode | null) => void;
  onGravityChange: (summary: GravitySummary | null) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const [graphMounted, setGraphMounted] = useState(false);
  const runtimeNodesRef = useRef<MemoryNode[]>([]);
  const nebulaPositionsRef = useRef<Map<string, GraphPosition>>(new Map());
  const gravityLayoutRef = useRef<GravityLayout | null>(null);
  const threeRef = useRef<typeof import('three') | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const neighborIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const nebulaMaterialsRef = useRef<Array<{ opacity: number }>>([]);
  const floorMaterialsRef = useRef<Array<{ opacity: number }>>([]);
  const floorGroupRef = useRef<import('three').Group | null>(null);
  const gravityCameraRef = useRef<{ position: GraphPosition; target: GraphPosition } | null>(null);
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  const stateRef = useRef({ gravityRootId, selectedId, activeCluster, activeStoryIndex, autoRotate });
  const onSelectRef = useRef(onSelect);
  const onGravityChangeRef = useRef(onGravityChange);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const reducedMotionRef = useRef(false);

  nodesRef.current = nodes;
  linksRef.current = links;
  stateRef.current = { gravityRootId, selectedId, activeCluster, activeStoryIndex, autoRotate };
  onSelectRef.current = onSelect;
  onGravityChangeRef.current = onGravityChange;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let motionQuery: MediaQueryList | null = null;
    const updateMotionPreference = (event: MediaQueryListEvent | MediaQueryList) => {
      reducedMotionRef.current = event.matches;
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
        const [{ default: ForceGraph3D }, THREE, { UnrealBloomPass }] = await Promise.all([
          import('3d-force-graph'),
          import('three'),
          import('three/addons/postprocessing/UnrealBloomPass.js'),
        ]);
        if (cancelled || !containerRef.current) return;
        threeRef.current = THREE;

        const nebulaPositions = createNebulaLayout(nodesRef.current);
        nebulaPositionsRef.current = nebulaPositions;
        const runtimeNodes = nodesRef.current.map((node) => {
          const position = nebulaPositions.get(node.id) ?? { x: node.x, y: node.y, z: node.z };
          return { ...node, ...position, fx: position.x, fy: position.y, fz: position.z };
        });
        runtimeNodesRef.current = runtimeNodes;
        const neighborIds = new Map(nodesRef.current.map((node) => [node.id, new Set<string>()]));
        for (const link of linksRef.current) {
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          neighborIds.get(source)?.add(target);
          neighborIds.get(target)?.add(source);
        }
        neighborIdsRef.current = neighborIds;

        const graph = new ForceGraph3D(containerRef.current, {
          controlType: 'orbit',
          rendererConfig: { antialias: true, alpha: true },
        }) as unknown as GraphInstance;
        graphRef.current = graph;

        const isDirectHighlight = (link: MemoryLink) => {
          const state = stateRef.current;
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          const hover = hoveredIdRef.current;
          if (hover && (source === hover || target === hover)) return true;
          for (let index = 0; index < Math.max(0, state.activeStoryIndex); index += 1) {
            if (source === storyPath[index] && target === storyPath[index + 1]) return true;
          }
          if (state.selectedId) return source === state.selectedId || target === state.selectedId;
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
          .backgroundColor('rgba(2,4,10,0)')
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
            if (node.id === hover || node.id === state.selectedId || node.id === state.gravityRootId) return '#ffffff';
            if (selectedNeighbor || hoverNeighbor) return node.color;
            if (hover || state.selectedId) {
              const focusDepth = gravity?.depthById.get(node.id);
              if (focusDepth !== undefined) return hexToRgba(node.color, focusDepth === 1 ? 0.5 : focusDepth === 2 ? 0.36 : 0.26);
              if (!gravity) return hexToRgba(node.color, 0.18);
            }
            if (gravity) {
              const depth = gravity.depthById.get(node.id);
              if (depth === 1) return node.color;
              if (depth === 2) return hexToRgba(node.color, 0.72);
              if (depth === 3) return hexToRgba(node.color, 0.48);
              if (depth === undefined) return hexToRgba(node.color, node.isHub ? 0.32 : 0.24);
            }
            if (state.activeCluster && node.cluster !== state.activeCluster && !node.isStory) return hexToRgba(node.color, 0.18);
            return node.color;
          })
          .nodeVal((node) => {
            const gravity = gravityLayoutRef.current;
            const depth = gravity?.depthById.get(node.id);
            const state = stateRef.current;
            const hover = hoveredIdRef.current;
            const selectedNeighbor = Boolean(state.selectedId && neighborIdsRef.current.get(state.selectedId)?.has(node.id));
            const hoverNeighbor = Boolean(hover && neighborIdsRef.current.get(hover)?.has(node.id));
            if (node.id === hover || node.id === state.selectedId || node.id === state.gravityRootId) return node.kind === 'query' ? 13 : 10;
            if (selectedNeighbor || hoverNeighbor) return 5.8 + node.importance * 2;
            if (depth === 1) return 5.5 + node.importance * 2;
            if (depth === 2) return 4 + node.importance;
            if (node.kind === 'query') return 12;
            if (node.isHub) return 9;
            if (node.isStory) return 6;
            return (node.kind === 'decision' ? 3.2 : 1.7) + node.relevance * 2.1;
          })
          .nodeOpacity(0.94)
          .nodeResolution(12)
          .nodeThreeObjectExtend(true)
          .nodeThreeObject((node) => {
            const gravity = gravityLayoutRef.current;
            const depth = gravity?.depthById.get(node.id);
            const state = stateRef.current;
            if (!(node.isHub || node.isStory || node.id === state.selectedId || node.id === state.gravityRootId || node.id === hoveredIdRef.current || depth === 1)) return undefined;
            const group = new THREE.Group();
            const sprite = new SpriteText(node.isHub ? node.clusterLabel.toUpperCase() : node.issueKey);
            sprite.color = node.id === state.selectedId || node.id === state.gravityRootId || node.id === hoveredIdRef.current ? '#ffffff' : node.color;
            sprite.textHeight = node.isHub ? 5.1 : depth === 1 ? 2.7 : 3.2;
            sprite.fontWeight = node.isHub ? '700' : '600';
            sprite.backgroundColor = node.id === state.selectedId || node.id === state.gravityRootId ? 'rgba(4,8,18,.78)' : false;
            sprite.padding = node.id === state.selectedId || node.id === state.gravityRootId ? [3, 5] : 0;
            sprite.borderRadius = 5;
            sprite.position.y = node.isHub ? 12 : 8;
            group.add(sprite);

            if (node.kind === 'query' || node.id === state.selectedId || node.id === state.gravityRootId || node.id === hoveredIdRef.current) {
              const ringColor = node.kind === 'query' ? '#c9fbff' : node.color;
              const ring = new THREE.Mesh(
                new THREE.TorusGeometry(node.kind === 'query' ? 11.5 : 8.5, 0.32, 10, 64),
                new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.72 }),
              );
              const orbit = new THREE.Mesh(
                new THREE.TorusGeometry(node.kind === 'query' ? 16 : 11.5, 0.12, 8, 64),
                new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.34 }),
              );
              orbit.rotation.x = Math.PI * 0.62;
              orbit.rotation.z = Math.PI * 0.15;
              group.add(ring, orbit);
            }
            return group;
          })
          .linkColor((link) => {
            if (isDirectHighlight(link)) return '#d9fbff';
            if (isPrimaryTreeLink(link)) return 'rgba(117,219,255,.68)';
            if (isFocusedCrossLink(link)) return 'rgba(169,120,255,.32)';
            const source = nodesRef.current.find((node) => node.id === linkEndpointId(link.source));
            if (gravityLayoutRef.current) return 'rgba(71,104,137,.065)';
            if (stateRef.current.activeCluster && source?.cluster !== stateRef.current.activeCluster) return 'rgba(53,75,110,.08)';
            return source ? hexToRgba(source.color, 0.16 + link.score * 0.09) : 'rgba(80,123,174,.16)';
          })
          .linkWidth((link) => isDirectHighlight(link) ? 1.55 : 0)
          .linkOpacity(1)
          .linkDirectionalParticles((link) => (!reducedMotionRef.current && isDirectHighlight(link) ? 3 : 0))
          .linkDirectionalParticleWidth((link) => (isDirectHighlight(link) ? 2.4 : 0))
          .linkDirectionalParticleColor(() => '#d9fbff')
          .linkDirectionalParticleSpeed((link) => (isDirectHighlight(link) ? 0.007 : 0))
          .linkDirectionalArrowLength((link) => (isDirectHighlight(link) ? 2.6 : 0))
          .linkCurvature((link) => gravityLayoutRef.current
            ? isFocusedCrossLink(link) ? 0.065 : 0
            : link.story ? 0.08 : Math.max(0.015, (link.score - 0.35) * 0.04))
          .onNodeClick((node) => onSelectRef.current(node))
          .onNodeHover((node) => {
            hoveredIdRef.current = node?.id ?? null;
            if (containerRef.current) containerRef.current.style.cursor = node ? 'pointer' : 'grab';
            graphRef.current?.refresh();
          })
          .onBackgroundClick(() => onSelectRef.current(null))
          .enableNodeDrag(false)
          .warmupTicks(0)
          .cooldownTicks(0)
          .onEngineStop(() => onReadyRef.current());

        const controls = graph.controls();
        controls.autoRotate = !reducedMotionRef.current && stateRef.current.autoRotate;
        controls.autoRotateSpeed = 0.22;
        graph.cameraPosition({ x: 0, y: 24, z: 690 }, { x: 0, y: -16, z: 0 }, 0);

        const composer = graph.postProcessingComposer?.();
        if (composer) {
          composer.addPass(new UnrealBloomPass(new THREE.Vector2(element.clientWidth, element.clientHeight), 0.82, 0.9, 0.18));
        }

        const nebulaMaterials: Array<{ opacity: number }> = [];
        for (const cluster of clusters) {
          const center = nebulaCenters.get(cluster.id) ?? { x: 0, y: 0, z: 0 };
          const dustGeometry = new THREE.BufferGeometry();
          const dust = new Float32Array(150 * 3);
          let seed = 913 + cluster.lane * 177;
          const random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          for (let index = 0; index < 150; index += 1) {
            const radius = Math.pow(random(), 0.72);
            const theta = random() * Math.PI * 2;
            const phi = Math.acos(2 * random() - 1);
            dust[index * 3] = center.x + Math.sin(phi) * Math.cos(theta) * radius * 102;
            dust[index * 3 + 1] = center.y + Math.sin(phi) * Math.sin(theta) * radius * 66;
            dust[index * 3 + 2] = center.z + Math.cos(phi) * radius * 92;
          }
          dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust, 3));
          const material = new THREE.PointsMaterial({ color: cluster.color, size: 1.3, transparent: true, opacity: 0.2, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending });
          nebulaMaterials.push(material);
          graph.scene().add(new THREE.Points(dustGeometry, material));
        }
        nebulaMaterialsRef.current = nebulaMaterials;

        const floorGroup = new THREE.Group();
        const floorPlaneMaterial = new THREE.MeshBasicMaterial({ color: '#071c28', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
        const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(760, 440), floorPlaneMaterial);
        const floorGrid = new THREE.GridHelper(760, 30, '#4d8ba1', '#153443');
        const gridMaterial = floorGrid.material as import('three').Material;
        gridMaterial.transparent = true;
        gridMaterial.opacity = 0;
        floorGroup.add(floorPlane, floorGrid);
        floorGroup.visible = false;
        floorGroupRef.current = floorGroup;
        floorMaterialsRef.current = [floorPlaneMaterial, gridMaterial];
        graph.scene().add(floorGroup);

        const starGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(520 * 3);
        let starSeed = 913;
        const starRandom = () => {
          starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
          return starSeed / 4294967296;
        };
        for (let index = 0; index < 520; index += 1) {
          const radius = 700 + starRandom() * 620;
          const theta = starRandom() * Math.PI * 2;
          const phi = Math.acos(2 * starRandom() - 1);
          positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
          positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
          positions[index * 3 + 2] = radius * Math.cos(phi);
        }
        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        graph.scene().add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#8eb8d9', size: 0.7, transparent: true, opacity: 0.24, sizeAttenuation: true })));
        setGraphMounted(true);
        window.requestAnimationFrame(() => onReadyRef.current());

        resizeObserver = new ResizeObserver(([entry]) => {
          graph.width(entry.contentRect.width).height(entry.contentRect.height);
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
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      graphRef.current?._destructor?.();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.controls().autoRotate = !reducedMotionRef.current && autoRotate && !gravityRootId;
    graph.refresh();
  }, [activeCluster, activeStoryIndex, autoRotate, gravityRootId, selectedId]);

  useEffect(() => {
    const graph = graphRef.current;
    const THREE = threeRef.current;
    const runtimeNodes = runtimeNodesRef.current;
    if (!graphMounted || !graph || !THREE || !runtimeNodes.length) return;

    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
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
      const usesBottomSheet = width < 1024;
      const safeRect = {
        left: (width >= 1280 ? 286 : 20) + 18,
        right: width - (usesBottomSheet ? 20 : 430) - 18,
        top: (usesBottomSheet ? 112 : 88) + 18,
        bottom: Math.max(
          (usesBottomSheet ? 112 : 88) + 130,
          height - (usesBottomSheet ? 92 + height * 0.34 : 118) - 18,
        ),
      };
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

      const rootProjection = anchorVector.clone().project(camera);
      const rootScreen = {
        x: (rootProjection.x + 1) * width / 2,
        y: (1 - rootProjection.y) * height / 2,
      };
      const rootInsideSafeRect = rootScreen.x >= safeRect.left && rootScreen.x <= safeRect.right
        && rootScreen.y >= safeRect.top && rootScreen.y <= safeRect.bottom;
      let framePosition = cameraStart.position;
      let frameTarget = cameraStart.target;
      let fitScale = rootInsideSafeRect ? findFitScale(framePosition, frameTarget, 3.2) : null;

      if (fitScale === null) {
        const availableWidth = Math.max(80, safeRect.right - safeRect.left);
        const availableHeight = Math.max(100, safeRect.bottom - safeRect.top);
        const rootBand = {
          top: safeRect.top + Math.min(36, availableHeight * 0.16),
          bottom: safeRect.top + Math.min(126, availableHeight * 0.3),
        };
        const desiredScreen = {
          x: safeRect.left + availableWidth / 2,
          y: Math.max(rootBand.top, Math.min(rootBand.bottom, rootScreen.y)),
        };
        const desiredNdc = {
          x: desiredScreen.x / width * 2 - 1,
          y: 1 - desiredScreen.y / height * 2,
        };
        const rootInCamera = anchorVector.clone().applyMatrix4(camera.matrixWorldInverse);
        const halfHeightAtRoot = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * -rootInCamera.z;
        const cameraTranslation = rightVector.clone().multiplyScalar(rootInCamera.x - desiredNdc.x * halfHeightAtRoot * camera.aspect)
          .add(upVector.clone().multiplyScalar(rootInCamera.y - desiredNdc.y * halfHeightAtRoot));
        framePosition = new THREE.Vector3(cameraStart.position.x, cameraStart.position.y, cameraStart.position.z).add(cameraTranslation);
        frameTarget = new THREE.Vector3(cameraStart.target.x, cameraStart.target.y, cameraStart.target.z).add(cameraTranslation);
        fitScale = findFitScale(framePosition, frameTarget, 12) ?? 12;
      }

      const framed = toFrame(framePosition, frameTarget, fitScale);
      cameraTarget = {
        position: { x: framed.position.x, y: framed.position.y, z: framed.position.z },
        target: { x: framed.target.x, y: framed.target.y, z: framed.target.z },
      };

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
    const duration = reducedMotionRef.current ? 1 : gravityRootId ? 1900 : 1120;
    const startedAt = performance.now();
    const nebulaStartOpacity = nebulaMaterialsRef.current[0]?.opacity ?? 0.2;
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
          ? 90 + ((node.id.length * 37 + node.id.charCodeAt(0) * 13) % 260)
          : gravityRootId ? 150 + (depth ?? 0) * 150 : ((node.id.length * 19) % 120);
        const local = clamp((elapsed - delay) / Math.max(1, duration - delay));
        const horizontalProgress = easeInOut(local);
        let verticalProgress = easeOut(local);
        let bounce = 0;
        if (isSediment) {
          if (local < 0.84) verticalProgress = Math.pow(local / 0.84, 2);
          else {
            verticalProgress = 1;
            const rebound = (local - 0.84) / 0.16;
            bounce = Math.sin(rebound * Math.PI) * 8 * (1 - rebound);
          }
        } else if (gravityRootId && !isRoot) {
          verticalProgress = 1 - Math.exp(-6 * local) * Math.cos(8.5 * local);
        }
        node.x = start.x + (target.x - start.x) * horizontalProgress;
        node.y = start.y + (target.y - start.y) * verticalProgress + bounce;
        node.z = start.z + (target.z - start.z) * horizontalProgress;
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      }

      const materialProgress = easeOut(overall);
      const nebulaTargetOpacity = gravityRootId ? 0.048 : 0.2;
      const floorTargetOpacity = gravityRootId ? 0.12 : 0;
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
          if (floorGroup) floorGroup.visible = false;
        }
        if (clearGravityCamera) gravityCameraRef.current = null;
        graph.controls().enabled = true;
        graph.cooldownTicks(0).refresh();
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [graphMounted, gravityRootId, nodes]);

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

  return <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />;
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
    <aside className="universe-panel pointer-events-auto absolute bottom-[118px] left-5 top-[88px] z-20 hidden w-[246px] flex-col overflow-hidden xl:flex">
      <div className="border-b border-white/[0.07] px-4 pb-3 pt-4">
        <div className="eyebrow">NEBULA COMMUNITIES</div>
        <div className="mt-2 flex items-end justify-between">
          <div><p className="text-[22px] font-medium tracking-[-0.04em] text-white">8 Services</p><p className="mt-0.5 text-[11px] text-slate-500">24 modules · {nodes.length} memories</p></div>
          <Waypoints className="mb-1 size-4 text-cyan-300/80" />
        </div>
      </div>
      <div className="flex-1 px-2 py-2">
        <button type="button" onClick={() => onSelect(null)} className={`cluster-item ${activeCluster === null ? 'is-active' : ''}`}>
          <span className="cluster-dot bg-white shadow-[0_0_14px_rgba(255,255,255,.7)]" />
          <span className="min-w-0 flex-1"><strong>전체 기억 성운</strong><small>ALL MEMORIES VISIBLE</small></span><span className="cluster-count">{nodes.length}</span>
        </button>
        {clusters.map((cluster) => (
          <button type="button" key={cluster.id} onClick={() => onSelect(activeCluster === cluster.id ? null : cluster.id)} className={`cluster-item ${activeCluster === cluster.id ? 'is-active' : ''}`} style={{ '--cluster-color': cluster.color } as React.CSSProperties}>
            <span className="cluster-dot" style={{ backgroundColor: cluster.color, boxShadow: `0 0 14px ${cluster.glow}` }} />
            <span className="min-w-0 flex-1"><strong>{cluster.korean}</strong><small>{cluster.modules[0]} · +2 modules</small></span><span className="cluster-count">{nodes.filter((node) => node.cluster === cluster.id).length}</span>
          </button>
        ))}
      </div>
      <div className="m-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.1em] text-cyan-200/70"><Activity className="size-3" /> LIVE GRAPH HEALTH</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([[String(nodes.length), 'visible'], [String(totalLinks), 'relations'], ['8', 'clouds']] as const).map(([value, label]) => (
            <div key={label}><div className="font-mono text-[13px] text-slate-200">{value}</div><div className="text-[9px] uppercase tracking-[0.08em] text-slate-600">{label}</div></div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AxisCompass({ nodeCount, linkCount }: { nodeCount: number; linkCount: number }) {
  return (
    <div className="axis-compass pointer-events-none absolute right-5 top-[88px] z-20 hidden xl:block">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-3.5 py-2.5">
        <div><div className="eyebrow">MEMORY NEBULA</div><p className="mt-1 text-[10px] text-slate-500">모든 기억과 관계를 숨김없이 펼친 전체 지도입니다.</p></div>
        <span className="rounded border border-cyan-300/10 bg-cyan-300/[0.05] px-2 py-1 font-mono text-[8px] text-cyan-200/70">ALL VISIBLE</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-white/[0.05]">
        <div className="axis-cell"><b className="text-cyan-200">{nodeCount}</b><span>NODES</span><small>8 service clouds</small></div>
        <div className="axis-cell"><b className="text-violet-200">{linkCount}</b><span>RELATIONS</span><small>every edge rendered</small></div>
        <div className="axis-cell"><b className="text-emerald-200">3</b><span>HOPS</span><small>click → gravity tree</small></div>
      </div>
    </div>
  );
}

function GravityLegend({ root, selected, directCount, summary }: { root: MemoryNode; selected: MemoryNode; directCount: number; summary: GravitySummary | null }) {
  return (
    <div className="gravity-legend pointer-events-auto absolute left-1/2 top-[86px] z-20 flex -translate-x-1/2 items-center gap-1.5">
      <span className="gravity-token is-root"><i />{root.issueKey} · ROOT</span>
      <span className="gravity-token is-direct"><i />{selected.issueKey} · {directCount} DIRECT</span>
      <span className="gravity-token is-history"><i />2–3 HOP · HISTORY</span>
      <span className="gravity-token is-floor"><i />{summary?.sedimentCount ?? 0} SEDIMENT</span>
    </div>
  );
}

function Inspector({ node, directCount, gravitySummary, onClose }: { node: MemoryNode; directCount: number; gravitySummary: GravitySummary | null; onClose: () => void }) {
  const Icon = kindIcons[node.kind];
  return (
    <aside className="universe-panel inspector pointer-events-auto absolute bottom-[106px] right-5 top-[88px] z-30 flex w-[390px] max-w-[calc(100vw-40px)] flex-col overflow-hidden max-lg:bottom-[92px] max-lg:top-auto max-lg:h-[34vh]">
      <div className="relative overflow-hidden border-b border-white/[0.07] px-5 pb-5 pt-5">
        <div className="absolute -right-16 -top-24 size-56 rounded-full opacity-15 blur-3xl" style={{ background: node.color }} />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full border" style={{ borderColor: hexToRgba(node.color, 0.35), backgroundColor: hexToRgba(node.color, 0.1), color: node.color, boxShadow: `0 0 22px ${hexToRgba(node.color, 0.18)}` }}><Icon className="size-4" /></span>
            <div><div className="eyebrow" style={{ color: node.color }}>{kindLabels[node.kind]}</div><div className="mt-0.5 font-mono text-[11px] text-slate-500">{node.issueKey}</div></div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="메모리 상세 닫기" className="rounded-full text-slate-500 hover:bg-white/5 hover:text-white"><X /></Button>
        </div>
        <h2 className="relative mt-4 text-[22px] font-semibold leading-[1.28] tracking-[-0.035em] text-white">{node.name}</h2>
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {[node.clusterLabel, node.date, node.owner].map((item) => <Badge key={item} className="border-white/10 bg-white/[0.045] text-[10px] text-slate-300">{item}</Badge>)}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-5 py-5">
          <section className="coordinate-card gravity-card">
            <div className="flex items-center justify-between"><div className="section-label"><Waypoints /> Context Gravity</div><span className="font-mono text-[8px] text-emerald-200/65">ROOT PINNED</span></div>
            <div className="mt-3 space-y-2.5">
              <div className="coordinate-row"><b className="text-cyan-200">1</b><span><small>현재 선택의 직접 연결 · 최우선 강조</small><strong>{directCount}개 Memory Node</strong></span><code>100%</code></div>
              <div className="coordinate-row"><b className="text-violet-200">3</b><span><small>History Tree</small><strong>{gravitySummary?.treeCount ?? '—'}개 노드를 3-hop으로 정렬</strong><em>주 관계선 + 보조 교차 관계선</em></span><code>TREE</code></div>
              <div className="coordinate-row"><b className="text-emerald-200">↓</b><span><small>Memory Sediment</small><strong>{gravitySummary?.sedimentCount ?? '—'}개 비관련 기억도 바닥에 유지</strong><i><span style={{ width: `${node.relevance * 100}%` }} /></i></span><code>{Math.round(node.relevance * 100)}%</code></div>
            </div>
          </section>
          <section><div className="section-label"><Network /> 관련도 산정 근거</div><div className="mt-2.5 space-y-1.5">{node.relevanceReasons.map((reason) => <div key={reason} className="evidence-reason"><span />{reason}</div>)}</div></section>
          <section><div className="section-label"><CircleDot /> 발견된 맥락</div><p className="inspector-copy">{node.summary}</p></section>
          <section><div className="section-label"><Sparkles /> 당시의 기획 의도</div><p className="inspector-copy">{node.intent}</p></section>
          <section><div className="section-label"><ShieldCheck /> 처리 및 결정</div><p className="inspector-copy">{node.resolution}</p></section>
          <section className="rounded-xl border border-amber-300/10 bg-amber-300/[0.045] p-3.5"><div className="section-label !text-amber-200/80"><AlertTriangle /> 사이드 이펙트</div><p className="mt-2 text-[12px] leading-5 text-amber-50/70">{node.risk}</p></section>
          <section><div className="section-label"><Braces /> 변경 소스 파일</div><div className="mt-2.5 space-y-1.5">
            {node.files.map((file) => <button key={file} type="button" className="code-file"><Code2 className="size-3.5" /><span>{file}</span><ArrowUpRight className="ml-auto size-3 text-slate-600" /></button>)}
          </div></section>
        </div>
      </ScrollArea>
      <div className="border-t border-white/[0.07] p-3"><Button className="h-10 w-full rounded-xl bg-cyan-300 text-[12px] font-semibold text-slate-950 shadow-[0_0_28px_rgba(83,231,255,.18)] hover:bg-cyan-200"><Sparkles data-icon="inline-start" /> 현재 이슈 관점으로 Brief 생성</Button></div>
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
    <div className={`history-rail universe-panel pointer-events-auto absolute bottom-5 left-5 right-5 z-40 h-[88px] overflow-hidden max-lg:h-[82px] ${gravityMode ? 'is-gravity' : ''}`}>
      <div className="flex h-full items-center">
        <div className={`flex h-full shrink-0 items-center gap-3 border-r border-white/[0.07] max-md:w-auto max-md:border-r-0 max-md:px-3 ${gravityMode ? 'w-[150px] px-3' : 'w-[220px] px-4'}`}>
          <Button type="button" onClick={onPlay} size="icon-lg" className="size-11 rounded-full border border-cyan-200/30 bg-cyan-200/10 text-cyan-100 shadow-[0_0_24px_rgba(83,231,255,.15)] hover:bg-cyan-200/20" aria-label={playing ? '기억 경로 일시 정지' : '기억 경로 재생'}>{playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}</Button>
          <div className="max-md:hidden"><div className="eyebrow">ANALYSIS REPLAY</div><div className="mt-1 text-[12px] text-slate-300">Query 탐색 경로</div></div>
        </div>
        <div ref={scrollRef} className={`relative flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${gravityMode ? 'px-2' : 'px-4'}`}>
          <div className="absolute left-8 right-8 top-[31px] h-px bg-white/[0.07]" />
          <div className="absolute left-8 top-[31px] h-px bg-gradient-to-r from-cyan-300 via-violet-400 to-emerald-300 transition-[width] duration-700" style={{ width: `${Math.max(0, activeIndex) / (storyChapters.length - 1) * 88}%` }} />
          <div className={`relative z-10 flex min-w-max flex-1 items-center justify-between ${gravityMode ? 'gap-2' : 'gap-6'}`}>
            {storyChapters.map((chapter, index) => {
              const isActive = index <= activeIndex;
              const isCurrent = index === activeIndex;
              return <button ref={isCurrent ? activeButtonRef : null} type="button" key={chapter.id} onClick={() => onSelect(index)} className={`group flex flex-col items-center text-center ${gravityMode ? 'min-w-[68px]' : 'min-w-[112px]'}`}>
                <span className={`flex size-5 items-center justify-center rounded-full border font-mono text-[8px] transition-all duration-500 ${isCurrent ? 'scale-125 border-white bg-white text-slate-950 shadow-[0_0_22px_rgba(255,255,255,.7)]' : isActive ? 'border-cyan-200/60 bg-cyan-200/20 text-cyan-100 shadow-[0_0_12px_rgba(83,231,255,.24)]' : 'border-white/10 bg-[#080c14] text-slate-600'}`}>{chapter.step}</span>
                <span className={`mt-1.5 font-mono text-[7px] tracking-[0.08em] ${isCurrent ? 'text-cyan-200/80' : 'text-slate-700'}`}>{chapter.label}</span>
                <span className={`mt-0.5 text-[10px] font-medium ${isCurrent ? 'text-white' : isActive ? 'text-slate-300' : 'text-slate-600'}`}>{chapter.title}</span>
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
  const [autoRotate, setAutoRotate] = useState(false);
  const [viewResetVersion, setViewResetVersion] = useState(0);
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
    setAutoRotate(false);
    if (node) {
      setActiveCluster(null);
      setGravityRootId((current) => current ?? node.id);
      setSelectedId(node.id);
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
  };

  const submitQuery = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.trim()) playStory();
  };

  return (
    <TooltipProvider delay={300}>
      <main className="memory-shell fixed inset-0 overflow-clip text-slate-100">
        <div className="memory-aurora" /><div className="memory-grid" />
        <GraphStage nodes={graph.nodes} links={graph.links} gravityRootId={gravityRootId} selectedId={selectedId} activeCluster={activeCluster} activeStoryIndex={activeStoryIndex} autoRotate={autoRotate} viewResetVersion={viewResetVersion} onSelect={handleSelect} onGravityChange={setGravitySummary} onReady={() => setGraphReady(true)} onError={() => setGraphError(true)} />
        <div className="sr-only" aria-live="polite">{selectedNode ? `${selectedNode.issueKey} 선택. 직접 연결 ${selectedDirectCount}개, History Tree ${gravitySummary?.treeCount ?? 0}개.` : '전체 Memory Nebula 보기.'}</div>

        <header className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-[68px] items-center gap-4 border-b border-white/[0.06] bg-[#04070d]/75 px-5 backdrop-blur-xl">
          <div className="pointer-events-auto flex min-w-[248px] items-center gap-3 max-lg:min-w-0">
            <div className="logo-mark"><Network className="size-[17px]" /></div>
            <div><div className="flex items-center gap-2"><span className="text-[14px] font-semibold tracking-[0.16em] text-white">WEBSIDIAN</span><span className="hidden rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.14em] text-slate-500 sm:inline">POC 03</span></div><p className="mt-0.5 hidden text-[9px] uppercase tracking-[0.16em] text-slate-600 sm:block">DEVELOPMENT MEMORY OBSERVATORY</p></div>
          </div>
          <form onSubmit={submitQuery} className="pointer-events-auto mx-auto w-full max-w-[620px]">
            <div className="search-orbit group relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-cyan-200/70" /><Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="새로운 이슈 검색" className="h-10 rounded-full border-white/[0.09] bg-white/[0.045] pl-10 pr-20 text-[12px] text-slate-100 placeholder:text-slate-600 focus-visible:border-cyan-300/30 focus-visible:ring-cyan-300/10" placeholder="새로운 이슈를 입력해 History를 탐색하세요" /><span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[8px] text-slate-500"><Command className="mr-1 inline size-2.5" />K</span></div>
          </form>
          <div className="pointer-events-auto flex min-w-[248px] items-center justify-end gap-2 max-lg:min-w-0">
            <div className="hidden items-center gap-3 border-r border-white/[0.07] pr-4 2xl:flex"><div className="text-right"><div className="font-mono text-[11px] text-slate-300">{graph.nodes.length} / {graph.links.length}</div><div className="text-[8px] uppercase tracking-[0.1em] text-slate-600">nodes / relations</div></div><span className="status-pulse" /></div>
            <Tooltip><TooltipTrigger render={<Button onClick={() => { stopStory(); setGravityRootId(null); setSelectedId(null); setActiveStoryIndex(-1); setActiveCluster(null); setAutoRotate(false); setViewResetVersion((value) => value + 1); }} variant="ghost" size="icon-lg" aria-label="전체 성운 보기로 복귀" className="rounded-full border border-white/[0.07] text-slate-400 hover:bg-white/[0.06] hover:text-white" />}><RotateCcw /></TooltipTrigger><TooltipContent>전체 성운으로 복귀</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button onClick={() => setAutoRotate((value) => !value)} variant="ghost" size="icon-lg" aria-label="자동 회전 전환" className={`rounded-full border border-white/[0.07] text-slate-400 hover:bg-white/[0.06] hover:text-white ${autoRotate ? 'bg-white/[0.05] text-cyan-200' : ''}`} />}><Orbit /></TooltipTrigger><TooltipContent>자동 궤도 회전</TooltipContent></Tooltip>
            <Button type="button" variant="outline" className="hidden h-9 rounded-full border-cyan-200/20 bg-cyan-200/[0.055] px-3 text-[10px] font-semibold tracking-[0.08em] text-cyan-100 hover:bg-cyan-200/10 md:flex"><Maximize2 data-icon="inline-start" /> CONTEXT GRAVITY</Button>
          </div>
        </header>

        <div className="pointer-events-auto absolute left-3 right-3 top-[76px] z-30 flex gap-1.5 overflow-x-auto [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden">
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
        <div className="pointer-events-none absolute left-[286px] top-[92px] z-10 hidden xl:block"><div className="eyebrow">{rootNode ? 'CONTEXT GRAVITY · ACTIVE' : 'MEMORY NEBULA · LIVE'}</div><div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500"><span className="status-pulse !size-1.5" />{activeStoryIndex >= 0 ? storyChapters[activeStoryIndex]?.caption : selectedNode ? `${selectedNode.issueKey}의 직접 연결 ${selectedDirectCount}개를 별도로 강조했습니다.` : '노드를 선택하면 관련 기억은 트리로 연결되고 나머지는 기억의 지층으로 내려갑니다.'}</div></div>
        <div className="pointer-events-auto absolute bottom-[128px] left-[286px] z-20 hidden items-center gap-2 xl:flex"><div className="interaction-pill"><RotateCcw /> DRAG TO TILT</div><div className="interaction-pill"><Box /> SCROLL TO ZOOM</div><div className="interaction-pill"><CircleDot /> CLICK · GRAVITY</div><div className="interaction-pill"><Sparkles /> HOVER · 1-HOP</div></div>

        {!graphReady && !graphError && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><div className="flex flex-col items-center"><div className="loading-orbit"><span /><span /><span /></div><div className="mt-5 font-mono text-[9px] tracking-[0.2em] text-cyan-100/60">ASSEMBLING MEMORY UNIVERSE</div></div></div>}
        {graphError && <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-[#03060c]/80 px-6"><div className="universe-panel max-w-md p-6 text-center"><Cpu className="mx-auto size-7 text-amber-300" /><h2 className="mt-4 text-lg font-semibold">3D 가속을 시작할 수 없습니다</h2><p className="mt-2 text-sm leading-6 text-slate-400">WebGL이 활성화된 브라우저에서 다시 열면 Memory Universe를 확인할 수 있습니다.</p></div></div>}
        <HistoryRail activeIndex={activeStoryIndex} playing={playing} gravityMode={Boolean(rootNode)} onPlay={() => (playing ? stopStory() : playStory())} onSelect={selectStoryStep} />
      </main>
    </TooltipProvider>
  );
}
