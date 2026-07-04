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

import {useEffect, useMemo, useState} from 'react';
import {CheckCircle2, Loader2, RotateCcw, Save} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {
	getLeadFormBundle,
	saveLead,
	type DialerDisposition,
	type DialerForm
} from '@/lib/api';
import {FormRenderer, type LeadFormData} from './FormRenderer';
import {DispositionSelect} from './DispositionSelect';

export function LeadForm({
	campaignId,
	callSid,
	callerPhone
}: {
	campaignId: string;
	/** Tying the lead to the call. Null for a manual lead with no live call. */
	callSid: string | null;
	callerPhone: string | null;
}) {
	const [form, setForm] = useState<DialerForm | null>(null);
	const [dispositions, setDispositions] = useState<DialerDisposition[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [formData, setFormData] = useState<LeadFormData>({});
	const [dispositionKey, setDispositionKey] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [savedLeadId, setSavedLeadId] = useState<string | null>(null);

	const initialFormData = (nextForm: DialerForm | null): LeadFormData => {
		const phoneField = (nextForm?.schema ?? []).find(
			(f) => f.type === 'phone' || f.key === 'phone'
		);
		return phoneField && callerPhone ? {[phoneField.key]: callerPhone} : {};
	};

	// Best-effort name field key (so we can send a top-level name column too).
	const nameFieldKey = useMemo(() => {
		const keys = (form?.schema ?? []).map((f) => f.key);
		if (keys.includes('first_name') || keys.includes('last_name')) return null;
		return keys.find((k) => k === 'name') ?? null;
	}, [form]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setLoadError(null);
		getLeadFormBundle(campaignId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setLoadError(res.statusMessage || 'Failed to load lead form');
					return;
				}
				setForm(res.form ?? null);
				setDispositions(res.dispositions ?? []);
				setDispositionKey(null);
				setSaveError(null);
				setSavedLeadId(null);
				setFormData(initialFormData(res.form ?? null));
			})
			.catch((err) => {
				if (cancelled) return;
				setLoadError(readError(err, 'Failed to load lead form'));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
		// Re-fetch + reset when the campaign or the call changes.
	}, [campaignId, callSid, callerPhone]);

	const onField = (key: string, value: unknown) =>
		setFormData((prev) => ({...prev, [key]: value}));

	const derivedName = (): string | null => {
		const fd = formData as Record<string, unknown>;
		if (nameFieldKey && typeof fd[nameFieldKey] === 'string') {
			return (fd[nameFieldKey] as string) || null;
		}
		const first = typeof fd.first_name === 'string' ? fd.first_name : '';
		const last = typeof fd.last_name === 'string' ? fd.last_name : '';
		const full = `${first} ${last}`.trim();
		return full || null;
	};

	const onSave = async () => {
		setSaving(true);
		setSaveError(null);
		try {
			const res = await saveLead({
				campaign_id: campaignId,
				twilio_call_sid: callSid,
				caller_phone: callerPhone,
				name: derivedName(),
				disposition_id: dispositionKey,
				form_data: formData
			});
			if (res.statusCode !== 'SP100') {
				setSaveError(res.statusMessage || 'Could not save lead');
				return;
			}
			setSavedLeadId(res.lead_id ?? null);
		} catch (err) {
			setSaveError(readError(err, 'Could not save lead'));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Card className="shadow-xs">
			<CardHeader className="space-y-2">
				<CardTitle className="flex items-start justify-between gap-4">
					<span>
						<span className="block text-xl">New lead</span>
						<span className="mt-1 block text-sm font-normal leading-6 text-muted-foreground">
							Capture caller details while the call is active.
						</span>
					</span>
					{savedLeadId && (
						<Badge className="bg-success text-success-foreground">
							<CheckCircle2 className="size-3" />
							saved
						</Badge>
					)}
				</CardTitle>
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
								disabled={saving}
							/>
						) : (
							<p className="text-muted-foreground">
								No lead form is published for this campaign yet — you can still
								record a disposition.
							</p>
						)}

						<div className="space-y-2 border-t pt-4">
							<p className="text-sm font-medium">Disposition</p>
							<DispositionSelect
								dispositions={dispositions}
								value={dispositionKey}
								onChange={setDispositionKey}
								disabled={saving}
							/>
						</div>

						{saveError && <p className="text-destructive">{saveError}</p>}

						<div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
							<Button variant="success" onClick={onSave} disabled={saving}>
								{saving ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Save className="size-4" />
								)}
								{saving ? 'Saving…' : savedLeadId ? 'Save again' : 'Save lead'}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={saving}
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
							{savedLeadId && (
								<span className="text-xs leading-5 text-muted-foreground">
									Lead saved. Editing and re-saving creates a new lead in V1.
								</span>
							)}
							{!savedLeadId && (
								<span className="text-xs leading-5 text-muted-foreground">
									Lead will be linked to this call automatically.
								</span>
							)}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
