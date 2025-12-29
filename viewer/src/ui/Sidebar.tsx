import { getRuntimeBudgets } from "../config/budgets";
import { useAppStore } from "../state/store";
import { DATASETS } from "../types/Dataset";
import { keyFromNodeId } from "../utils/nodeKey";

export const Sidebar = () => {
  const { state, dispatch } = useAppStore();
  const { renderData, status, error, hover, selection, settings, runtimeStats } =
    state;
  const primarySelection = selection.items[0];
  const hoverTileEntry =
    settings.debugEnabled &&
    hover?.nodeId !== undefined &&
    typeof window !== "undefined"
      ? (window as { __tileService?: { getCachedEntry: (key: string) => unknown } })
          .__tileService?.getCachedEntry(keyFromNodeId(hover.nodeId))
      : null;
  const hoverEntryWithMeta =
    hoverTileEntry &&
    typeof hoverTileEntry === "object" &&
    "rawBuffer" in hoverTileEntry
      ? (hoverTileEntry as {
          rawBuffer?: ArrayBuffer | Uint8Array;
          decodedOptional?: Map<string, unknown>;
        })
      : null;
  const addedCount = Math.floor(
    state.patches.addedPoints.positions.length / 3
  );
  const totalDeletedCount = settings.debugEnabled
    ? Array.from(state.patches.deleted.values()).reduce((sum, mask) => {
        let count = 0;
        for (let i = 0; i < mask.length; i += 1) {
          if (mask[i] === 0) {
            count += 1;
          }
        }
        return sum + count;
      }, 0)
    : 0;

  const handleSnapshot = () => {
    const budgets = getRuntimeBudgets(settings.performanceProfile);
    console.info({
      profile: settings.performanceProfile,
      resolvedProfile: budgets.profile,
      budgets,
      selection: {
        desiredNodes: runtimeStats.desiredNodes,
        selectedNodes: runtimeStats.selectedNodes,
        retainedNodes: runtimeStats.retainedNodes,
        retainedPoints: runtimeStats.retainedPoints,
        visiblePoints: runtimeStats.visiblePoints,
        targetVisiblePoints: runtimeStats.targetVisiblePoints,
        isInteracting: runtimeStats.isInteracting,
      },
      tiles: {
        loadedTiles: runtimeStats.loadedTiles,
        renderedTiles: runtimeStats.renderedTiles,
        lastNonEmptyTiles: runtimeStats.lastNonEmptyTiles,
        zeroTileWarnings: runtimeStats.zeroTileWarnings,
      },
      tileCache: {
        items: runtimeStats.loadedTiles,
        bytes: runtimeStats.cpuCacheBytes,
        uniqueBuffers: runtimeStats.cacheUniqueBuffers,
        pinnedItems: runtimeStats.pinnedTiles,
        pinnedBytes: runtimeStats.pinnedBytes,
        rawBufferRetainedCount: runtimeStats.rawBufferRetainedCount,
        optionalAttrsDecodedCount: runtimeStats.optionalAttrsDecodedCount,
        rawBufferDroppedOnPressureCount:
          runtimeStats.rawBufferDroppedOnPressureCount,
        rawBufferBytesDropped: runtimeStats.rawBufferBytesDropped,
      },
      hierarchy: {
        pagesLoaded: runtimeStats.hierarchyPagesLoaded,
        inFlight: runtimeStats.hierarchyInFlight,
        eof: runtimeStats.hierarchyEof,
      },
      rangeWindowCache: runtimeStats.rangeCache,
      scheduler: {
        queued: runtimeStats.queuedRequests,
        inFlight: runtimeStats.inFlightRequests,
        canceled: runtimeStats.schedulerCanceled,
      },
      lastSelectionUpdateMs: runtimeStats.lastSelectionUpdateMs,
      lastInteractionMs: runtimeStats.lastInteractionMs,
    });
  };

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">Dataset</div>
        <select
          value={state.activeDatasetId}
          onChange={(event) =>
            dispatch({
              type: "set-active-dataset",
              datasetId: event.target.value,
            })
          }
        >
          {DATASETS.map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name}
            </option>
          ))}
        </select>
        <div className="sidebar-meta">Status: {status}</div>
        {error && <div className="sidebar-error">Error: {error}</div>}
        {renderData && (
          <>
            <div className="sidebar-meta">
              Points: {renderData.pointCountTotal.toLocaleString()}
            </div>
            <div className="sidebar-meta">Tiles: {renderData.tiles.length}</div>
          </>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Hover</div>
        {hover ? (
          <>
            <div className="sidebar-meta">Tile: {hover.tileId}</div>
            <div className="sidebar-meta">Index: {hover.indexWithinTile}</div>
            <div className="sidebar-meta">
              Pos: {hover.worldPosition.map((value) => value.toFixed(2)).join(", ")}
            </div>
            {hover.nodeId !== undefined && (
              <div className="sidebar-meta">Node: {hover.nodeId.toString()}</div>
            )}
            {settings.debugEnabled && hoverEntryWithMeta && (
              <>
                <div className="sidebar-meta">
                  RawBuffer: {hoverEntryWithMeta.rawBuffer ? "yes" : "no"}
                </div>
                <div className="sidebar-meta">
                  Optional Attrs: {hoverEntryWithMeta.decodedOptional?.size ?? 0}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="sidebar-meta">None</div>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Selection</div>
        {selection.items.length > 0 ? (
          <>
            <div className="sidebar-meta">
              Selected: {selection.items.length}
            </div>
            {primarySelection && (
              <>
                <div className="sidebar-meta">
                  Node: {primarySelection.nodeId}
                </div>
                <div className="sidebar-meta">
                  Index: {primarySelection.index}
                </div>
                <div className="sidebar-meta">
                  Pos:{" "}
                  {primarySelection.worldPos
                    .map((value) => value.toFixed(2))
                    .join(", ")}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="sidebar-meta">None</div>
        )}
        <div className="sidebar-meta">
          Tip: Click selects a point. Shift+Drag draws a selection rectangle.
        </div>
        <button
          type="button"
          className="sidebar-button"
          disabled={selection.items.length === 0}
          onClick={() =>
            dispatch({ type: "set-selection", selection: { items: [] } })
          }
        >
          Clear Selection
        </button>
        {state.editMode === "delete" && (
          <button
            type="button"
            className="sidebar-button"
            disabled={selection.items.length === 0}
            onClick={() => dispatch({ type: "request-delete-selection" })}
          >
            Delete Selection
          </button>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Measure</div>
        {state.measurement.a ? (
          <>
            <div className="sidebar-meta">
              A: {state.measurement.a.worldPos.map((value) => value.toFixed(2)).join(", ")}
            </div>
            {state.measurement.b ? (
              <>
                <div className="sidebar-meta">
                  B: {state.measurement.b.worldPos.map((value) => value.toFixed(2)).join(", ")}
                </div>
                <div className="sidebar-meta">
                  Distance:{" "}
                  {state.measurement.distance !== undefined
                    ? `${state.measurement.distance.toFixed(2)} world units`
                    : "n/a"}
                </div>
              </>
            ) : (
              <div className="sidebar-meta">B: not set</div>
            )}
          </>
        ) : (
          <div className="sidebar-meta">Click to set A (then click B)</div>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Patches</div>
        <div className="sidebar-meta">Mode: {state.editMode}</div>
        <div className="sidebar-meta">Added: {addedCount}</div>
        <div className="sidebar-meta">
          Deleted: {state.patches.deleted.size}
        </div>
        <div className="sidebar-meta">
          Updated: {state.patches.updatedAttributes.size}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Debug</div>
        <label className="sidebar-toggle">
          <input
            type="checkbox"
            checked={settings.debugEnabled}
            onChange={(event) =>
              dispatch({
                type: "set-settings",
                settings: { debugEnabled: event.target.checked },
              })
            }
          />
          <span>Debug Enabled</span>
        </label>
        <label className="sidebar-toggle">
          <span>Profile</span>
          <select
            value={settings.performanceProfile}
            onChange={(event) =>
              dispatch({
                type: "set-settings",
                settings: {
                  performanceProfile: event.target
                    .value as typeof settings.performanceProfile,
                },
              })
            }
          >
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="balanced">Balanced</option>
            <option value="high">High</option>
          </select>
        </label>
        {settings.debugEnabled && (
          <>
            <button
              type="button"
              className="sidebar-button"
              onClick={handleSnapshot}
            >
              Snapshot Metrics
            </button>
            <div className="sidebar-meta">
              Interacting: {runtimeStats.isInteracting ? "yes" : "no"}
            </div>
            <div className="sidebar-meta">
              Target Points: {runtimeStats.targetVisiblePoints.toLocaleString()}
            </div>
            <div className="sidebar-meta">
              Desired Nodes: {runtimeStats.desiredNodes}
            </div>
            <div className="sidebar-meta">
              Hierarchy Pages: {runtimeStats.hierarchyPagesLoaded} (in flight{" "}
              {runtimeStats.hierarchyInFlight}, eof{" "}
              {runtimeStats.hierarchyEof ? "yes" : "no"})
            </div>
            <div className="sidebar-meta">
              Retained Nodes: {runtimeStats.retainedNodes}
            </div>
            <div className="sidebar-meta">
              Retained Points: {runtimeStats.retainedPoints.toLocaleString()}
            </div>
            <div className="sidebar-meta">
              Selected Nodes: {runtimeStats.selectedNodes}
            </div>
            <div className="sidebar-meta">
              Visible Points: {runtimeStats.visiblePoints.toLocaleString()}
            </div>
            <div className="sidebar-meta">
              Loaded Tiles: {runtimeStats.loadedTiles}
            </div>
            <div className="sidebar-meta">
              Rendered Tiles: {runtimeStats.renderedTiles}
            </div>
            <div className="sidebar-meta">
              Last Non-Empty Tiles: {runtimeStats.lastNonEmptyTiles}
            </div>
            <div className="sidebar-meta">
              Zero Tile Warnings: {runtimeStats.zeroTileWarnings}
            </div>
            <div className="sidebar-meta">
              Deleted Points: {totalDeletedCount.toLocaleString()}
            </div>
            <div className="sidebar-meta">
              CPU Cache: {runtimeStats.cpuCacheBytes.toLocaleString()} bytes
            </div>
            <div className="sidebar-meta">
              Unique Buffers: {runtimeStats.cacheUniqueBuffers}
            </div>
            <div className="sidebar-meta">
              Pinned Tiles: {runtimeStats.pinnedTiles}
            </div>
            <div className="sidebar-meta">
              Pinned Bytes: {runtimeStats.pinnedBytes.toLocaleString()} bytes
            </div>
            <div className="sidebar-meta">
              Raw Buffers: {runtimeStats.rawBufferRetainedCount}
            </div>
            <div className="sidebar-meta">
              Optional Attrs: {runtimeStats.optionalAttrsDecodedCount}
            </div>
            <div className="sidebar-meta">
              Dropped Raw Buffers: {runtimeStats.rawBufferDroppedOnPressureCount}
            </div>
            <div className="sidebar-meta">
              Dropped Raw Bytes:{" "}
              {runtimeStats.rawBufferBytesDropped.toLocaleString()}
            </div>
            <div className="sidebar-meta">
              Range Windows: {runtimeStats.rangeCache.totalWindows}
            </div>
            <div className="sidebar-meta">
              Range Bytes: {runtimeStats.rangeCache.totalBytes.toLocaleString()} bytes
            </div>
            <div className="sidebar-meta">
              Range Hits/Misses: {runtimeStats.rangeCache.hits}/
              {runtimeStats.rangeCache.misses}
            </div>
            <div className="sidebar-meta">
              Range Evictions: {runtimeStats.rangeCache.evictions}
            </div>
            <div className="sidebar-meta">
              In-Flight: {runtimeStats.inFlightRequests}
            </div>
            <div className="sidebar-meta">
              Queued: {runtimeStats.queuedRequests}
            </div>
            <div className="sidebar-meta">
              Canceled: {runtimeStats.schedulerCanceled}
            </div>
            <div className="sidebar-meta">
              Last Selection:{" "}
              {runtimeStats.lastSelectionUpdateMs !== null
                ? `${runtimeStats.lastSelectionUpdateMs} ms`
                : "n/a"}
            </div>
            <div className="sidebar-meta">
              Last Interaction:{" "}
              {runtimeStats.lastInteractionMs !== null
                ? `${runtimeStats.lastInteractionMs} ms`
                : "n/a"}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
