/**
 * Deterministic fallbacks for every Grokbot output. Used when MOCK_GROK is on (they are the mock
 * fixtures), when Grok errors or times out, and when grounding validation leaves nothing. Every line
 * cites case-file facts and uses only numbers that appear in them, so templates pass the same
 * grounding check as model output (asserted in tests).
 */
import { NEUTRAL_INTEGRITY_MESSAGE, stageLabel, type StageStatus } from "@groundtruth/shared";
import { INTEGRITY_STAGES } from "./caseFile";
import type { Audience, CaseFile, Draft, DraftLine } from "./types";

const has = (c: CaseFile, id: string) => c.facts.some((f) => f.id === id);
const factText = (c: CaseFile, id: string) => c.facts.find((f) => f.id === id)?.text ?? "";
const line = (text: string, cites: string[]): DraftLine => ({ text, cites });
const ids = (c: CaseFile, prefix: string) => c.facts.filter((f) => f.id.startsWith(prefix)).map((f) => f.id);

// ---------------------------------------------------------------- narration (phase 1)

/**
 * One speakable line per finished stage. Contributors: integrity stages always read the same
 * whatever their result, and skipped stages read neutrally, so the narration can't reveal which
 * anti-cheating check fired. Researchers get the real status and codes.
 */
export function narrationText(stage: string, status: StageStatus, audience: Audience, codes: string[], label?: string): string {
  const name = stageLabel(stage, label);
  if (audience !== "contributor") {
    return `${name}: ${status}${codes.length ? ` (${codes.join(", ")})` : ""}.`.slice(0, 200);
  }
  if (INTEGRITY_STAGES.has(stage)) {
    const fixed: Record<string, string> = {
      session_integrity: "Capture session checked.",
      challenge: "Movement check finished.",
      authenticity: "Photo check finished.",
      duplicates: "Duplicate check finished.",
    };
    return fixed[stage] ?? `${name} finished.`;
  }
  if (status === "skipped" || status === "waived") return `${name} finished.`;
  if (status === "error") return `${name} needs a person to look. That's okay.`;
  switch (stage) {
    case "relevance":
      return status === "fail" ? "This doesn't look like the scene the bounty asks for." : "The scene matches the bounty.";
    case "protocol":
      return status === "fail" ? "Something the bounty needs is missing from the shot." : status === "warn" ? "Most of the shot looks right." : "Everything the bounty needs is in the shot.";
    case "context":
      return status === "fail" ? "Weather or time of day don't fit this reading." : "Weather and time of day fit.";
    case "corroboration":
      return "Compared with nearby readings.";
    default:
      return `${name} finished.`;
  }
}

// ---------------------------------------------------------------- explain (phase 1)

