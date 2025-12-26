import type {
  AttributeRole,
  DatasetAttribute,
  DatasetCrs,
  DatasetManifest,
  DatasetRoles,
  BoundsQuantization,
  LevelManifest,
} from "../types/Dataset";
import type { Bounds } from "../types/Tile";
import type { Vec3 } from "../types/Point";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => isFiniteNumber(entry));

const isBounds = (value: unknown): value is Bounds =>
  Array.isArray(value) &&
  value.length === 6 &&
  value.every((entry) => isFiniteNumber(entry));

const isAttributeRole = (value: unknown): value is AttributeRole =>
  value === "position" ||
  value === "color" ||
  value === "intensity" ||
  value === "classification" ||
  value === "custom";

const normalizeCrs = (value: unknown): DatasetCrs => {
  if (!isObject(value)) {
    return {};
  }
  const crs: DatasetCrs = {};
  if (isFiniteNumber(value.epsg)) {
    crs.epsg = value.epsg;
  }
  if (typeof value.wkt === "string") {
    crs.wkt = value.wkt;
  }
  return crs;
};

const normalizeRoles = (value: unknown): DatasetRoles => {
  if (!isObject(value)) {
    return { position: "position" };
  }
  const position =
    typeof value.position === "string" && value.position.trim().length > 0
      ? value.position
      : "position";
  const color =
    typeof value.color === "string" && value.color.trim().length > 0
      ? value.color
      : undefined;
  return color ? { position, color } : { position };
};

const normalizeBoundsQuantization = (value: unknown): BoundsQuantization => {
  if (isObject(value) && isVec3(value.origin) && isVec3(value.scale)) {
    return { origin: value.origin, scale: value.scale };
  }
  return { origin: [0, 0, 0], scale: [1, 1, 1] };
};

const normalizeAttributes = (
  value: unknown,
  roles: DatasetRoles
): DatasetAttribute[] => {
  const attributes: DatasetAttribute[] = [];

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!isObject(entry)) {
        return;
      }
      const name = typeof entry.name === "string" ? entry.name : null;
      const type = typeof entry.type === "string" ? entry.type : null;
      const components = isFiniteNumber(entry.components)
        ? entry.components
        : null;
      if (!name || !type || components === null) {
        return;
      }
      const role = isAttributeRole(entry.role) ? entry.role : undefined;
      attributes.push({ name, type, components, role });
    });
  }

  if (attributes.length === 0) {
    attributes.push({
      name: roles.position,
      type: "float32",
      components: 3,
      role: "position",
    });
    if (roles.color) {
      attributes.push({
        name: roles.color,
        type: "uint8",
        components: 3,
        role: "color",
      });
    }
  }

  return attributes;
};

const normalizeManifest = (value: Record<string, unknown>): DatasetManifest => {
  const bounds = isBounds(value.bounds) ? value.bounds : null;
  if (!bounds) {
    throw new Error("Manifest bounds missing.");
  }

  const schemaVersion = isFiniteNumber(value.schemaVersion)
    ? value.schemaVersion
    : 0.2;
  const roles = normalizeRoles(value.roles);
  if (!roles.position) {
    throw new Error("Manifest roles.position missing.");
  }

  const id = typeof value.id === "string" ? value.id : "unknown";
  const name = typeof value.name === "string" ? value.name : id;
  const units = typeof value.units === "string" ? value.units : "unknown";
  const crs = normalizeCrs(value.crs);
  const attributes = normalizeAttributes(value.attributes, roles);
  const boundsQuantization = normalizeBoundsQuantization(
    value.boundsQuantization
  );
  const levels = Array.isArray(value.levels)
    ? (value.levels as LevelManifest[])
    : [];

  return {
    schemaVersion,
    id,
    name,
    crs,
    units,
    attributes,
    roles,
    boundsQuantization,
    levels,
    bounds,
  };
};

export const loadManifest = async (url: string): Promise<DatasetManifest> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Manifest load failed (${response.status})`);
  }
  const json = (await response.json()) as unknown;
  if (!isObject(json)) {
    throw new Error("Manifest format invalid.");
  }
  return normalizeManifest(json);
};
