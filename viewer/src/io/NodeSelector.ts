import type { NodeRecord, Page } from "../types/Hierarchy";

export type NodeSelectionInputs = {
  zoom: number;
};

const zoomToLevel = (zoom: number) => Math.max(0, Math.floor(zoom));

export const selectNodes = (
  inputs: NodeSelectionInputs,
  hierarchy: Page,
  maxNodes: number
): NodeRecord[] => {
  const targetLevel = zoomToLevel(inputs.zoom);
  const nodesAtLevel = hierarchy.records.filter(
    (node) => node.level === targetLevel
  );

  if (nodesAtLevel.length > 0) {
    return maxNodes <= 0 ? nodesAtLevel : nodesAtLevel.slice(0, maxNodes);
  }

  if (hierarchy.records.length === 0) {
    return [];
  }

  const minLevel = Math.min(...hierarchy.records.map((node) => node.level));
  const fallback = hierarchy.records.filter((node) => node.level === minLevel);
  return maxNodes <= 0 ? fallback : fallback.slice(0, maxNodes);
};
