import floodJson from "./street-flood-depth.json";
import { ProtocolSchema, type Protocol } from "./protocol";

export * from "./protocol";

export const streetFloodDepth: Protocol = ProtocolSchema.parse(floodJson);

export const BUILTIN_PROTOCOLS: Record<string, Protocol> = {
  [streetFloodDepth.slug]: streetFloodDepth,
};
