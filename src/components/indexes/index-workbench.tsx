"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ScoreComponent } from "@/contracts/scores";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorText, postJson } from "@/lib/client-fetch";
import {
  customComponentsSchema,
  MAX_ACTIVE_CUSTOM_DEFINITIONS,
  MAX_CUSTOM_COMPONENTS,
} from "@/lib/custom-index";
import type {
  AggregationOption,
  MetricOption,
} from "@/lib/custom-index-catalog";
import type {
  CustomIndexPreviewResponse,
  CustomIndexResult,
  CustomIndexView,
} from "@/lib/custom-index-impl";

// The full builder (Team-paid admins only — the page gates entry). Client-side
// state over the SAME frozen `customComponentsSchema` the API validates with,
// so weight-sum-to-1 feedback and per-component validation are instant and can
// never disagree with what the server accepts. Preview and publish both POST
// to /api/indexes*. UI over data — never a formula editor (tripwire).

type ComponentKind = "metric" | "ratio";

type DraftComponent = {
  uid: string;
  key: string;
  kind: ComponentKind;
  metric: string;
  aggregation: string;
  numMetric: string;
  numAggregation: string;
  denMetric: string;
  denAggregation: string;
  weight: string;
  min: string;
  max: string;
};

// The preview wire type is the server's own response type (imported, not
// hand-mirrored) so a shape change there is a compile error here, never a
// silent undefined at render time.
type PreviewResponse = CustomIndexPreviewResponse;

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `c${uidCounter}`;
}

function newComponent(defaults?: Partial<DraftComponent>): DraftComponent {
  return {
    uid: nextUid(),
    key: "",
    kind: "metric",
    metric: "active_day",
    aggregation: "active_days",
    numMetric: "suggestions_accepted",
    numAggregation: "sum",
    denMetric: "suggestions_offered",
    denAggregation: "sum",
    weight: "1",
    min: "0",
    max: "20",
    ...defaults,
  };
}

/** Turns an existing published component into an editable draft row. */
function draftFromComponent(component: ScoreComponent): DraftComponent {
  const base = {
    uid: nextUid(),
    key: component.key,
    weight: String(component.weight),
    min: String(component.normalization.min),
    max: String(component.normalization.max),
  };
  if ("ratio" in component) {
    return {
      ...newComponent(),
      ...base,
      kind: "ratio",
      numMetric: component.ratio.numerator.metric,
      numAggregation: component.ratio.numerator.aggregation,
      denMetric: component.ratio.denominator.metric,
      denAggregation: component.ratio.denominator.aggregation,
    };
  }
  return {
    ...newComponent(),
    ...base,
    kind: "metric",
    metric: component.metric,
    aggregation: component.aggregation,
  };
}

/** Best-effort conversion of the draft rows into engine components. Returns
 * the array as-is (unknown numeric validity) — the caller runs it through the
 * frozen schema for the authoritative verdict. */
function toCandidate(components: DraftComponent[]): unknown[] {
  return components.map((c) => {
    const normalization = { min: Number(c.min), max: Number(c.max) };
    const weight = Number(c.weight);
    if (c.kind === "ratio") {
      return {
        key: c.key,
        weight,
        normalization,
        ratio: {
          numerator: { metric: c.numMetric, aggregation: c.numAggregation },
          denominator: { metric: c.denMetric, aggregation: c.denAggregation },
        },
      };
    }
    return {
      key: c.key,
      weight,
      normalization,
      metric: c.metric,
      aggregation: c.aggregation,
    };
  });
}

