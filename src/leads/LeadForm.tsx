/**
 * LeadForm — the lead-capture card shown during/after an active call (Subplan 04).
 *
 * Fetches the campaign's published form + dispositions (leadForm/get), pre-fills
 * the caller's phone, lets the agent fill the schema-driven fields + pick a
 * disposition, and saves the lead (lead/save) tied to the call's CallSid. The
 * backend validates server-side; we surface its first error inline.
 *
 * The bundle is fetched once per (campaign, call). A fresh call resets the form
 * (keyed by callSid in the parent), so each call starts blank with its own
 * caller pre-filled.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  getLeadFormBundle,
  saveLead,
  updateLead,
  type DialerDisposition,
  type DialerForm,
  type ReturningCallerLead,
} from "@/lib/api";
import { stateFormValueFromPhone } from "@/lib/phone";
import { FormRenderer, type LeadFormData } from "./FormRenderer";
import { DispositionSelect } from "./DispositionSelect";
import { useLeadNotes } from "./LeadNotesContext";

export function LeadForm({
  campaignId,
  callSid,
  callerPhone,
  onComplete,
  showClear = true,
  editLead = null,
}: {
  campaignId: string;
  /** Tying the lead to the call. Null for a manual lead with no live call. */
  callSid: string | null;
  callerPhone: string | null;
  /** Called once this call has either a saved lead or confirmed no-lead outcome. */
  onComplete?: () => Promise<void> | void;
  showClear?: boolean;
  /**
   * Edit-in-place mode for direct-dial callbacks: when set, this form is seeded from
   * the caller's most-recent prior lead and Save UPDATES that lead (bumping its info +
   * timestamps) instead of creating a new one. Null → normal blank New-Lead behavior.
   */
  editLead?: ReturningCallerLead | null;
}) {
  const [form, setForm] = useState<DialerForm | null>(null);
  const [dispositions, setDispositions] = useState<DialerDisposition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formData, setFormData] = useState<LeadFormData>({});
  const [dispositionKey, setDispositionKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [completingWithoutLead, setCompletingWithoutLead] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [pendingDispositionAction, setPendingDispositionAction] = useState<
    "save" | "skip" | null
  >(null);
  const busy = saving || completingWithoutLead;
  const { setNote } = useLeadNotes();

  const initialFormData = (nextForm: DialerForm | null): LeadFormData => {
    const priorAnswers = editLead?.form_data ?? {};
    const priorFieldByLabel = new Map(
      (editLead?.form_schema_snapshot ?? []).map((field) => [
        normalizeFieldLabel(field.label),
        field,
      ]),
    );
    // A returning caller is edited in the currently configured campaign form.
    // Preserve prior answers where the field key still matches, otherwise match the
    // human label (e.g. an old `phone_number` to a new `phone`). Fields that no
    // longer exist are intentionally dropped rather than failing validation.
    const matchingPriorAnswers: LeadFormData = {};
    for (const field of nextForm?.schema ?? []) {
      if (priorAnswers[field.key] !== undefined) {
        matchingPriorAnswers[field.key] = priorAnswers[field.key];
        continue;
      }
      const priorField = priorFieldByLabel.get(
        normalizeFieldLabel(field.label),
      );
      if (priorField && priorAnswers[priorField.key] !== undefined) {
        matchingPriorAnswers[field.key] = priorAnswers[priorField.key];
      }
    }
    const schema = nextForm?.schema ?? [];
    const phoneField = schema.find(
      (f) => f.type === "phone" || f.key === "phone",
    );
    const stateField = schema.find((field) => field.key === "state");
    const initialData: LeadFormData = editLead
      ? { ...matchingPriorAnswers }
      : {};

    // The live caller number always wins for the current form's phone field.
    if (phoneField && callerPhone) {
      initialData[phoneField.key] = callerPhone;
    }

    // Infer only the exact `state` key. Preserve an existing returning-caller answer,
    // and leave unresolvable/non-geographic numbers or incompatible option lists blank.
    if (
      stateField &&
      callerPhone &&
      !hasFormValue(initialData[stateField.key])
    ) {
      const stateValue = stateFormValueFromPhone(
        callerPhone,
        stateField.options,
      );
      if (stateValue !== null) initialData[stateField.key] = stateValue;
    }

    return initialData;
  };

  // Best-effort name field key (so we can send a top-level name column too).
  const nameFieldKey = useMemo(() => {
    const keys = (form?.schema ?? []).map((f) => f.key);
    if (keys.includes("first_name") || keys.includes("last_name")) return null;
    return keys.find((k) => k === "name") ?? null;
  }, [form]);
  const noteField = useMemo(
    () =>
      (form?.schema ?? []).find(
        (field) => field.key === "notes" || field.key === "note",
      ) ?? null,
    [form],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getLeadFormBundle(campaignId)
      .then((res) => {
        if (cancelled) return;
        if (res.statusCode !== "SP100") {
          setLoadError(res.statusMessage || "Failed to load lead form");
          return;
        }
        setForm(res.form ?? null);
        setDispositions(res.dispositions ?? []);
        // Edit-in-place seeds the prior lead's disposition; new leads start blank.
        setDispositionKey(editLead?.disposition_id ?? null);
        setSaveError(null);
        setSavedLeadId(null);
        setFormData(initialFormData(res.form ?? null));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(readError(err, "Failed to load lead form"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch + reset when the campaign, the call, or the edited lead changes.
  }, [campaignId, callSid, callerPhone, editLead?.id]);

  const onField = (key: string, value: unknown) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!noteField) {
      setNote(null);
      return;
    }
    setNote({
      key: noteField.key,
      label: noteField.label,
      value:
        typeof formData[noteField.key] === "string"
          ? (formData[noteField.key] as string)
          : "",
      onChange: (value) => onField(noteField.key, value),
    });
  }, [formData, noteField, setNote]);

  useEffect(() => () => setNote(null), [setNote]);

  const selectedDisposition = useMemo(
    () =>
      dispositions.find((d) => d.disposition_key === dispositionKey) ?? null,
    [dispositions, dispositionKey],
  );

  const requireDisposition = (): boolean => {
    if (dispositionKey) return true;
    setSaveError(
      dispositions.length === 0
        ? "A disposition is required, but none are configured for this campaign."
        : "Select a disposition before completing this call.",
    );
    return false;
  };

  const derivedName = (): string | null => {
    const fd = formData as Record<string, unknown>;
    if (nameFieldKey && typeof fd[nameFieldKey] === "string") {
      return (fd[nameFieldKey] as string) || null;
    }
    const first = typeof fd.first_name === "string" ? fd.first_name : "";
    const last = typeof fd.last_name === "string" ? fd.last_name : "";
    const full = `${first} ${last}`.trim();
    return full || null;
  };

  const onSave = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      // Edit-in-place (callback): UPDATE the prior lead so its info + timestamps
      // refresh, rather than creating a duplicate. Otherwise create a new lead.
      const res = editLead
        ? await updateLead({
            lead_id: editLead.id,
            name: derivedName(),
            disposition_id: dispositionKey,
            form_data: formData,
          })
        : await saveLead({
            campaign_id: campaignId,
            twilio_call_sid: callSid,
            caller_phone: callerPhone,
            name: derivedName(),
            disposition_id: dispositionKey,
            form_data: formData,
          });
      if (res.statusCode !== "SP100") {
        setSaveError(res.statusMessage || "Could not save lead");
        return false;
      }
      setSavedLeadId(res.lead_id ?? editLead?.id ?? null);
      await onComplete?.();
      return true;
    } catch (err) {
      setSaveError(readError(err, "Could not save lead"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDispositionAction = async () => {
    if (!requireDisposition()) return;
    if (pendingDispositionAction === "save") {
      if (await onSave()) setPendingDispositionAction(null);
      return;
    }
    if (pendingDispositionAction !== "skip") return;
    setCompletingWithoutLead(true);
    setSaveError(null);
    try {
      await onComplete?.();
      setPendingDispositionAction(null);
    } catch (err) {
      setSaveError(readError(err, "Could not complete call wrap-up"));
    } finally {
      setCompletingWithoutLead(false);
    }
  };

  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        {savedLeadId && (
          <Badge className="bg-success text-success-foreground">
            <CheckCircle2 className="size-3" />
            saved
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {loading && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading form…
          </p>
        )}
        {loadError && <p className="text-destructive">{loadError}</p>}

        {!loading && !loadError && (
          <>
            {form ? (
              <FormRenderer
                schema={form.schema}
                value={formData}
                onChange={onField}
                disabled={busy}
                excludeKeys={noteField ? [noteField.key] : []}
              />
            ) : (
              <p className="text-muted-foreground">
                No lead form is published for this campaign yet — you can still
                record a disposition.
              </p>
            )}

            {saveError && <p className="text-destructive">{saveError}</p>}

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
              <Button
                variant="success"
                onClick={() => setPendingDispositionAction("save")}
                disabled={busy}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {saving
                  ? "Saving…"
                  : editLead
                    ? savedLeadId
                      ? "Update Again"
                      : "Update Lead"
                    : savedLeadId
                      ? "Save Again"
                      : "Save Lead"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setPendingDispositionAction("skip")}
              >
                <Ban className="size-4" />
                Don't Save
              </Button>
              <DialogPrimitive.Root
                open={pendingDispositionAction !== null}
                onOpenChange={(open) => {
                  if (!open) setPendingDispositionAction(null);
                }}
              >
                <DialogPrimitive.Portal>
                  <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                  <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
                    <div className="flex gap-3">
                      {pendingDispositionAction === "skip" && (
                        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                          <AlertTriangle className="size-5" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <DialogPrimitive.Title className="text-base font-semibold">
                          {pendingDispositionAction === "save"
                            ? editLead
                              ? "Update lead"
                              : "Save lead"
                            : "Do Not Save Lead"}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description className="text-sm leading-6 text-muted-foreground">
                          Are you sure you don't want to save a lead?
                        </DialogPrimitive.Description>
                        <DialogPrimitive.Description className="text-sm leading-6 text-muted-foreground">
                          Choose a disposition before completing this call.
                        </DialogPrimitive.Description>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Disposition</Label>
                      <DispositionSelect
                        dispositions={dispositions}
                        value={dispositionKey}
                        onChange={setDispositionKey}
                        disabled={busy}
                      />
                      {dispositions.length === 0 && (
                        <p className="text-sm text-destructive">
                          No dispositions are configured for this campaign.
                        </p>
                      )}
                      {selectedDisposition && (
                        <p className="text-xs text-muted-foreground">
                          Selected: {selectedDisposition.label}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <DialogPrimitive.Close asChild>
                        <Button type="button" variant="outline" disabled={busy}>
                          Cancel
                        </Button>
                      </DialogPrimitive.Close>
                      <Button
                        type="button"
                        variant={
                          pendingDispositionAction === "skip"
                            ? "destructive"
                            : "success"
                        }
                        disabled={busy || !dispositionKey}
                        onClick={onConfirmDispositionAction}
                      >
                        {completingWithoutLead && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {pendingDispositionAction === "save"
                          ? editLead
                            ? "Update lead"
                            : "Save lead"
                          : "Dont Save Lead"}
                      </Button>
                    </div>
                  </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
              </DialogPrimitive.Root>
              {showClear && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setSaveError(null);
                    setSavedLeadId(null);
                    setDispositionKey(null);
                    setFormData(initialFormData(form));
                  }}
                >
                  <RotateCcw className="size-4" />
                  Clear
                </Button>
              )}
              {savedLeadId && (
                <span className="text-xs leading-5 text-muted-foreground">
                  {editLead
                    ? "Lead updated."
                    : "Lead saved. Editing and re-saving creates a new lead in V1."}
                </span>
              )}
              {!savedLeadId && (
                <span className="text-xs leading-5 text-muted-foreground">
                  {editLead
                    ? "Updating this returning caller’s existing lead."
                    : "Lead will be linked to this call automatically."}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function hasFormValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

const normalizeFieldLabel = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

function readError(err: any, fallback: string): string {
  return err?.response?.data?.statusMessage || err?.message || fallback;
}
