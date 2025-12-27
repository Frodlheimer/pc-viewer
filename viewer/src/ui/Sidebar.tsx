import { useAppStore } from "../state/store";
import { DATASETS } from "../types/Dataset";

export const Sidebar = () => {
  const { state, dispatch } = useAppStore();
  const { renderData, status, error, hover, selection, settings, runtimeStats } =
    state;
  const addedCount = Math.floor(
    state.patches.addedPoints.positions.length / 3
  );

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
          </>
        ) : (
          <div className="sidebar-meta">None</div>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Selection</div>
        {selection ? (
          <>
            <div className="sidebar-meta">Tile: {selection.tileId}</div>
            <div className="sidebar-meta">
              Index: {selection.indexWithinTile}
            </div>
            <div className="sidebar-meta">
              Pos:{" "}
              {selection.worldPosition.map((value) => value.toFixed(2)).join(", ")}
            </div>
            {selection.nodeId !== undefined && (
              <div className="sidebar-meta">
                Node: {selection.nodeId.toString()}
              </div>
            )}
          </>
        ) : (
          <div className="sidebar-meta">None</div>
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
            <div className="sidebar-meta">
              Interacting: {runtimeStats.isInteracting ? "yes" : "no"}
            </div>
            <div className="sidebar-meta">
              Target Points: {runtimeStats.targetVisiblePoints.toLocaleString()}
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
              CPU Cache: {runtimeStats.cpuCacheBytes.toLocaleString()} bytes
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
              Last Selection:{" "}
              {runtimeStats.lastSelectionUpdateMs !== null
                ? `${runtimeStats.lastSelectionUpdateMs} ms`
                : "n/a"}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
