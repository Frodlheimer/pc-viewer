import { useCallback, useRef, useState, type RefObject } from "react";
import type { DeckGLRef } from "@deck.gl/react";
import type { SelectionItem, EditMode } from "../../state/store";
import type { TileRenderData } from "../../types/Tile";
import type { MouseEvent as ReactMouseEvent } from "react";

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type UseRectangleSelectionOptions = {
  editMode: EditMode;
  containerRef: RefObject<HTMLDivElement | null>;
  deckRef: RefObject<DeckGLRef | null>;
  pointLayerIds: string[];
  tileByLayerId: Map<string, TileRenderData>;
  buildSelectionItem: (
    tile: TileRenderData,
    index: number,
    coordinate?: number[] | null
  ) => SelectionItem;
  onSelectionChange: (items: SelectionItem[]) => void;
};

export const useRectangleSelection = ({
  editMode,
  containerRef,
  deckRef,
  pointLayerIds,
  tileByLayerId,
  buildSelectionItem,
  onSelectionChange,
}: UseRectangleSelectionOptions) => {
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);

  const getLocalPoint = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const element = containerRef.current;
      if (!element) {
        return { x: 0, y: 0 };
      }
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return { x, y };
    },
    [containerRef]
  );

  const commitRectangleSelection = useCallback(
    (rect: SelectionRect) => {
      if (!deckRef.current || pointLayerIds.length === 0) {
        onSelectionChange([]);
        return;
      }
      const picks = deckRef.current.pickObjects({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        layerIds: pointLayerIds,
      });
      const selected = new Map<string, SelectionItem>();
      picks.forEach((info) => {
        if (info.index === undefined || info.index < 0) {
          return;
        }
        const layerId = info.layer?.id;
        if (!layerId) {
          return;
        }
        const tile = tileByLayerId.get(layerId);
        if (!tile) {
          return;
        }
        const item = buildSelectionItem(
          tile,
          info.index,
          Array.isArray(info.coordinate) ? info.coordinate : null
        );
        const key = `${item.nodeId}:${item.index}`;
        if (!selected.has(key)) {
          selected.set(key, item);
        }
      });
      onSelectionChange(Array.from(selected.values()));
    },
    [buildSelectionItem, deckRef, onSelectionChange, pointLayerIds, tileByLayerId]
  );

  const handleSelectionMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (editMode !== "select" || !event.shiftKey || event.button !== 0) {
        return;
      }
      const start = getLocalPoint(event);
      selectionStartRef.current = start;
      setSelectionRect({ x: start.x, y: start.y, width: 0, height: 0 });
      event.preventDefault();
      event.stopPropagation();
    },
    [editMode, getLocalPoint]
  );

  const handleSelectionMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectionStartRef.current) {
        return;
      }
      const current = getLocalPoint(event);
      const start = selectionStartRef.current;
      const rect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      };
      setSelectionRect(rect);
      event.preventDefault();
      event.stopPropagation();
    },
    [getLocalPoint]
  );

  const handleSelectionMouseUp = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectionStartRef.current) {
        return;
      }
      const end = getLocalPoint(event);
      const start = selectionStartRef.current;
      selectionStartRef.current = null;
      const rect = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
      setSelectionRect(null);
      commitRectangleSelection(rect);
      event.preventDefault();
      event.stopPropagation();
    },
    [commitRectangleSelection, getLocalPoint]
  );

  const handleSelectionMouseLeave = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectionStartRef.current) {
        return;
      }
      handleSelectionMouseUp(event);
    },
    [handleSelectionMouseUp]
  );

  return {
    selectionRect,
    handlers: {
      onMouseDownCapture: handleSelectionMouseDown,
      onMouseMoveCapture: handleSelectionMouseMove,
      onMouseUpCapture: handleSelectionMouseUp,
      onMouseLeave: handleSelectionMouseLeave,
    },
  };
};
