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
import type { TypedArray } from "../types/Pct2";
import type { PerformanceProfile } from "../config/budgets";
import { getBoundsCenter } from "../utils/bounds";

export type ViewState = {
  target: Vec3;
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
};

export type EditMode =
  | "none"
  | "add"
  | "delete"
  | "update"
  | "measure"
  | "select";

export type AddedPointsPatch = {
  positions: Float32Array;
  colors?: Uint8Array;
  attributes?: Record<string, TypedArray>;
};

export type PatchState = {
  addedPoints: AddedPointsPatch;
  deleted: Map<string, Float32Array>;
  deletedVersions: Map<string, number>;
  updatedAttributes: Map<string, Map<number, Record<string, number>>>;
};

export type RuntimeStats = {
  desiredNodes: number;
  selectedNodes: number;
  retainedNodes: number;
  retainedPoints: number;
  visiblePoints: number;
  loadedTiles: number;
  renderedTiles: number;
  lastNonEmptyTiles: number;
  zeroTileWarnings: number;
  cpuCacheBytes: number;
  cacheUniqueBuffers: number;
  pinnedTiles: number;
  pinnedBytes: number;
  inFlightRequests: number;
  queuedRequests: number;
  schedulerCanceled: number;
  rawBufferRetainedCount: number;
  optionalAttrsDecodedCount: number;
  rawBufferDroppedOnPressureCount: number;
  rawBufferBytesDropped: number;
  lastSelectionUpdateMs: number | null;
  lastInteractionMs: number | null;
  isInteracting: boolean;
  targetVisiblePoints: number;
  hierarchyPagesLoaded: number;
  hierarchyInFlight: number;
  hierarchyEof: boolean;
  rangeCache: {
    totalBytes: number;
    totalWindows: number;
    hits: number;
    misses: number;
    evictions: number;
  };
};

export type AppSettings = {
  performanceProfile: PerformanceProfile;
  debugEnabled: boolean;
};

export type HoverInfo = {
  screen: { x: number; y: number };
  tileId: string;
  nodeId?: bigint | number;
  indexWithinTile: number;
  worldPosition: Vec3;
  color?: Vec3;
};

export type SelectionItem = {
  nodeId: string;
  index: number;
  worldPos: Vec3;
  tileKey?: string;
};

export type SelectionState = {
  items: SelectionItem[];
};

export type MeasurementState = {
  a?: SelectionItem;
  b?: SelectionItem;
  distance?: number;
};

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type AppState = {
  viewState: ViewState;
  viewStateDatasetId: string | null;
  editMode: EditMode;
  patches: PatchState;
  deleteSelectionRequestId: number;
  settings: AppSettings;
  runtimeStats: RuntimeStats;
  hover: HoverInfo | null;
  selection: SelectionState;
  measurement: MeasurementState;
  activeDatasetId: string;
  renderData: RenderData | null;
  status: LoadStatus;
  error: string | null;
  showPointCloud: boolean;
};

type AppAction =
  | { type: "set-view-state"; viewState: ViewState }
  | { type: "initialize-view-state"; datasetId: string; bounds: Bounds }
  | { type: "set-edit-mode"; mode: EditMode }
  | {
      type: "set-deleted-masks";
      deleted: Map<string, Float32Array>;
      deletedVersions: Map<string, number>;
    }
  | { type: "request-delete-selection" }
  | { type: "set-settings"; settings: Partial<AppSettings> }
  | { type: "set-runtime-stats"; stats: Partial<RuntimeStats> }
  | { type: "set-hover"; hover: HoverInfo | null }
  | { type: "set-selection"; selection: SelectionState }
  | { type: "set-measurement"; measurement: MeasurementState }
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
  editMode: "none",
  patches: {
    addedPoints: {
      positions: new Float32Array(0),
    },
    deleted: new Map(),
    deletedVersions: new Map(),
    updatedAttributes: new Map(),
  },
  deleteSelectionRequestId: 0,
  settings: {
    performanceProfile: "auto",
    debugEnabled: false,
  },
  runtimeStats: {
    desiredNodes: 0,
    selectedNodes: 0,
    retainedNodes: 0,
    retainedPoints: 0,
    visiblePoints: 0,
    loadedTiles: 0,
    renderedTiles: 0,
    lastNonEmptyTiles: 0,
    zeroTileWarnings: 0,
    cpuCacheBytes: 0,
    cacheUniqueBuffers: 0,
    pinnedTiles: 0,
    pinnedBytes: 0,
    inFlightRequests: 0,
    queuedRequests: 0,
    schedulerCanceled: 0,
    rawBufferRetainedCount: 0,
    optionalAttrsDecodedCount: 0,
    rawBufferDroppedOnPressureCount: 0,
    rawBufferBytesDropped: 0,
    lastSelectionUpdateMs: null,
    lastInteractionMs: null,
    isInteracting: false,
    targetVisiblePoints: 0,
    hierarchyPagesLoaded: 0,
    hierarchyInFlight: 0,
    hierarchyEof: false,
    rangeCache: {
      totalBytes: 0,
      totalWindows: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
    },
  },
  hover: null,
  selection: { items: [] },
  measurement: {},
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
    case "set-edit-mode":
      return { ...state, editMode: action.mode };
    case "set-deleted-masks":
      return {
        ...state,
        patches: {
          ...state.patches,
          deleted: action.deleted,
          deletedVersions: action.deletedVersions,
        },
      };
    case "request-delete-selection":
      return {
        ...state,
        deleteSelectionRequestId: state.deleteSelectionRequestId + 1,
      };
    case "set-settings":
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
      };
    case "set-runtime-stats":
      return {
        ...state,
        runtimeStats: { ...state.runtimeStats, ...action.stats },
      };
    case "set-hover":
      return { ...state, hover: action.hover };
    case "set-selection":
      return { ...state, selection: action.selection };
    case "set-measurement":
      return { ...state, measurement: action.measurement };
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
