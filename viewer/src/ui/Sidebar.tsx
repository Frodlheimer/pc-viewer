import { useAppStore } from "../state/store";
import { DATASETS } from "../types/Dataset";

export const Sidebar = () => {
  const { state, dispatch } = useAppStore();
  const { renderData, status, error, hover, selection } = state;

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
    </div>
  );
};
