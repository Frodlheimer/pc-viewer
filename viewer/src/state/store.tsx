/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Bounds, RenderData } from "../types/Tile";
import type { Vec3 } from "../types/Point";
import { getBoundsCenter } from "../utils/bounds";

export type ViewState = {
  target: Vec3;
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
};

export type HoverInfo = {
  screen: { x: number; y: number };
  tileId: string;
  nodeId?: bigint | number;
  indexWithinTile: number;
  worldPosition: Vec3;
  color?: Vec3;
};

export type SelectionInfo = {
  tileId: string;
  nodeId?: bigint | number;
  indexWithinTile: number;
  worldPosition: Vec3;
  color?: Vec3;
};

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type AppState = {
  viewState: ViewState;
  viewStateDatasetId: string | null;
  hover: HoverInfo | null;
  selection: SelectionInfo | null;
  activeDatasetId: string;
  renderData: RenderData | null;
  status: LoadStatus;
  error: string | null;
  showPointCloud: boolean;
};

type AppAction =
  | { type: "set-view-state"; viewState: ViewState }
  | { type: "initialize-view-state"; datasetId: string; bounds: Bounds }
  | { type: "set-hover"; hover: HoverInfo | null }
  | { type: "set-selection"; selection: SelectionInfo | null }
  | { type: "set-active-dataset"; datasetId: string }
  | { type: "set-render-data"; renderData: RenderData | null }
  | { type: "set-status"; status: LoadStatus; error?: string | null }
  | { type: "set-show-point-cloud"; value: boolean };

const initialState: AppState = {
  viewState: {
    target: [0, 0, 0],
    zoom: 0,
    rotationX: 30,
    rotationOrbit: 30,
  },
  viewStateDatasetId: null,
  hover: null,
  selection: null,
  activeDatasetId: "demo",
  renderData: null,
  status: "idle",
  error: null,
  showPointCloud: true,
};

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "set-view-state":
      return { ...state, viewState: action.viewState };
    case "initialize-view-state": {
      if (state.viewStateDatasetId === action.datasetId) {
        return state;
      }
      const target = getBoundsCenter(action.bounds);
      return {
        ...state,
        viewStateDatasetId: action.datasetId,
        viewState: {
          target,
          zoom: 0,
          rotationX: 30,
          rotationOrbit: 30,
        },
      };
    }
    case "set-hover":
      return { ...state, hover: action.hover };
    case "set-selection":
      return { ...state, selection: action.selection };
    case "set-active-dataset":
      return { ...state, activeDatasetId: action.datasetId };
    case "set-render-data":
      return { ...state, renderData: action.renderData };
    case "set-status":
      return { ...state, status: action.status, error: action.error ?? null };
    case "set-show-point-cloud":
      return { ...state, showPointCloud: action.value };
    default:
      return state;
  }
};

type AppStore = {
  state: AppState;
  dispatch: Dispatch<AppAction>;
};

const AppStateContext = createContext<AppStore | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const store = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <AppStateContext.Provider value={store}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppStore = () => {
  const store = useContext(AppStateContext);
  if (!store) {
    throw new Error("AppStateContext is missing.");
  }
  return store;
};
