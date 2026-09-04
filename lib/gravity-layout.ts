import {
  getClusters,
  linkEndpointId,
  type MemoryLink,
  type MemoryNode,
} from '@/lib/memory-graph';

export type GraphPosition = { x: number; y: number; z: number };

export type GraphBasis = {
  right: GraphPosition;
  up: GraphPosition;
  forward: GraphPosition;
};

export type GravityLayout = {
  positions: Map<string, GraphPosition>;
  depthById: Map<string, number>;
  parentById: Map<string, string>;
  primaryLinkKeys: Set<string>;
  focusIds: Set<string>;
  rootId: string;
  floorY: number;
  directCount: number;
  treeCount: number;
  sedimentCount: number;
};

export const WORLD_BASIS: GraphBasis = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
};

const LEVEL_LIMITS = [1, 64, 44, 36] as const;
const HOP_GAP = 92;

function hash(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function noise(input: string, salt: string) {
  return hash(`${salt}:${input}`) / 4294967295;
}

function centeredNoise(input: string, salt: string) {
  return (
    ((noise(input, `${salt}:a`) +
      noise(input, `${salt}:b`) +
      noise(input, `${salt}:c`)) /
      3) *
      2 -
    1
  );
}

function scale(vector: GraphPosition, amount: number): GraphPosition {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

function add(...vectors: GraphPosition[]): GraphPosition {
  return vectors.reduce(
    (result, vector) => ({
      x: result.x + vector.x,
      y: result.y + vector.y,
      z: result.z + vector.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

function normalize(vector: GraphPosition): GraphPosition {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return scale(vector, 1 / length);
}

function monthIndex(occurredAt: string) {
  return (
    (Number(occurredAt.slice(0, 4)) - 2025) * 12 +
    Number(occurredAt.slice(5, 7)) -
    1
  );
}

function connectionPriority(
  _parent: MemoryNode,
  _child: MemoryNode,
  link: MemoryLink,
) {
  return link.score;
}

export function memoryLinkKey(link: MemoryLink) {
  if (link.id) return link.id;
  const source = linkEndpointId(link.source);
  const target = linkEndpointId(link.target);
  return `${source}::${target}::${link.relation}`;
}

/** Stable force-relaxed nebula: links shape distance; labels never gate proximity. */
export function createNebulaLayout(
  nodes: MemoryNode[],
  links: MemoryLink[] = [],
) {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const positions = new Map<string, GraphPosition>();
  const dates = ordered.map((n) => monthIndex(n.occurredAt));
  const centerDate = dates.length
    ? (Math.min(...dates) + Math.max(...dates)) / 2
    : 0;
  for (const node of ordered)
    positions.set(node.id, {
      x:
        centeredNoise(node.id, 'nebula-x') * 400 +
        (monthIndex(node.occurredAt) - centerDate) * 2,
      y: centeredNoise(node.id, 'nebula-y') * 280,
      z: centeredNoise(node.id, 'nebula-z') * 280,
    });
  const pairs = links
    .map((link) => ({
      a: positions.get(linkEndpointId(link.source))!,
      b: positions.get(linkEndpointId(link.target))!,
      score: link.score,
    }))
    .filter((p) => p.a && p.b);
  for (let step = 0; step < 110; step += 1) {
    const cooling = 0.8 * (1 - step / 140);
    const values = [...positions.values()];
    for (let a = 0; a < values.length; a += 1)
      for (let b = a + 1; b < values.length; b += 1) {
        const p = values[a],
          q = values[b],
          dx = p.x - q.x,
          dy = p.y - q.y,
          dz = p.z - q.z;
        const distance = Math.max(8, Math.hypot(dx, dy, dz));
        const force = Math.min(1.8, 180 / (distance * distance)) * cooling;
        p.x += (dx / distance) * force;
        p.y += (dy / distance) * force;
        p.z += (dz / distance) * force;
        q.x -= (dx / distance) * force;
        q.y -= (dy / distance) * force;
        q.z -= (dz / distance) * force;
      }
    for (const { a, b, score } of pairs) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dz = b.z - a.z,
        distance = Math.max(1, Math.hypot(dx, dy, dz));
      const force = (distance - (40 + 55 * (1 - score))) * 0.022 * cooling;
      a.x += (dx / distance) * force;
      a.y += (dy / distance) * force;
      a.z += (dz / distance) * force;
      b.x -= (dx / distance) * force;
      b.y -= (dy / distance) * force;
      b.z -= (dz / distance) * force;
    }
    for (const p of values) {
      p.x *= 0.999;
      p.y *= 0.999;
      p.z *= 0.999;
    }
  }
  return positions;
}

type Adjacent = { nodeId: string; link: MemoryLink; priority: number };

function buildAdjacency(nodes: MemoryNode[], links: MemoryLink[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Adjacent[]>();
  const append = (from: string, to: string, link: MemoryLink) => {
    const parent = byId.get(from);
    const child = byId.get(to);
    if (!parent || !child) return;
    const list = adjacency.get(from) ?? [];
    list.push({
      nodeId: to,
      link,
      priority: connectionPriority(parent, child, link),
    });
    adjacency.set(from, list);
  };
  for (const link of links) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    append(source, target, link);
    append(target, source, link);
  }
  for (const list of adjacency.values()) {
    list.sort(
      (left, right) =>
        right.priority - left.priority ||
        left.nodeId.localeCompare(right.nodeId),
    );
  }
  return adjacency;
}

function createDepthMap(rootId: string, adjacency: Map<string, Adjacent[]>) {
  const depths = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift() as string;
    const nextDepth = (depths.get(current) ?? 0) + 1;
    if (nextDepth > 3) continue;
    for (const adjacent of adjacency.get(current) ?? []) {
      if (depths.has(adjacent.nodeId)) continue;
      depths.set(adjacent.nodeId, nextDepth);
      queue.push(adjacent.nodeId);
    }
  }
  return depths;
}

export function createGravityLayout({
  nodes,
  links,
  rootId,
  anchor,
  basis = WORLD_BASIS,
}: {
  nodes: MemoryNode[];
  links: MemoryLink[];
  rootId: string;
  anchor: GraphPosition;
  basis?: GraphBasis;
}): GravityLayout {
  const clusters = getClusters(nodes);
  const laneCenter = (clusters.length - 1) / 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(nodes, links);
  const shortestDepth = createDepthMap(rootId, adjacency);
  const depthById = new Map<string, number>([[rootId, 0]]);
  const parentById = new Map<string, string>();
  const primaryLinkKeys = new Set<string>();
  const focusIds = new Set<string>([rootId]);
  const parentPriority = new Map<string, number>();

  for (let depth = 1; depth <= 3; depth += 1) {
    const candidates = nodes
      .filter((node) => shortestDepth.get(node.id) === depth)
      .map((node) => {
        const possibleParents = (adjacency.get(node.id) ?? [])
          .filter((entry) => depthById.get(entry.nodeId) === depth - 1)
          .sort(
            (left, right) =>
              right.priority - left.priority ||
              left.nodeId.localeCompare(right.nodeId),
          );
        return { node, parent: possibleParents[0] };
      })
      .filter(
        (candidate): candidate is { node: MemoryNode; parent: Adjacent } =>
          Boolean(candidate.parent),
      )
      .sort(
        (left, right) =>
          right.parent.priority - left.parent.priority ||
          left.node.id.localeCompare(right.node.id),
      )
      .slice(0, LEVEL_LIMITS[depth]);

    for (const candidate of candidates) {
      depthById.set(candidate.node.id, depth);
      parentById.set(candidate.node.id, candidate.parent.nodeId);
      parentPriority.set(candidate.node.id, candidate.parent.priority);
      primaryLinkKeys.add(memoryLinkKey(candidate.parent.link));
      focusIds.add(candidate.node.id);
    }
  }

  const right = normalize(basis.right);
  const up = normalize(basis.up);
  const forward = normalize(basis.forward);
  const positions = new Map<string, GraphPosition>([[rootId, { ...anchor }]]);
  const childrenByParent = new Map<string, string[]>();
  for (const [childId, parentId] of parentById) {
    const children = childrenByParent.get(parentId) ?? [];
    children.push(childId);
    childrenByParent.set(parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, rightId) => {
      const scoreDifference =
        (parentPriority.get(rightId) ?? 0) - (parentPriority.get(left) ?? 0);
      if (scoreDifference) return scoreDifference;
      return (byId.get(left)?.occurredAt ?? '').localeCompare(
        byId.get(rightId)?.occurredAt ?? '',
      );
    });
  }

  const rawHorizontal = new Map<string, number>();
  const siblingIndexById = new Map<string, { index: number; count: number }>();
  let leafCursor = 0;
  const assignLeafSpan = (nodeId: string): number => {
    const children = childrenByParent.get(nodeId) ?? [];
    if (!children.length) {
      const position = leafCursor;
      leafCursor += 1;
      rawHorizontal.set(nodeId, position);
      return position;
    }
    const childPositions = children.map((childId, index) => {
      siblingIndexById.set(childId, { index, count: children.length });
      return assignLeafSpan(childId);
    });
    const center =
      (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
    rawHorizontal.set(nodeId, center);
    return center;
  };
  assignLeafSpan(rootId);

  const rawValues = [...rawHorizontal.values()];
  const rawMinimum = Math.min(...rawValues);
  const rawMaximum = Math.max(...rawValues);
  const rawCenter = (rawMinimum + rawMaximum) / 2;
  const leafIntervals = Math.max(1, rawMaximum - rawMinimum);
  const treeSpan = Math.min(780, Math.max(180, leafIntervals * 22));
  const horizontalScale = treeSpan / leafIntervals;

  for (const nodeId of focusIds) {
    if (nodeId === rootId) continue;
    const node = byId.get(nodeId);
    const depth = depthById.get(nodeId) ?? 0;
    const clusterLane =
      clusters.find((cluster) => cluster.id === node?.cluster)?.lane ??
      laneCenter;
    const sibling = siblingIndexById.get(nodeId) ?? { index: 0, count: 1 };
    const siblingFan =
      sibling.count > 8
        ? ((sibling.index % 3) - 1) * 11
        : (sibling.index - (sibling.count - 1) / 2) *
          Math.min(3, 18 / sibling.count);
    const depthOffset =
      (clusterLane - laneCenter) * 6 +
      siblingFan +
      centeredNoise(nodeId, 'tree-depth') * 6;
    const horizontalOffset =
      ((rawHorizontal.get(nodeId) ?? rawCenter) - rawCenter) * horizontalScale;
    positions.set(
      nodeId,
      add(
        anchor,
        scale(right, horizontalOffset),
        scale(up, -depth * HOP_GAP),
        scale(forward, depthOffset),
      ),
    );
  }

  const floorDistance = 355;
  const floorNodes = nodes.filter((node) => !focusIds.has(node.id));
  for (const cluster of clusters) {
    const clusterNodes = floorNodes
      .filter((node) => node.cluster === cluster.id)
      .sort(
        (left, rightNode) =>
          left.occurredAt.localeCompare(rightNode.occurredAt) ||
          left.id.localeCompare(rightNode.id),
      );
    const columns = 3;
    const rowCount = Math.ceil(clusterNodes.length / columns);
    clusterNodes.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const across =
        (cluster.lane - laneCenter) *
          Math.min(82, 620 / Math.max(1, clusters.length)) +
        (column - 1) * 21 +
        centeredNoise(node.id, 'floor-x') * 0.8;
      const floorDepth =
        (row - (rowCount - 1) / 2) * 21 +
        88 +
        centeredNoise(node.id, 'floor-z') * 0.8;
      const surface = floorDistance - noise(node.id, 'floor-y') * 2;
      positions.set(
        node.id,
        add(
          anchor,
          scale(right, across),
          scale(up, -surface),
          scale(forward, floorDepth),
        ),
      );
    });
  }

  return {
    positions,
    depthById,
    parentById,
    primaryLinkKeys,
    focusIds,
    rootId,
    floorY: anchor.y - floorDistance,
    directCount: [...depthById.values()].filter((depth) => depth === 1).length,
    treeCount: focusIds.size,
    sedimentCount: nodes.length - focusIds.size,
  };
}
