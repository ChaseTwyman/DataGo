/**
 * GroundTruth design system. Import from "@/components/ds".
 *
 * Tokens: components/ds/tokens.ts ↔ app/globals.css (CSS variables + Tailwind theme). Utilities:
 * `caps` (condensed uppercase tracked label), `numeral` (large light tabular figure), colour classes
 * bg-card / bg-muted / text-muted-foreground / text-primary / text-success / text-warning /
 * text-destructive / text-info / border (hairline) / border-input.
 *
 * Rules: one accent action per view; amber only for surge and caution; status = icon + colour + word;
 * numbers right-aligned and tabular; timestamps relative with the exact time on hover.
 */
export { AppShell } from "./AppShell";
export { breadcrumbs, relativeLabel } from "./format";
export { CodeBlock, JsonViewer } from "./JsonViewer";
export { Checkbox, Slider, Switch, Tabs } from "./controls";
export { ConfirmDialog, ConfirmProvider, Dialog, useConfirm, type ConfirmOptions } from "./Dialog";
export { MapFrame, MapPanel } from "./MapFrame";
export { Mark, Wordmark } from "./Mark";
export {
  EmptyState,
  ErrorState,
  Eyebrow,
  JobProgress,
  KeyValue,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Readout,
  ReadoutGrid,
  Section,
  Skeleton,
} from "./primitives";
export { ExactTime, RelativeTime } from "./RelativeTime";
export { COLORS, contrast, TEXT_PAIRS } from "./tokens";

export { Badge, TONE_CLASSES } from "../ui/badge";
export { Button, buttonVariants, type ButtonProps } from "../ui/button";
export { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
export { Field, Input, Label, Select, Textarea } from "../ui/form";
export { Table, TBody, TD, TH, THead, TR } from "../ui/table";
export {
  BountyStatusBadge,
  ReasonCode,
  StageStatusBadge,
  SubmissionStatusBadge,
  ToneBadge as StatusPill,
} from "../status";
export { dismissToast, toast, Toaster } from "../Toaster";
