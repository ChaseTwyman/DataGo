import type {
  Challenge,
  DeviceInfo,
  FieldNotes,
  GateInfo,
  GeoJSONPolygon,
  MockVariant,
  Protocol,
  ReasonCode,
  SensorSnapshot,
  StageId,
  StageResult,
  StageStatus,
  Subcheck,
  VerificationOutput,
} from "@groundtruth/shared";
import type { NwsAlert } from "../context/nws";
import type { SessionRow } from "../db/repos/sessions";

export type PipelineSource = "live" | "redteam" | "eval";

export interface PipelineFrame {
  path: string;
  /** null when the upload is missing or was deliberately not loaded (synthetic path in live mode). */
  bytes: Buffer | null;
}

export interface PipelineBounty {
  id: string;
  cells: string[];
  area: GeoJSONPolygon | null;
  starts_at: string;
  ends_at: string;
}

export interface PipelineInput {
  source: PipelineSource;
  submissionId: string | null;
  userId: string | null;
  frames: PipelineFrame[];
  lat: number;
  lng: number;
  accuracy_m: number | null;
  captured_at: string;
  received_at: string;
  nonce: string | null;
  device: Partial<DeviceInfo>;
  sensors: Partial<SensorSnapshot>;
  gate: Partial<GateInfo>;
  field_notes: FieldNotes;
  h3_cell: string;
  bounty: PipelineBounty;
  protocol: Protocol;
  session: SessionRow | null;
  challenge: Challenge;
  trustScore: number;
  mockVariant?: MockVariant;
}

/** Everything external the pipeline touches, injectable for tests. */
export interface PipelineDeps {
  now(): Date;
  demoMode: boolean;
  offline: boolean;
  verify(args: {
    protocol: Protocol;
    challenge: Challenge;
    framesBase64: string[];
    intervalMs: number;
    variant?: MockVariant;
  }): Promise<VerificationOutput>;
  precipitationMm(lat: number, lng: number, at: Date, lookbackHours: number): Promise<number>;
  alertsAt(lat: number, lng: number): Promise<NwsAlert[]>;
  priorHashes(excludeId: string | null): Promise<{ id: string; phashes: string[] }[]>;
  countUserCellSince(userId: string, cell: string, sinceIso: string, excludeId: string | null): Promise<number>;
  previousUserSubmission(userId: string, beforeIso: string, excludeId: string | null): Promise<{ lat: number; lng: number; captured_at: string } | null>;
  acceptedNear(
    bountyId: string,
    atIso: string,
    windowMin: number,
    excludeId: string | null,
  ): Promise<{ id: string; lat: number; lng: number; extracted: Record<string, unknown> | null }[]>;
}

/** Receives the full checks array after every stage transition (live: DB row; redteam: memory). */
export interface StageSink {
  write(checks: StageResult[]): Promise<void>;
}

/** What a stage returns; the runner adds stage id, label, and ms. */
export interface StageOutcome {
  status: StageStatus;
  score: number | null;
  reasonCodes: ReasonCode[];
  evidence: string[];
  subchecks?: Subcheck[];
}

export interface StageContext {
  input: PipelineInput;
  deps: PipelineDeps;
  /** Memoised: one reasoning-vision call shared by challenge/protocol/authenticity (+ context daylight). */
  model(): Promise<VerificationOutput>;
  /** Memoised dHash of every loaded frame, in frame order. */
  hashes(): Promise<string[]>;
}

export type Stage = { id: StageId; run(ctx: StageContext): Promise<StageOutcome> };
