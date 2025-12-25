import { useAppStore } from "../state/store";

export const Toolbar = () => {
  const { state, dispatch } = useAppStore();

  return (
    <div className="toolbar">
      <div className="toolbar-title">PointCloud Viewer</div>
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
    </div>
  );
};