export function contributorExplainTemplate(c: CaseFile): Draft {
  const status = factText(c, "status");
  if (has(c, "code.neutral")) {
    return {
      headline: line("Not verified", ["status"]),
      paragraphs: [line(NEUTRAL_INTEGRITY_MESSAGE, ["code.neutral"])],
      next_steps: [line("Browse other bounties on the map.", ["status"])],
    };
  }
  if (/accepted/.test(status)) {
    const payout = has(c, "payout") ? factText(c, "payout").replace(/^The payout for this capture is /, "").replace(/\.$/, "") : null;
    const fields = ids(c, "field.");
    return {
      headline: line(payout ? `Accepted: ${payout} added to your wallet` : "Accepted", payout ? ["status", "payout"] : ["status"]),
      paragraphs: [
        line("Your reading passed verification and is now on the map for this bounty.", ["status", "bounty"]),
        ...(fields.length ? [line(fields.map((f) => factText(c, f)).join(" "), fields)] : []),
      ],
      next_steps: [line("Look for another bounty nearby.", ["status"])],
    };
  }
  if (/needs review/.test(status)) {
    return {
      headline: line("A reviewer will take a look", ["status"]),
      paragraphs: [line("Your capture is waiting for a person to confirm it before it is paid. You don't need to do anything.", ["status"])],
      next_steps: [],
    };
  }
  if (/rejected/.test(status)) {
    const codes = ids(c, "code.");
    const paragraphs: DraftLine[] = codes.map((id) => line(factText(c, id), [id]));
    const steps: DraftLine[] = [];
    const elements = ids(c, "element.");
    const missing = codes.filter((id) => id.startsWith("code.MISSING_ELEMENT:")).map((id) => `element.${id.slice("code.MISSING_ELEMENT:".length)}`);
    for (const el of missing.filter((e) => has(c, e))) {
      steps.push(line(`Get this in the frame: ${factText(c, el).replace(/^Required in the shot: /, "")}`, [el]));
    }
    if (codes.includes("code.OFF_TOPIC") && elements.length) {
      paragraphs.push(line(`The bounty needs: ${elements.map((e) => factText(c, e).replace(/^Required in the shot: /, "")).join("; ")}`, elements));
      steps.push(line("Point the camera at the scene in the briefing and try again.", ["code.OFF_TOPIC", ...elements]));
    }
    if (has(c, "protocol.tips") && codes.some((id) => /BLURRY|TOO_DARK|BAD_FRAMING|LOW_CONFIDENCE|EXTRACTION_MISSING|MISSING_ELEMENT/.test(id))) {
      steps.push(line(factText(c, "protocol.tips"), ["protocol.tips"]));
    }
    if (paragraphs.length === 0) paragraphs.push(line("The capture didn't meet what this bounty asks for.", ["status", ...(has(c, "protocol") ? ["protocol"] : [])]));
    steps.push(line("If your capture session is still open, you can try again.", ["status"]));
    return { headline: line("Let's fix the shot", ["status"]), paragraphs, next_steps: steps.slice(0, 5) };
  }
  return {
    headline: line("Still verifying", ["status"]),
    paragraphs: [line("The checks are still running. This page updates when they finish.", ["status"])],
    next_steps: [],
  };
}

/** Manual checks a reviewer can do, per reason code (shared by explain and the review brief). */
export const MANUAL_CHECKS: Record<string, string> = {
  GATE_NOT_PASSED: "The live framing gate never passed: look closely for a screen, print, or re-photographed image.",
  GATE_DEGRADED: "The phone ran its gate in limited mode: check the frames for a screen or print.",
  STAGE_ERROR: "A stage errored and was not judged: review that stage's evidence yourself.",
  EXTRACTION_IMPLAUSIBLE: "Re-read the measurement against the reference object in the photos.",
  EXTRACTION_LOW_CONFIDENCE: "The model was unsure of the reading: estimate it yourself from the reference object.",
  LOW_TRUST_REVIEW: "Compare this capture with the contributor's earlier accepted captures.",
  VELOCITY_LIMIT: "Many captures in this cell in a short time: check they show different moments.",
  IMPOSSIBLE_TRAVEL: "Check the capture time and place against the contributor's previous capture.",
  LOW_CONFIDENCE: "Scores were borderline: check each required element is clearly visible.",
  WEATHER_IMPLAUSIBLE: "Check the scene against recent weather at the location.",
  DAYLIGHT_MISMATCH: "Check the lighting in the photos against the capture time.",
  BUDGET_EXHAUSTED: "The request's allocation ran out: payment needs an admin decision on funding.",
};

