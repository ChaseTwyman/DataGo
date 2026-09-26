/**
 * Grokbot core types. A CASE FILE is the only thing the agent ever sees: a role-scoped list of facts
 * (each with a stable id and the citation it maps to) plus untrusted contributor text kept apart
 * from the facts. Everything the agent writes must cite fact ids; see compose.ts `groundDraft`.
 */
import type { GrokbotCitation } from "@groundtruth/shared";

/** Who the text is for. Decides which facts a case file may contain. Never a user id. */
export type Audience = "contributor" | "researcher" | "admin" | "public";

export interface Fact {
  /** Stable, short id the model cites, e.g. "stage.relevance", "code.OFF_TOPIC", "price.reason.0". */
  id: string;
  citation: GrokbotCitation;
  /** One plain sentence stating the fact. The only source of numbers the output may use. */
  text: string;
}

/** Text written by a member of the public (field notes, OCR'd/extracted notes, profile fields). */
export interface UntrustedText {
  source: string;
  text: string;
  /** Looked like instructions to an AI: withheld from prompts, surfaced to reviewers. */
  flagged: boolean;
}

export interface CaseFile {
  /** Cache namespace, e.g. "explain", "price_why". */
  kind: string;
  subjectId: string;
  audience: Audience;
  facts: Fact[];
  untrusted: UntrustedText[];
  /** Human-readable injection flags (ReviewBrief.injection_flags). */
  injectionFlags: string[];
}

/** One line the agent (or a template) wrote, with the fact ids it rests on. */
export interface DraftLine {
  text: string;
  cites: string[];
}

export interface Draft {
  headline: DraftLine;
  paragraphs: DraftLine[];
  next_steps: DraftLine[];
}
