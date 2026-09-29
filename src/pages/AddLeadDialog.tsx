import {useEffect, useRef, useState} from 'react';
import {Loader2, Save, X} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select';
import {FormRenderer, type LeadFormData} from '@/leads/FormRenderer';
import {DispositionSelect} from '@/leads/DispositionSelect';
import {
	getLeadFormBundle,
	listCampaigns,
	saveLead,
	type DialerCampaign,
	type LeadFormBundleResponse
} from '@/lib/api';
import {normalizeDialInput} from '@/lib/phone';
import {deriveLeadName, formHasNameFields} from './crmLeadEdit';

const readError = (err: unknown, fallback: string): string => {
	const error = err as {
		response?: {data?: {statusMessage?: string}};
		message?: string;
	};
	return error?.response?.data?.statusMessage || error?.message || fallback;
};

export function AddLeadDialog({
	initialCampaignId = '',
	onClose,
	onSaved
}: {
	initialCampaignId?: string;
	onClose: () => void;
	onSaved: (leadId: string) => void;
}) {
	const [campaigns, setCampaigns] = useState<DialerCampaign[]>([]);
	const [campaignId, setCampaignId] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		listCampaigns()
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100')
					throw new Error(res.statusMessage || 'Could not load campaigns');
				const active = (res.campaigns ?? []).filter(
					(campaign) => campaign.active
				);
				setCampaigns(active);
				setCampaignId(
					active.some((campaign) => campaign.id === initialCampaignId)
						? initialCampaignId
						: active.length === 1
							? active[0].id
							: ''
				);
			})
			.catch((err) => {
				if (!cancelled) setError(readError(err, 'Could not load campaigns'));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [initialCampaignId, retry]);

	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
				<Dialog.Content
					className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg"
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<div className="flex items-start justify-between gap-4 border-b p-5">
						<div className="space-y-1">
							<Dialog.Title className="text-lg font-semibold">
								Add lead
							</Dialog.Title>
							<Dialog.Description className="text-sm text-muted-foreground">
								Add a contact to your CRM without placing a call.
							</Dialog.Description>
						</div>
						<Button
							size="icon"
							variant="ghost"
							aria-label="Close add lead"
							disabled={saving}
							onClick={onClose}
						>
							<X className="size-4" />
						</Button>
					</div>
					<div className="space-y-5 overflow-y-auto p-5">
						{loading ? (
							<p
								role="status"
								className="flex items-center gap-2 text-sm text-muted-foreground"
							>
								<Loader2 className="size-4 animate-spin" />
								Loading campaigns…
							</p>
						) : error ? (
							<div className="space-y-3">
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
								<Button
									variant="outline"
									onClick={() => setRetry((value) => value + 1)}
								>
									Retry
								</Button>
							</div>
						) : campaigns.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No active campaigns are available. Ask your manager to assign
								you to a campaign before adding a lead.
							</p>
						) : (
							<>
								<div className="space-y-2">
									<Label htmlFor="new-lead-campaign">
										Campaign <span className="text-destructive">*</span>
									</Label>
									<Select
										value={campaignId}
										onValueChange={setCampaignId}
										disabled={saving}
									>
										<SelectTrigger id="new-lead-campaign" className="w-full">
											<SelectValue placeholder="Select a campaign" />
										</SelectTrigger>
										<SelectContent>
											{campaigns.map((campaign) => (
												<SelectItem key={campaign.id} value={campaign.id}>
													{campaign.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{campaignId && (
									<ManualLeadForm
										key={campaignId}
										campaignId={campaignId}
										onClose={onClose}
										onSaved={onSaved}
										onSavingChange={setSaving}
									/>
								)}
							</>
						)}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function ManualLeadForm({
	campaignId,
	onClose,
	onSaved,
	onSavingChange
}: {
	campaignId: string;
	onClose: () => void;
	onSaved: (leadId: string) => void;
	onSavingChange: (saving: boolean) => void;
}) {
	const [bundle, setBundle] = useState<LeadFormBundleResponse | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	const [phone, setPhone] = useState('');
	const [name, setName] = useState('');
	const [formData, setFormData] = useState<LeadFormData>({});
	const [disposition, setDisposition] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const schema = bundle?.form?.schema ?? [];
	const activeSchema = schema.filter((field) => field.active !== false);
	const phoneField =
		activeSchema.find((field) => field.key === 'phone') ??
		activeSchema.find((field) => field.type === 'phone');
	const dispositions = bundle?.dispositions ?? [];

	useEffect(() => {
		let cancelled = false;
		setLoadError(null);
		getLeadFormBundle(campaignId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100')
					throw new Error(res.statusMessage || 'Could not load lead form');
				setBundle(res);
			})
			.catch((err) => {
				if (!cancelled)
					setLoadError(readError(err, 'Could not load lead form'));
			});
		return () => {
			cancelled = true;
		};
	}, [campaignId, retry]);

	const onSave = async () => {
		if (!bundle || savingRef.current) return;
		const callerPhone = normalizeDialInput(phone);
		if (!callerPhone) {
			setSaveError('Enter a valid 10-digit US or Canadian phone number.');
			return;
		}
		savingRef.current = true;
		setSaving(true);
		onSavingChange(true);
		setSaveError(null);
		try {
			const res = await saveLead({
				campaign_id: campaignId,
				twilio_call_sid: null,
				caller_phone: callerPhone,
				name: deriveLeadName(schema, formData, name),
				disposition_id: disposition,
				form_data: {
					...formData,
					...(phoneField ? {[phoneField.key]: callerPhone} : {})
				}
			});
			if (res.statusCode !== 'SP100' || !res.lead_id)
				throw new Error(res.statusMessage || 'Could not save lead');
			onSaved(res.lead_id);
		} catch (err) {
			setSaveError(readError(err, 'Could not save lead'));
		} finally {
			savingRef.current = false;
			setSaving(false);
			onSavingChange(false);
		}
	};

	if (loadError)
		return (
			<div className="space-y-3">
				<p role="alert" className="text-sm text-destructive">
					{loadError}
				</p>
				<Button
					variant="outline"
					onClick={() => setRetry((value) => value + 1)}
				>
					Retry
				</Button>
			</div>
		);
	if (!bundle)
		return (
			<p
				role="status"
				className="flex items-center gap-2 text-sm text-muted-foreground"
			>
				<Loader2 className="size-4 animate-spin" />
				Loading form…
			</p>
		);

	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				void onSave();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="new-lead-phone">
						Phone <span className="text-destructive">*</span>
					</Label>
					<Input
						id="new-lead-phone"
						type="tel"
						autoComplete="tel"
						required
						value={phone}
						onChange={(event) => setPhone(event.target.value)}
						disabled={saving}
					/>
				</div>
				{!formHasNameFields(schema) && (
					<div className="space-y-2">
						<Label htmlFor="new-lead-name">Name</Label>
						<Input
							id="new-lead-name"
							autoComplete="name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={saving}
						/>
					</div>
				)}
			</div>
			{bundle.form && (
				<FormRenderer
					schema={schema}
					value={formData}
					onChange={(key, value) =>
						setFormData((current) => ({...current, [key]: value}))
					}
					excludeKeys={phoneField ? [phoneField.key] : []}
					disabled={saving}
				/>
			)}
			{dispositions.length > 0 && (
				<div className="space-y-2">
					<Label>Disposition (optional)</Label>
					<DispositionSelect
						dispositions={dispositions}
						value={disposition}
						onChange={setDisposition}
						disabled={saving}
					/>
				</div>
			)}
			{saveError && (
				<p role="alert" className="text-sm text-destructive">
					{saveError}
				</p>
			)}
			<div className="flex justify-end gap-2 border-t pt-4">
				<Button
					type="button"
					variant="outline"
					onClick={onClose}
					disabled={saving}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={saving}>
					{saving ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Save className="size-4" />
					)}
					{saving ? 'Saving…' : 'Save lead'}
				</Button>
			</div>
		</form>
	);
}
