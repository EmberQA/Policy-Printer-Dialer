/**
 * Preview of a campaign's call script (ENG-278), opened from the Campaigns
 * menu. Renders in the Dial screen's left column, exactly where the script
 * shows on a live call. Uses the same lead-form bundle the call loads (no call
 * sid), so it's the published script agents will get.
 */

import {useEffect, useState} from 'react';
import {Loader2, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {getLeadFormBundle, type DialerCampaign} from '@/lib/api';
import {readError} from '@/lib/errors';
import {ScriptPreview, type ScriptAgentVars} from './ScriptPanel';
import type {DialerScript} from './types';

type LoadState =
	| {kind: 'loading'}
	| {kind: 'error'; message: string}
	| {kind: 'ready'; script: DialerScript | null};

export function ScriptPreviewPanel({
	campaign,
	agentVars,
	onClose,
	onCollapse
}: {
	campaign: DialerCampaign;
	agentVars: ScriptAgentVars;
	onClose: () => void;
	onCollapse?: () => void;
}) {
	return (
		<div className="space-y-2 xl:sticky xl:top-28">
			<div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-1">
				<p className="min-w-0 truncate text-xs font-medium text-foreground">
					Previewing script · {campaign.name}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7 shrink-0"
					aria-label="Close script preview"
					onClick={onClose}
				>
					<X className="size-4" />
				</Button>
			</div>
			<PreviewBody
				key={campaign.id}
				campaignId={campaign.id}
				agentVars={agentVars} onCollapse={onCollapse}
			/>
		</div>
	);
}

function PreviewBody({
	campaignId,
	agentVars,
	onCollapse
}: {
	campaignId: string;
	agentVars: ScriptAgentVars;
	onCollapse?: () => void;
}) {
	const [state, setState] = useState<LoadState>({kind: 'loading'});

	useEffect(() => {
		let cancelled = false;
		getLeadFormBundle(campaignId, null)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setState({
						kind: 'error',
						message: res.statusMessage || 'Could not load the script'
					});
					return;
				}
				setState({kind: 'ready', script: res.script ?? null});
			})
			.catch((err) => {
				if (!cancelled)
					setState({
						kind: 'error',
						message: readError(err, 'Could not load the script')
					});
			});
		return () => {
			cancelled = true;
		};
	}, [campaignId]);

	if (state.kind === 'loading')
		return (
			<p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" />
				Loading script…
			</p>
		);
	if (state.kind === 'error')
		return <p className="px-1 text-sm text-destructive">{state.message}</p>;
	if (!state.script)
		return (
			<p className="px-1 text-sm text-muted-foreground">
				This campaign has no published script yet.
			</p>
		);
	return <ScriptPreview script={state.script} agentVars={agentVars} onCollapse={onCollapse} />;
}