export function researcherExplainTemplate(c: CaseFile): Draft {
  const stages = ids(c, "stage.");
  const notable = stages.filter((id) => /: (fail|warn|error)[;.]/.test(factText(c, id)));
  const codes = ids(c, "code.");
  const paragraphs: DraftLine[] = [];
  if (notable.length) paragraphs.push(line(notable.map((id) => factText(c, id).split(". Evidence:")[0]).join(" "), notable));
  else if (stages.length) paragraphs.push(line("Every completed stage passed.", stages));
  const scores = ["confidence", "protocol_score", "authenticity_score"].filter((id) => has(c, id));
  if (scores.length) paragraphs.push(line(scores.map((id) => factText(c, id)).join(" "), scores));
  if (paragraphs.length === 0) paragraphs.push(line(factText(c, "status"), ["status"]));
  const steps: DraftLine[] = [];
  for (const id of codes) {
    const code = id.slice("code.".length);
    const check = MANUAL_CHECKS[code];
    if (check) steps.push(line(check, [id]));
  }
  if (/needs review/.test(factText(c, "status"))) steps.push(line("Open it in the review queue to decide.", ["status"]));
  return {
    headline: line(factText(c, "status").replace(/^This capture's status is /, "Status: ").replace(/\.$/, ""), ["status"]),
    paragraphs: paragraphs.slice(0, 4),
    next_steps: steps.slice(0, 4),
  };
}

// ---------------------------------------------------------------- price why (phase 3)

export function priceWhyTemplate(c: CaseFile): Draft {
  const reasons = ids(c, "price.reason.");
  const paragraphs: DraftLine[] = [line(factText(c, "price.current"), ["price.current"])];
  if (reasons.length) {
    paragraphs.push(line(`What moves it here: ${reasons.map((r) => factText(c, r).replace(/^Price note: /, "").replace(/\.$/, "")).join("; ")}.`, reasons));
  }
  if (has(c, "price.range")) paragraphs.push(line(factText(c, "price.range"), ["price.range"]));
  if (has(c, "price.paused")) paragraphs.push(line(factText(c, "price.paused"), ["price.paused"]));
  return {
    headline: line("Why this price", ["price.current"]),
    paragraphs,
    next_steps: has(c, "price.lock") ? [line(factText(c, "price.lock"), ["price.lock"])] : [],
  };
}

// ---------------------------------------------------------------- request status (phase 4)

export function statusTemplate(c: CaseFile): Draft {
  const st = factText(c, "bounty.status");
  const paragraphs: DraftLine[] = [line(st, ["bounty.status"])];
  const steps: DraftLine[] = [];
  const add = (id: string) => has(c, id) && paragraphs.push(line(factText(c, id), [id]));
  if (/pending funding/.test(st)) {
    add("bounty.funding_reason");
    add("bounty.need");
    add("pool.general");
    if (/Waiting for an admin/.test(factText(c, "bounty.funding_reason"))) {
      steps.push(line("Close a finished request to free a slot, or ask an admin to approve this one.", ["bounty.funding_reason"]));
    } else {
      steps.push(line("A sponsor earmark for this region or protocol would fund it first.", ["bounty.funding_reason"]));
      if (has(c, "bounty.need")) {
        steps.push(line("A smaller area or a lower target per cell lowers what it needs.", ["bounty.need"]));
      }
      steps.push(line("An admin can approve it manually from the Funding page.", ["bounty.status"]));
    }
  } else if (/active/.test(st)) {
    add("bounty.allocation");
    add("bounty.pace");
    add("bounty.coverage");
    add("bounty.paused_cells");
    const pace = factText(c, "bounty.pace");
    if (/ahead/.test(pace)) steps.push(line("Spending is ahead of schedule, so prices are paced down to make the allocation last.", ["bounty.pace"]));
    else if (/behind/.test(pace)) steps.push(line("Collection is behind schedule: a briefing video or a longer window may help.", ["bounty.pace"]));
    if (has(c, "bounty.paused_cells")) steps.push(line("Paused cells reopen on their own when the hazard warning ends.", ["bounty.paused_cells"]));
  } else if (/paused/.test(st)) {
    add("bounty.allocation");
    steps.push(line("Contributors can't start captures while it is paused. Resume it from the dashboard when ready.", ["bounty.status"]));
  } else if (/closed/.test(st)) {
    add("bounty.allocation");
    steps.push(line("Unspent allocation goes back to the sponsor pool. Submit a new request to collect more.", ["bounty.status"]));
  } else {
    add("bounty.allocation");
  }
  add("bounty.window");
  return { headline: line(st.replace(/^This request is /, "Request: ").replace(/\.$/, ""), ["bounty.status"]), paragraphs: paragraphs.slice(0, 6), next_steps: steps.slice(0, 5) };
}

// ---------------------------------------------------------------- sponsor impact (phase 5)

export function impactTemplate(c: CaseFile): Draft {
  const body = ["impact.contributed", "impact.spent", "impact.observations", "impact.cells", "impact.requests"].filter((id) => has(c, id));
  const top = ids(c, "impact.protocol.");
  return {
    headline: line(factText(c, "impact.sponsor").replace(/\.$/, ""), ["impact.sponsor"]),
    paragraphs: [
      line(body.map((id) => factText(c, id)).join(" "), body.length ? body : ["impact.sponsor"]),
      ...(top.length ? [line(top.map((id) => factText(c, id)).join(" "), top)] : []),
    ],
    next_steps: [],
  };
}