export function IndexWorkbench({
  indexes,
  results,
  metrics,
  aggregations,
}: {
  indexes: CustomIndexView[];
  results: Record<string, CustomIndexResult>;
  metrics: MetricOption[];
  aggregations: AggregationOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subjectLevel, setSubjectLevel] = useState<"team" | "org">("team");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [components, setComponents] = useState<DraftComponent[]>([
    newComponent(),
  ]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const activeCount = indexes.filter((i) => i.status === "active").length;

  const candidate = useMemo(() => toCandidate(components), [components]);
  const parsed = useMemo(
    () => customComponentsSchema.safeParse(candidate),
    [candidate],
  );
  const weightSum = useMemo(
    () => components.reduce((sum, c) => sum + (Number(c.weight) || 0), 0),
    [components],
  );
  const weightsOk = Math.abs(weightSum - 1) < 0.011;

  function updateComponent(uid: string, patch: Partial<DraftComponent>) {
    setComponents((prev) =>
      prev.map((c) => (c.uid === uid ? { ...c, ...patch } : c)),
    );
  }
  function addComponent() {
    setComponents((prev) => [...prev, newComponent({ weight: "0" })]);
  }
  function removeComponent(uid: string) {
    setComponents((prev) => prev.filter((c) => c.uid !== uid));
  }
  function resetForm() {
    setName("");
    setSubjectLevel("team");
    setEditingSlug(null);
    setComponents([newComponent()]);
    setPreview(null);
  }
  function loadForEdit(index: CustomIndexView) {
    if (!index.components) {
      toast.error("This index's definition can't be edited (unreadable).");
      return;
    }
    setName(index.name);
    setSubjectLevel(index.subjectLevel);
    setEditingSlug(index.slug);
    setComponents(index.components.map(draftFromComponent));
    setPreview(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runPreview() {
    if (!parsed.success) {
      toast.error("Fix the component errors before previewing.");
      return;
    }
    setPreviewing(true);
    const res = await postJson("/api/indexes/preview", {
      subjectLevel,
      components: parsed.data,
    });
    setPreviewing(false);
    if (!res.ok) {
      toast.error(errorText(res.payload, `Preview failed (${res.status})`));
      return;
    }
    setPreview(res.payload as PreviewResponse);
  }

  async function publish() {
    if (!name.trim()) {
      toast.error("Give your index a name.");
      return;
    }
    if (!parsed.success) {
      toast.error("Fix the component errors before publishing.");
      return;
    }
    setPublishing(true);
    const res = await postJson("/api/indexes", {
      name: name.trim(),
      slug: editingSlug ?? undefined,
      subjectLevel,
      components: parsed.data,
    });
    setPublishing(false);
    if (!res.ok) {
      toast.error(errorText(res.payload, `Publish failed (${res.status})`));
      return;
    }
    toast.success(
      editingSlug
        ? "Published a new version — it recomputes tonight."
        : "Custom index published — it recomputes tonight.",
    );
    resetForm();
    router.refresh();
  }

  const componentError = parsed.success
    ? null
    : parsed.error.issues[0]?.message ?? "Invalid components";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {editingSlug ? "New version" : "Build a custom index"}
          </CardTitle>
          <CardDescription>
            {editingSlug
              ? `Editing “${name}” publishes a new immutable version; the old one is retired but its history is kept.`
              : "Pick metrics, choose how each aggregates, set weights (they must sum to 1) and normalization ranges. Preview against your recent data, then publish."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="index-name">Name</Label>
              <Input
                id="index-name"
                value={name}
                maxLength={80}
                placeholder="e.g. Agentic Adoption"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="index-level">Level</Label>
              <select
                id="index-level"
                className={inputClassName}
                value={subjectLevel}
                disabled={editingSlug !== null}
                onChange={(e) =>
                  setSubjectLevel(e.target.value as "team" | "org")
                }
              >
                <option value="team">Per team</option>
                <option value="org">Whole organization</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Custom indexes are team or org level only — never per person.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Components</span>
              <span
                className={
                  weightsOk
                    ? "text-xs text-muted-foreground"
                    : "text-xs font-medium text-destructive"
                }
              >
                Weights sum to {weightSum.toFixed(2)} / 1.00
              </span>
            </div>
            {components.map((component) => (
              <ComponentEditor
                key={component.uid}
                component={component}
                metrics={metrics}
                aggregations={aggregations}
                canRemove={components.length > 1}
                onChange={(patch) => updateComponent(component.uid, patch)}
                onRemove={() => removeComponent(component.uid)}
              />
            ))}
            {components.length < MAX_CUSTOM_COMPONENTS ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={addComponent}
              >
                <Plus data-icon="inline-start" />
                Add component
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                At most {MAX_CUSTOM_COMPONENTS} components per index.
              </p>
            )}
            {componentError ? (
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-destructive"
              >
                {componentError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={runPreview}
              disabled={previewing || !parsed.success}
            >
              {previewing && <Spinner data-icon="inline-start" />}
              Preview
            </Button>
            <Button
              onClick={publish}
              disabled={publishing || !parsed.success || !name.trim()}
            >
              {publishing && <Spinner data-icon="inline-start" />}
              {editingSlug ? "Publish new version" : "Publish"}
            </Button>
            {editingSlug ? (
              <Button variant="ghost" onClick={resetForm}>
                <RotateCcw data-icon="inline-start" />
                Cancel edit
              </Button>
            ) : null}
          </div>

          {preview ? (
            <PreviewPanel preview={preview} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Published indexes</CardTitle>
          <CardDescription>
            {activeCount} of {MAX_ACTIVE_CUSTOM_DEFINITIONS} active. Archived
            indexes stop recomputing and free a slot; their versioned history is
            never deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {indexes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom indexes yet. Build your first one above.
            </p>
          ) : (
            indexes.map((index) => (
              <IndexListItem
                key={index.slug}
                index={index}
                result={results[index.slug]}
                atCap={activeCount >= MAX_ACTIVE_CUSTOM_DEFINITIONS}
                onEdit={() => loadForEdit(index)}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ComponentEditor({
  component,
  metrics,
  aggregations,
  canRemove,
  onChange,
  onRemove,
}: {
  component: DraftComponent;
  metrics: MetricOption[];
  aggregations: AggregationOption[];
  canRemove: boolean;
  onChange: (patch: Partial<DraftComponent>) => void;
  onRemove: () => void;
}) {
  // Field ids derive from the stable per-row uid so every label/control pair is
  // programmatically associated (mirrors the top-level index-name/level form).
  const base = component.uid;
  return (
    <div className="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-48"
          aria-label="Component name"
          placeholder="Component name"
          value={component.key}
          maxLength={40}
          onChange={(e) => onChange({ key: e.target.value })}
        />
        <select
          className={`${inputClassName} max-w-40`}
          aria-label="Component type"
          value={component.kind}
          onChange={(e) => onChange({ kind: e.target.value as ComponentKind })}
        >
          <option value="metric">Single metric</option>
          <option value="ratio">Ratio (numerator ÷ denominator)</option>
        </select>
        {canRemove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Remove component"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>

      {component.kind === "metric" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <MetricSelect
            id={`${base}-metric`}
            label="Metric"
            metrics={metrics}
            value={component.metric}
            onChange={(v) => onChange({ metric: v })}
          />
          <AggregationSelect
            id={`${base}-aggregation`}
            aggregations={aggregations}
            value={component.aggregation}
            onChange={(v) => onChange({ aggregation: v })}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <MetricSelect
              id={`${base}-num-metric`}
              label="Numerator metric"
              metrics={metrics}
              value={component.numMetric}
              onChange={(v) => onChange({ numMetric: v })}
            />
            <AggregationSelect
              id={`${base}-num-aggregation`}
              aggregations={aggregations}
              value={component.numAggregation}
              onChange={(v) => onChange({ numAggregation: v })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <MetricSelect
              id={`${base}-den-metric`}
              label="Denominator metric"
              metrics={metrics}
              value={component.denMetric}
              onChange={(v) => onChange({ denMetric: v })}
            />
            <AggregationSelect
              id={`${base}-den-aggregation`}
              aggregations={aggregations}
              value={component.denAggregation}
              onChange={(v) => onChange({ denAggregation: v })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A ratio is only scored when both sides have data in the window —
            otherwise the component is left out, never counted as 0.
          </p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${base}-weight`} className="text-xs text-foreground">
            Weight (0–1)
          </Label>
          <Input
            id={`${base}-weight`}
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={component.weight}
            onChange={(e) => onChange({ weight: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${base}-min`} className="text-xs text-foreground">
            Scales to 0 at
          </Label>
          <Input
            id={`${base}-min`}
            type="number"
            value={component.min}
            onChange={(e) => onChange({ min: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${base}-max`} className="text-xs text-foreground">
            Scales to 100 at
          </Label>
          <Input
            id={`${base}-max`}
            type="number"
            value={component.max}
            onChange={(e) => onChange({ max: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

function MetricSelect({
  id,
  label,
  metrics,
  value,
  onChange,
}: {
  id: string;
  label: string;
  metrics: MetricOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-foreground">
        {label}
      </Label>
      <select
        id={id}
        className={inputClassName}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {metrics.map((m) => (
          <option key={m.key} value={m.key}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function AggregationSelect({
  id,
  aggregations,
  value,
  onChange,
}: {
  id: string;
  aggregations: AggregationOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-foreground">
        Aggregation
      </Label>
      <select
        id={id}
        className={inputClassName}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {aggregations.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: PreviewResponse }) {
  return (
    // role="status" + aria-live so async preview results are announced. The
    // container drops the muted fill so muted-foreground children keep contrast
    // on the normal background (CLAUDE.md muted-on-muted rule); the ring alone
    // marks the boundary, matching the ComponentEditor rows.
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-foreground/10"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Preview</span>
        <span className="text-xs text-muted-foreground">
          Against {preview.window.from} → {preview.window.to}
        </span>
      </div>
      {preview.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recent data for these metrics in the last 28 days, so there is
          nothing to score yet. This is not a zero — it means no rows were
          found. Connect or sync a tool that reports these metrics, then try
          again.
        </p>
      ) : (
        preview.entries.map((entry) => (
          <div
            key={entry.key}
            className="flex flex-col gap-2 rounded-md bg-background p-3 ring-1 ring-foreground/10"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{entry.label}</span>
              <span className="text-2xl font-semibold tabular-nums">
                {Math.round(entry.result.value)}
              </span>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              {Object.entries(entry.result.components).map(([key, c]) => (
                <div
                  key={key}
                  className="flex items-center justify-between text-muted-foreground"
                >
                  <span>{key}</span>
                  <span className="tabular-nums">
                    raw {round2(c.raw)} · {Math.round(c.normalized)}/100 ×{" "}
                    {c.weight} = {round2(c.contribution)}
                  </span>
                </div>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              Attribution: {entry.result.attribution.replace(/_/g, " ")}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function IndexListItem({
  index,
  result,
  atCap,
  onEdit,
}: {
  index: CustomIndexView;
  result: CustomIndexResult | undefined;
  atCap: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isActive = index.status === "active";

  async function toggle() {
    setBusy(true);
    const action = isActive ? "archive" : "unarchive";
    const res = await postJson(`/api/indexes/${index.slug}/${action}`);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorText(res.payload, `Could not ${action} (${res.status})`));
      return;
    }
    toast.success(isActive ? "Index archived." : "Index unarchived.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{index.name}</span>
        <Badge variant="outline" className="capitalize">
          {index.subjectLevel}
        </Badge>
        {isActive ? (
          <Badge variant="outline">v{index.versions[0]?.version}</Badge>
        ) : (
          <Badge variant="secondary">Archived</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isActive ? (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            disabled={busy || (!isActive && atCap)}
            title={
              !isActive && atCap
                ? `At most ${MAX_ACTIVE_CUSTOM_DEFINITIONS} active indexes`
                : undefined
            }
          >
            {busy && <Spinner data-icon="inline-start" />}
            {isActive ? (
              <>
                <Archive data-icon="inline-start" />
                Archive
              </>
            ) : (
              <>
                <ArchiveRestore data-icon="inline-start" />
                Unarchive
              </>
            )}
          </Button>
        </div>
      </div>
      <ResultLine result={result} />
    </div>
  );
}

function ResultLine({
  result,
}: {
  result: CustomIndexResult | undefined;
}) {
  if (!result || result.entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Not computed yet — it will appear after the next nightly recompute.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted-foreground">
        Latest for period ending {result.periodEnd}
      </span>
      {result.entries.map((entry) => (
        <div
          key={entry.teamId ?? "org"}
          className="flex items-center justify-between"
        >
          <span className="text-muted-foreground">{entry.label}</span>
          <span className="font-medium tabular-nums">
            {Math.round(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
