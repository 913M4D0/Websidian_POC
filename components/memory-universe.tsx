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
  AXIS_MODEL,
  clusters,
  createMemoryGraph,
  linkEndpointId,
  relevanceBands,
  type MemoryLink,
  type MemoryNode,
  storyChapters,
  storyPath,
  timeTicks,
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
  enableNodeDrag: (value: boolean) => GraphInstance;
  cameraPosition: (
    position: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number },
    duration?: number,
  ) => GraphInstance;
  controls: () => { autoRotate: boolean; autoRotateSpeed: number };
  scene: () => { add: (object: unknown) => void };
  refresh: () => GraphInstance;
  _destructor?: () => void;
  postProcessingComposer?: () => { addPass: (pass: unknown) => void };
};

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

/* oxlint-disable react/react-compiler -- The imperative WebGL lifecycle is intentionally isolated from React compilation. */
function GraphStage({
  nodes,
  links,
  selectedId,
  activeCluster,
  activeStoryIndex,
  autoRotate,
  viewResetVersion,
  onSelect,
  onReady,
  onError,
}: {
  nodes: MemoryNode[];
  links: MemoryLink[];
  selectedId: string | null;
  activeCluster: string | null;
  activeStoryIndex: number;
  autoRotate: boolean;
  viewResetVersion: number;
  onSelect: (node: MemoryNode | null) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance | null>(null);
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  const stateRef = useRef({ selectedId, activeCluster, activeStoryIndex, autoRotate });
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const reducedMotionRef = useRef(false);

  nodesRef.current = nodes;
  linksRef.current = links;
  stateRef.current = { selectedId, activeCluster, activeStoryIndex, autoRotate };
  onSelectRef.current = onSelect;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const getActiveIds = useCallback(() => {
    const state = stateRef.current;
    const ids = new Set<string>();
    if (state.activeStoryIndex > 0) {
      storyPath.slice(0, state.activeStoryIndex + 1).forEach((id) => ids.add(id));
    }
    if (state.selectedId) {
      ids.add(state.selectedId);
      for (const link of linksRef.current) {
        const source = linkEndpointId(link.source);
        const target = linkEndpointId(link.target);
        if (source === state.selectedId) ids.add(target);
        if (target === state.selectedId) ids.add(source);
      }
    }
    return ids;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function mountGraph() {
      const element = containerRef.current;
      if (!element) return;
      const testCanvas = document.createElement('canvas');
      if (!(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'))) {
        onErrorRef.current();
        return;
      }

      try {
        reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const [{ default: ForceGraph3D }, THREE, { UnrealBloomPass }] = await Promise.all([
          import('3d-force-graph'),
          import('three'),
          import('three/addons/postprocessing/UnrealBloomPass.js'),
        ]);
        if (cancelled || !containerRef.current) return;

        const graph = new ForceGraph3D(containerRef.current, {
          controlType: 'orbit',
          rendererConfig: { antialias: true, alpha: true },
        }) as unknown as GraphInstance;
        graphRef.current = graph;

        const isActiveLink = (link: MemoryLink) => {
          const state = stateRef.current;
          const source = linkEndpointId(link.source);
          const target = linkEndpointId(link.target);
          for (let index = 0; index < Math.max(0, state.activeStoryIndex); index += 1) {
            if (source === storyPath[index] && target === storyPath[index + 1]) return true;
          }
          return Boolean(state.selectedId && (source === state.selectedId || target === state.selectedId));
        };

        graph
          .backgroundColor('rgba(2,4,10,0)')
          .width(containerRef.current.clientWidth)
          .height(containerRef.current.clientHeight)
          .graphData({
            nodes: nodesRef.current.map((node) => ({ ...node })),
            links: linksRef.current.map((link) => ({ ...link })),
          })
          .nodeId('id')
          .nodeLabel((node) => `<div class="graph-tooltip"><span>${kindLabels[node.kind]}</span><strong>${node.issueKey}</strong><p>${node.name}</p></div>`)
          .nodeColor((node) => {
            const state = stateRef.current;
            const active = getActiveIds();
            if (state.activeCluster && node.cluster !== state.activeCluster && !node.isStory) return hexToRgba(node.color, 0.08);
            if (active.size && !active.has(node.id) && !node.isHub) return hexToRgba(node.color, node.relevance < 0.6 ? 0.045 : 0.11);
            if (node.relevance < 0.6 && !node.isHub) return hexToRgba(node.color, 0.1);
            if (node.id === state.selectedId) return node.kind === 'query' ? '#ffffff' : node.color;
            return node.color;
          })
          .nodeVal((node) => {
            if (node.id === stateRef.current.selectedId) return node.kind === 'query' ? 10 : 7.5;
            if (node.kind === 'query') return 12;
            if (node.isHub) return 9;
            if (node.isStory) return 6;
            return (node.kind === 'decision' ? 3.2 : 1.7) + node.relevance * 2.1;
          })
          .nodeOpacity(0.94)
          .nodeResolution(12)
          .nodeThreeObjectExtend(true)
          .nodeThreeObject((node) => {
            if (!(node.isHub || node.isStory || node.id === stateRef.current.selectedId)) return undefined;
            const group = new THREE.Group();
            const sprite = new SpriteText(node.isHub ? node.clusterLabel.toUpperCase() : node.issueKey);
            sprite.color = node.id === stateRef.current.selectedId ? '#ffffff' : node.color;
            sprite.textHeight = node.isHub ? 5.4 : 3.2;
            sprite.fontWeight = node.isHub ? '700' : '600';
            sprite.backgroundColor = node.id === stateRef.current.selectedId ? 'rgba(4,8,18,.78)' : false;
            sprite.padding = node.id === stateRef.current.selectedId ? [3, 5] : 0;
            sprite.borderRadius = 5;
            sprite.position.y = node.isHub ? 12 : 8;
            group.add(sprite);

            if (node.kind === 'query' || node.id === stateRef.current.selectedId) {
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
            if (isActiveLink(link)) return '#bff6ff';
            const source = nodesRef.current.find((node) => node.id === linkEndpointId(link.source));
            if (stateRef.current.activeCluster && source?.cluster !== stateRef.current.activeCluster) return 'rgba(53,75,110,.035)';
            return 'rgba(80,123,174,.12)';
          })
          .linkWidth((link) => (isActiveLink(link) ? 1.8 : 0.22))
          .linkOpacity(1)
          .linkDirectionalParticles((link) => (isActiveLink(link) ? 3 : 0))
          .linkDirectionalParticleWidth((link) => (isActiveLink(link) ? 2.4 : 0))
          .linkDirectionalParticleColor(() => '#d9fbff')
          .linkDirectionalParticleSpeed((link) => (isActiveLink(link) ? 0.007 : 0))
          .linkDirectionalArrowLength((link) => (isActiveLink(link) ? 2.6 : 0))
          .linkCurvature((link) => (link.story ? 0.09 : Math.max(0.015, (link.score - 0.35) * 0.04)))
          .onNodeClick((node) => onSelectRef.current(node))
          .onNodeHover((node) => {
            if (containerRef.current) containerRef.current.style.cursor = node ? 'pointer' : 'grab';
          })
          .onBackgroundClick(() => onSelectRef.current(null))
          .enableNodeDrag(false)
          .warmupTicks(0)
          .cooldownTicks(0)
          .onEngineStop(() => onReadyRef.current());

        const controls = graph.controls();
        controls.autoRotate = !reducedMotionRef.current && stateRef.current.autoRotate;
        controls.autoRotateSpeed = 0.22;
        graph.cameraPosition({ x: 0, y: 36, z: 1050 }, { x: 0, y: 0, z: 90 }, 0);

        const composer = graph.postProcessingComposer?.();
        if (composer) {
          composer.addPass(new UnrealBloomPass(new THREE.Vector2(element.clientWidth, element.clientHeight), 0.62, 0.82, 0.22));
        }

        const guides = new THREE.Group();
        const line = (points: [number, number, number][], color: string, opacity: number) => {
          const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
          return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
        };
        const xStart = -266;
        const xEnd = 266;
        const yStart = -392;
        const yEnd = 392;

        guides.add(new THREE.Mesh(
          new THREE.PlaneGeometry(xEnd - xStart, yEnd - yStart),
          new THREE.MeshBasicMaterial({ color: '#0b2235', transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false }),
        ));

        for (const cluster of clusters) {
          const y = (3.5 - cluster.lane) * AXIS_MODEL.serviceGap;
          guides.add(line([[xStart, y, -1], [xEnd, y, -1]], cluster.color, 0.2));
          for (const moduleIndex of [-1, 1]) {
            guides.add(line([[xStart, y + moduleIndex * AXIS_MODEL.moduleGap, -2], [xEnd, y + moduleIndex * AXIS_MODEL.moduleGap, -2]], cluster.color, 0.045));
          }
          const label = new SpriteText(cluster.label);
          label.color = cluster.color;
          label.textHeight = 4.2;
          label.fontWeight = '700';
          label.position.set(xStart - 27, y, 0);
          guides.add(label);
        }

        for (const tick of timeTicks) {
          const x = (tick.monthIndex - 10) * AXIS_MODEL.monthStep;
          guides.add(line([[x, yStart, -2], [x, yEnd, -2]], tick.label === 'NOW' ? '#e9fdff' : '#79b8dd', tick.label === 'NOW' ? 0.24 : 0.075));
          const label = new SpriteText(tick.label);
          label.color = tick.label === 'NOW' ? '#e9fdff' : '#6688a3';
          label.textHeight = 3.8;
          label.fontWeight = tick.label === 'NOW' ? '700' : '500';
          label.position.set(x, yStart - 15, 0);
          guides.add(label);
        }

        guides.add(line([[xEnd, yEnd, 0], [xEnd, yEnd, AXIS_MODEL.queryDepth]], '#7df3ca', 0.22));
        for (const band of relevanceBands.slice(0, 4)) {
          guides.add(line([[xEnd - 5, yEnd, band.depth], [xEnd + 5, yEnd, band.depth]], '#7df3ca', 0.28));
          const label = new SpriteText(`${Math.round(band.min * 100)}%`);
          label.color = '#78aa9d';
          label.textHeight = 3.2;
          label.position.set(xEnd + 14, yEnd, band.depth);
          guides.add(label);
        }
        graph.scene().add(guides);

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
      graphRef.current?._destructor?.();
      graphRef.current = null;
    };
  }, [getActiveIds]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.controls().autoRotate = !reducedMotionRef.current && autoRotate;
    graph.refresh();
  }, [autoRotate]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.refresh();
    if (!selectedId) return;
    const node = nodes.find((item) => item.id === selectedId);
    if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    graph.cameraPosition(
      { x: node.x + 110, y: node.y + 55, z: node.z + 230 },
      { x: node.x, y: node.y, z: node.z },
      reducedMotionRef.current ? 120 : 820,
    );
  }, [activeCluster, activeStoryIndex, nodes, selectedId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || viewResetVersion === 0) return;
    graph.controls().autoRotate = false;
    graph.cameraPosition(
      { x: 0, y: 36, z: 1050 },
      { x: 0, y: 0, z: 90 },
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
  const surfaced = nodes.filter((node) => node.relevance >= 0.6).length;
  return (
    <aside className="universe-panel pointer-events-auto absolute bottom-[118px] left-5 top-[88px] z-20 hidden w-[246px] flex-col overflow-hidden xl:flex">
      <div className="border-b border-white/[0.07] px-4 pb-3 pt-4">
        <div className="eyebrow">SOURCE LANES · Y AXIS</div>
        <div className="mt-2 flex items-end justify-between">
          <div><p className="text-[22px] font-medium tracking-[-0.04em] text-white">8 Services</p><p className="mt-0.5 text-[11px] text-slate-500">24 modules · {nodes.length} memories</p></div>
          <Waypoints className="mb-1 size-4 text-cyan-300/80" />
        </div>
      </div>
      <div className="flex-1 px-2 py-2">
        <button type="button" onClick={() => onSelect(null)} className={`cluster-item ${activeCluster === null ? 'is-active' : ''}`}>
          <span className="cluster-dot bg-white shadow-[0_0_14px_rgba(255,255,255,.7)]" />
          <span className="min-w-0 flex-1"><strong>전체 기억</strong><small>ALL SOURCE LANES</small></span><span className="cluster-count">{nodes.length}</span>
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
          {([[String(surfaced), 'surfaced'], [String(totalLinks), 'relations'], ['5', 'z bands']] as const).map(([value, label]) => (
            <div key={label}><div className="font-mono text-[13px] text-slate-200">{value}</div><div className="text-[9px] uppercase tracking-[0.08em] text-slate-600">{label}</div></div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AxisCompass() {
  return (
    <div className="axis-compass pointer-events-none absolute right-5 top-[88px] z-20 hidden xl:block">
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-3.5 py-2.5">
        <div><div className="eyebrow">EXPLAINABLE COORDINATES</div><p className="mt-1 text-[10px] text-slate-500">위치는 관계선이 아니라 세 가지 근거로 결정됩니다.</p></div>
        <span className="rounded border border-emerald-300/10 bg-emerald-300/[0.05] px-2 py-1 font-mono text-[8px] text-emerald-200/70">FIXED</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-white/[0.05]">
        <div className="axis-cell"><b className="text-cyan-200">X</b><span>TIME</span><small>1 month = 24</small></div>
        <div className="axis-cell"><b className="text-violet-200">Y</b><span>SOURCE</span><small>service › module › file</small></div>
        <div className="axis-cell"><b className="text-emerald-200">Z</b><span>RELEVANCE</span><small>0 · 40 · 80 · 120 · 160</small></div>
      </div>
    </div>
  );
}

function Inspector({ node, onClose }: { node: MemoryNode; onClose: () => void }) {
  const Icon = kindIcons[node.kind];
  const relevanceBand = node.kind === 'query'
    ? { label: 'QUERY', depth: AXIS_MODEL.queryDepth }
    : relevanceBands.find((band) => node.relevance >= band.min) ?? relevanceBands[relevanceBands.length - 1];
  return (
    <aside className="universe-panel inspector pointer-events-auto absolute bottom-[118px] right-5 top-[88px] z-30 flex w-[390px] max-w-[calc(100vw-40px)] flex-col overflow-hidden max-lg:bottom-[112px] max-lg:top-auto max-lg:h-[46vh]">
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
          <section className="coordinate-card">
            <div className="flex items-center justify-between"><div className="section-label"><Waypoints /> 공간 좌표 근거</div><span className="font-mono text-[8px] text-emerald-200/65">DETERMINISTIC</span></div>
            <div className="mt-3 space-y-2.5">
              <div className="coordinate-row"><b className="text-cyan-200">X</b><span><small>발생 시간</small><strong>{node.occurredAt}</strong></span><code>{node.x.toFixed(0)}</code></div>
              <div className="coordinate-row"><b className="text-violet-200">Y</b><span><small>변경 소스</small><strong>{node.service} / {node.module}</strong><em>{node.primaryFile}</em></span><code>{node.y.toFixed(0)}</code></div>
              <div className="coordinate-row"><b className="text-emerald-200">Z</b><span><small>Query 관련도</small><strong>{Math.round(node.relevance * 100)}% · {relevanceBand.label}</strong><i><span style={{ width: `${node.relevance * 100}%` }} /></i></span><code>{relevanceBand.depth}</code></div>
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

function HistoryRail({ activeIndex, playing, onPlay, onSelect }: { activeIndex: number; playing: boolean; onPlay: () => void; onSelect: (index: number) => void }) {
  return (
    <div className="universe-panel pointer-events-auto absolute bottom-5 left-5 right-5 z-40 h-[88px] overflow-hidden max-lg:h-[82px]">
      <div className="flex h-full items-center">
        <div className="flex h-full w-[220px] shrink-0 items-center gap-3 border-r border-white/[0.07] px-4 max-md:w-auto max-md:border-r-0 max-md:px-3">
          <Button type="button" onClick={onPlay} size="icon-lg" className="size-11 rounded-full border border-cyan-200/30 bg-cyan-200/10 text-cyan-100 shadow-[0_0_24px_rgba(83,231,255,.15)] hover:bg-cyan-200/20" aria-label={playing ? '기억 경로 일시 정지' : '기억 경로 재생'}>{playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}</Button>
          <div className="max-md:hidden"><div className="eyebrow">ANALYSIS REPLAY</div><div className="mt-1 text-[12px] text-slate-300">Query 탐색 경로</div></div>
        </div>
        <div className="relative flex min-w-0 flex-1 items-center overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="absolute left-8 right-8 top-[31px] h-px bg-white/[0.07]" />
          <div className="absolute left-8 top-[31px] h-px bg-gradient-to-r from-cyan-300 via-violet-400 to-emerald-300 transition-[width] duration-700" style={{ width: `${Math.max(0, activeIndex) / (storyChapters.length - 1) * 88}%` }} />
          <div className="relative z-10 flex min-w-max flex-1 items-center justify-between gap-6">
            {storyChapters.map((chapter, index) => {
              const isActive = index <= activeIndex;
              const isCurrent = index === activeIndex;
              return <button type="button" key={chapter.id} onClick={() => onSelect(index)} className="group flex min-w-[112px] flex-col items-center text-center">
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
  const [selectedId, setSelectedId] = useState<string | null>('query-current');
  const [activeCluster, setActiveCluster] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [viewResetVersion, setViewResetVersion] = useState(0);
  const [graphReady, setGraphReady] = useState(false);
  const [graphError, setGraphError] = useState(false);
  const [query, setQuery] = useState('결제 승인 후 잔액이 늦게 반영돼요');
  const timerRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null;

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
    }, reduced ? 320 : 1160);
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
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stopStory]);

  const handleSelect = (node: MemoryNode | null) => {
    stopStory();
    setSelectedId(node?.id ?? null);
    if (node?.isStory) {
      const storyIndex = storyPath.indexOf(node.id);
      if (storyIndex >= 0) setActiveStoryIndex(storyIndex);
    } else if (node) setActiveStoryIndex(-1);
  };

  const selectStoryStep = (index: number) => {
    stopStory();
    setActiveStoryIndex(index);
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
        <GraphStage nodes={graph.nodes} links={graph.links} selectedId={selectedId} activeCluster={activeCluster} activeStoryIndex={activeStoryIndex} autoRotate={autoRotate} viewResetVersion={viewResetVersion} onSelect={handleSelect} onReady={() => setGraphReady(true)} onError={() => setGraphError(true)} />

        <header className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-[68px] items-center gap-4 border-b border-white/[0.06] bg-[#04070d]/75 px-5 backdrop-blur-xl">
          <div className="pointer-events-auto flex min-w-[248px] items-center gap-3 max-lg:min-w-0">
            <div className="logo-mark"><Network className="size-[17px]" /></div>
            <div><div className="flex items-center gap-2"><span className="text-[14px] font-semibold tracking-[0.16em] text-white">WEBSIDIAN</span><span className="hidden rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.14em] text-slate-500 sm:inline">POC 02</span></div><p className="mt-0.5 hidden text-[9px] uppercase tracking-[0.16em] text-slate-600 sm:block">DEVELOPMENT MEMORY OBSERVATORY</p></div>
          </div>
          <form onSubmit={submitQuery} className="pointer-events-auto mx-auto w-full max-w-[620px]">
            <div className="search-orbit group relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-cyan-200/70" /><Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="새로운 이슈 검색" className="h-10 rounded-full border-white/[0.09] bg-white/[0.045] pl-10 pr-20 text-[12px] text-slate-100 placeholder:text-slate-600 focus-visible:border-cyan-300/30 focus-visible:ring-cyan-300/10" placeholder="새로운 이슈를 입력해 History를 탐색하세요" /><span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[8px] text-slate-500"><Command className="mr-1 inline size-2.5" />K</span></div>
          </form>
          <div className="pointer-events-auto flex min-w-[248px] items-center justify-end gap-2 max-lg:min-w-0">
            <div className="hidden items-center gap-3 border-r border-white/[0.07] pr-4 2xl:flex"><div className="text-right"><div className="font-mono text-[11px] text-slate-300">{graph.nodes.length} / {graph.links.length}</div><div className="text-[8px] uppercase tracking-[0.1em] text-slate-600">nodes / relations</div></div><span className="status-pulse" /></div>
            <Tooltip><TooltipTrigger render={<Button onClick={() => { setAutoRotate(false); setViewResetVersion((value) => value + 1); }} variant="ghost" size="icon-lg" aria-label="축 정렬 보기로 복귀" className="rounded-full border border-white/[0.07] text-slate-400 hover:bg-white/[0.06] hover:text-white" />}><RotateCcw /></TooltipTrigger><TooltipContent>축 정렬 보기</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button onClick={() => setAutoRotate((value) => !value)} variant="ghost" size="icon-lg" aria-label="자동 회전 전환" className={`rounded-full border border-white/[0.07] text-slate-400 hover:bg-white/[0.06] hover:text-white ${autoRotate ? 'bg-white/[0.05] text-cyan-200' : ''}`} />}><Orbit /></TooltipTrigger><TooltipContent>자동 궤도 회전</TooltipContent></Tooltip>
            <Button type="button" variant="outline" className="hidden h-9 rounded-full border-cyan-200/20 bg-cyan-200/[0.055] px-3 text-[10px] font-semibold tracking-[0.08em] text-cyan-100 hover:bg-cyan-200/10 md:flex"><Maximize2 data-icon="inline-start" /> TRI-AXIS 3D</Button>
          </div>
        </header>

        <div className="pointer-events-auto absolute left-3 right-3 top-[76px] z-30 flex gap-1.5 overflow-x-auto [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => setActiveCluster(null)} className={`source-chip ${activeCluster === null ? 'is-active' : ''}`}>ALL</button>
          {clusters.map((cluster) => (
            <button key={cluster.id} type="button" onClick={() => { stopStory(); setActiveStoryIndex(-1); setActiveCluster(cluster.id); setSelectedId(`hub-${cluster.id}`); }} className={`source-chip ${activeCluster === cluster.id ? 'is-active' : ''}`} style={{ '--chip-color': cluster.color } as React.CSSProperties}>
              <span style={{ backgroundColor: cluster.color }} />{cluster.label}
            </button>
          ))}
        </div>

        <ClusterRail activeCluster={activeCluster} nodes={graph.nodes} totalLinks={graph.links.length} onSelect={(cluster) => { stopStory(); setActiveStoryIndex(-1); setActiveCluster(cluster); if (cluster) setSelectedId(`hub-${cluster}`); }} />
        {selectedNode && <Inspector node={selectedNode} onClose={() => setSelectedId(null)} />}
        {!selectedNode && <AxisCompass />}
        <div className="pointer-events-none absolute left-[286px] top-[92px] z-10 hidden xl:block"><div className="eyebrow">MEMORY OBSERVATORY · LIVE</div><div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500"><span className="status-pulse !size-1.5" />{activeStoryIndex >= 0 ? storyChapters[activeStoryIndex]?.caption : '노드를 선택해 시간 · 소스 · 관련도 근거를 확인하세요.'}</div></div>
        <div className="pointer-events-auto absolute bottom-[128px] left-[286px] z-20 hidden items-center gap-2 xl:flex"><div className="interaction-pill"><RotateCcw /> DRAG TO TILT</div><div className="interaction-pill"><Box /> SCROLL TO ZOOM</div><div className="interaction-pill"><CircleDot /> CLICK TO TRACE</div></div>

        {!graphReady && !graphError && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><div className="flex flex-col items-center"><div className="loading-orbit"><span /><span /><span /></div><div className="mt-5 font-mono text-[9px] tracking-[0.2em] text-cyan-100/60">ASSEMBLING MEMORY UNIVERSE</div></div></div>}
        {graphError && <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-[#03060c]/80 px-6"><div className="universe-panel max-w-md p-6 text-center"><Cpu className="mx-auto size-7 text-amber-300" /><h2 className="mt-4 text-lg font-semibold">3D 가속을 시작할 수 없습니다</h2><p className="mt-2 text-sm leading-6 text-slate-400">WebGL이 활성화된 브라우저에서 다시 열면 Memory Universe를 확인할 수 있습니다.</p></div></div>}
        <HistoryRail activeIndex={activeStoryIndex} playing={playing} onPlay={() => (playing ? stopStory() : playStory())} onSelect={selectStoryStep} />
      </main>
    </TooltipProvider>
  );
}
