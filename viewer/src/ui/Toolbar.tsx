import { useAppStore } from "../state/store";
import type { EditMode } from "../state/store";

export const Toolbar = () => {
  const { state, dispatch } = useAppStore();

  return (
    <div className="toolbar">
      <div className="toolbar-title">PointCloud Viewer</div>
      <div className="toolbar-controls">
        <label className="toolbar-toggle">
          <input
            type="checkbox"
            checked={state.showPointCloud}
            onChange={(event) =>
              dispatch({
                type: "set-show-point-cloud",
                value: event.target.checked,
              })
            }
          />
          <span>Point Cloud</span>
        </label>
        <label className="toolbar-toggle">
          <span>Edit Mode</span>
          <select
            className="toolbar-select"
            value={state.editMode}
            onChange={(event) =>
              dispatch({
                type: "set-edit-mode",
                mode: event.target.value as EditMode,
              })
            }
          >
            <option value="none">None</option>
            <option value="add">Add</option>
            <option value="delete">Delete</option>
            <option value="update">Update</option>
            <option value="measure">Measure</option>
            <option value="select">Select</option>
          </select>
        </label>
      </div>
    </div>
  );
};
