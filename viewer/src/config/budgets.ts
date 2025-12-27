export const TILE_POINT_CAP = 150_000;
// Upper limit for points per tile to avoid oversized decodes.

export const MAX_VISIBLE_POINTS_DEFAULT = 10_000_000;
// Hard ceiling for total visible points across all tiles.

export const TARGET_VISIBLE_POINTS_DEFAULT = 6_000_000;
// Soft target for node selection (aim below the max for stability).

export const TARGET_VISIBLE_POINTS_INTERACT_DEFAULT = 2_000_000;
// Lower selection target while interacting to keep FPS responsive.

export const CPU_TILE_CACHE_BUDGET_BYTES_DEFAULT = 2.5 * 1024 ** 3;
// Budget for decoded tile data kept in CPU memory.

export const GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT = 1.0 * 1024 ** 3;
// Budget for GPU-resident point buffers.

export const MAX_CONCURRENT_TILE_REQUESTS = 6;
// Cap concurrent tile fetches to avoid request floods.

export const VIEWSTATE_DEBOUNCE_MS = 150;
// Debounce window for view-driven selection updates.

export const INTERACTION_IDLE_MS = 350;
// Time to wait after interaction before returning to full quality.

export const MIN_RETAINED_POINTS_INTERACT_DEFAULT = 500_000;
// Minimum retained points while interacting to avoid blackouts.

export const MIN_IDLE_STABLE_MS_DEFAULT = 250;
// Idle duration before pruning retained tiles.

export const LOD_HYSTERESIS_FACTOR = 1.25;
// Hysteresis factor to avoid LOD thrashing when zooming.

export type PerformanceProfile = "auto" | "low" | "balanced" | "high";

export type RuntimeBudgets = {
  tilePointCap: number;
  maxVisiblePoints: number;
  targetVisiblePoints: number;
  targetVisiblePointsInteract: number;
  minRetainedPointsInteract: number;
  cpuCacheBudgetBytes: number;
  gpuCacheBudgetBytes: number;
  maxConcurrentRequests: number;
  viewDebounceMs: number;
  interactionIdleMs: number;
  minIdleStableMs: number;
  lodHysteresisFactor: number;
  profile: Exclude<PerformanceProfile, "auto">;
};

const PROFILE_MULTIPLIER: Record<
  Exclude<PerformanceProfile, "auto">,
  { scale: number; viewDebounceMs: number }
> = {
  low: { scale: 0.5, viewDebounceMs: 220 },
  balanced: { scale: 1, viewDebounceMs: VIEWSTATE_DEBOUNCE_MS },
  high: { scale: 1.6, viewDebounceMs: 120 },
};

const clampToDefault = (value: number, base: number) =>
  Math.min(base * 2, Math.max(base * 0.25, value));

const MIN_RETAINED_POINTS_BY_PROFILE: Record<
  Exclude<PerformanceProfile, "auto">,
  number
> = {
  low: 300_000,
  balanced: MIN_RETAINED_POINTS_INTERACT_DEFAULT,
  high: 800_000,
};

const resolveProfile = (profile: PerformanceProfile): Exclude<PerformanceProfile, "auto"> => {
  if (profile !== "auto") {
    return profile;
  }
  if (typeof navigator === "undefined") {
    return "balanced";
  }
  const memory =
    "deviceMemory" in navigator
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;
  if (!memory) {
    return "balanced";
  }
  if (memory <= 4) {
    return "low";
  }
  if (memory >= 16) {
    return "high";
  }
  if (memory >= 8) {
    return "balanced";
  }
  return "low";
};

export const getRuntimeBudgets = (
  profile: PerformanceProfile
): RuntimeBudgets => {
  const resolvedProfile = resolveProfile(profile);
  const { scale, viewDebounceMs } = PROFILE_MULTIPLIER[resolvedProfile];

  const maxVisiblePoints = Math.round(
    clampToDefault(MAX_VISIBLE_POINTS_DEFAULT * scale, MAX_VISIBLE_POINTS_DEFAULT)
  );
  const targetVisiblePoints = Math.round(
    clampToDefault(
      TARGET_VISIBLE_POINTS_DEFAULT * scale,
      TARGET_VISIBLE_POINTS_DEFAULT
    )
  );
  const targetVisiblePointsInteract = Math.round(
    clampToDefault(
      TARGET_VISIBLE_POINTS_INTERACT_DEFAULT * scale,
      TARGET_VISIBLE_POINTS_INTERACT_DEFAULT
    )
  );
  const minRetainedPointsInteract = Math.round(
    clampToDefault(
      MIN_RETAINED_POINTS_BY_PROFILE[resolvedProfile],
      MIN_RETAINED_POINTS_INTERACT_DEFAULT
    )
  );

  return {
    profile: resolvedProfile,
    tilePointCap: TILE_POINT_CAP,
    maxVisiblePoints,
    targetVisiblePoints: Math.min(targetVisiblePoints, maxVisiblePoints),
    targetVisiblePointsInteract: Math.min(
      targetVisiblePointsInteract,
      maxVisiblePoints
    ),
    minRetainedPointsInteract,
    cpuCacheBudgetBytes: clampToDefault(
      CPU_TILE_CACHE_BUDGET_BYTES_DEFAULT * scale,
      CPU_TILE_CACHE_BUDGET_BYTES_DEFAULT
    ),
    gpuCacheBudgetBytes: clampToDefault(
      GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT * scale,
      GPU_TILE_CACHE_BUDGET_BYTES_DEFAULT
    ),
    maxConcurrentRequests: Math.max(
      1,
      Math.round(
        clampToDefault(
          MAX_CONCURRENT_TILE_REQUESTS * scale,
          MAX_CONCURRENT_TILE_REQUESTS
        )
      )
    ),
    viewDebounceMs: Math.round(
      clampToDefault(viewDebounceMs, VIEWSTATE_DEBOUNCE_MS)
    ),
    interactionIdleMs: INTERACTION_IDLE_MS,
    minIdleStableMs: MIN_IDLE_STABLE_MS_DEFAULT,
    lodHysteresisFactor: LOD_HYSTERESIS_FACTOR,
  };
};
