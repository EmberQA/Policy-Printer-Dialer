/**
 * Agents page — the team lead's live view of the agents under them, with Listen
 * (monitor) and Whisper controls (plans/dialer_supervision).
 *
 * Shown only when the backend reports `supervision.available` (a lead with agents
 * under them, on a seat that can receive a supervisor leg). The list is the same
 * heartbeat-fresh live state the EmberQA admin Live tab shows, scoped server-side to
 * the caller's lead teams. Polled on a plain interval like the hot-states board; a
 * one-second ticker keeps "time in status" counting between polls.
 *
 * Listen/Whisper never touch this browser's own call machinery: the supervisor leg
 * is claimed by the transport's exact-session intercept and shown in the banner here.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Ear, Loader2, MessageSquareText, RefreshCw, Square} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from '@/components/ui/table';
import {
	listSupervisableAgents,
	type SupervisableAgent,
	type SupervisionRole
} from '@/lib/api';
import {readError} from '@/lib/errors';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {cn} from '@/lib/utils';

const POLL_INTERVAL_MS = 10_000;

const agentName = (agent: {first_name: string | null; last_name: string | null; username?: string | null}): string =>
	[agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || 'Agent';

const formatDuration = (fromIso: string, now: number): string => {
	const started = Date.parse(fromIso);
	if (!Number.isFinite(started)) return '—';
	const total = Math.max(0, Math.floor((now - started) / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0
		? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
		: `${m}:${String(s).padStart(2, '0')}`;
};

const formatElapsed = (fromMs: number | undefined, now: number): string => {
	if (!fromMs) return '0:00';
	const total = Math.max(0, Math.floor((now - fromMs) / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const deviceLabel = (status: SupervisableAgent['twilio_device_status']): string => {
	switch (status) {
		case 'registered':
			return 'Online';
		case 'connecting':
			return 'Connecting';
		case 'error':
			return 'Error';
		default:
			return 'Offline';
	}
};

export default function Agents() {
	const {device, supervisionAvailable} = useDialerSession();
	const [agents, setAgents] = useState<SupervisableAgent[]>([]);
	const [supervisorNotice, setSupervisorNotice] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [pendingUserId, setPendingUserId] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);
	const [lastUpdated, setLastUpdated] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			const response = await listSupervisableAgents();
			if (response.statusCode !== 'SP100') {
				setLoadError(response.statusMessage || 'Could not load agents');
				return;
			}
			setAgents(response.agents ?? []);
			setSupervisorNotice(
				response.supervisor && !response.supervisor.eligible ? response.supervisor.message : null
			);
			setLoadError(null);
			setLastUpdated(Date.now());
		} catch (error) {
			setLoadError(readError(error, 'Could not load agents'));
		} finally {
			setRefreshing(false);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!supervisionAvailable) return;
		let inFlight = false;
		const tick = () => {
			if (inFlight || document.visibilityState !== 'visible') return;
			inFlight = true;
			void refresh().finally(() => {
				inFlight = false;
			});
		};
		tick();
		const interval = window.setInterval(tick, POLL_INTERVAL_MS);
		window.addEventListener('focus', tick);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', tick);
		};
	}, [refresh, supervisionAvailable]);

	useEffect(() => {
		const ticker = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(ticker);
	}, []);

	const supervision = device.supervision;
	const counts = useMemo(
		() => ({
			onCall: agents.filter((a) => a.on_call).length,
			ready: agents.filter((a) => !a.on_call && a.status === 'ready').length,
			paused: agents.filter((a) => !a.on_call && a.status !== 'ready').length
		}),
		[agents]
	);

	const start = async (agent: SupervisableAgent, role: SupervisionRole) => {
		setActionError(null);
		setPendingUserId(agent.user_id);
		try {
			await device.startSupervising({userId: agent.user_id, name: agentName(agent)}, role);
			void refresh();
		} catch (error) {
			setActionError(readError(error, 'Could not join the call'));
		} finally {
			setPendingUserId(null);
		}
	};

	const stop = async () => {
		setActionError(null);
		setSwitching(true);
		try {
			await device.stopSupervising();
			void refresh();
		} catch (error) {
			setActionError(readError(error, 'Could not stop supervising'));
		} finally {
			setSwitching(false);
		}
	};

	const switchRole = async (role: SupervisionRole) => {
		setActionError(null);
		setSwitching(true);
		try {
			await device.switchSupervisionRole(role);
			void refresh();
		} catch (error) {
			setActionError(readError(error, 'Could not switch'));
		} finally {
			setSwitching(false);
		}
	};

	if (!supervisionAvailable) return null;

	const canAct = device.canSupervise && !supervisorNotice && !pendingUserId;

	return (
		<div className="mx-auto w-full max-w-[1536px] space-y-4 p-4">
			{supervision && (
				<Card className="border-success/40">
					<CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
						<div className="flex items-center gap-3">
							<div className="flex size-9 items-center justify-center rounded-full bg-success/10 text-success">
								{supervision.role === 'whisper' ? (
									<MessageSquareText className="size-4" />
								) : (
									<Ear className="size-4" />
								)}
							</div>
							<div>
								<div className="flex items-center gap-2">
									<Badge className="bg-success text-success-foreground">
										{supervision.role === 'whisper' ? 'Whispering' : 'Listening'}
									</Badge>
									<span className="font-medium">{supervision.targetName ?? 'Agent'}</span>
									<span className="font-mono text-sm tabular-nums text-muted-foreground">
										{supervision.phase === 'active'
											? formatElapsed(supervision.connectedAt, now)
											: supervision.phase === 'ending' ? 'Stopping…' : supervision.phase === 'ringing'
												? 'Connecting…'
												: 'Joining…'}
									</span>
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									{supervision.role === 'whisper'
										? 'Only the agent hears you.'
										: 'Neither party can hear you.'}
								</div>
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							{supervision.role === 'monitor' ? (
								<Button
									size="sm"
									variant="secondary"
									disabled={switching || supervision.phase !== 'active'}
									onClick={() => void switchRole('whisper')}
								>
									<MessageSquareText className="size-4" /> Switch to whisper
								</Button>
							) : (
								<Button
									size="sm"
									variant="secondary"
									disabled={switching || supervision.phase !== 'active'}
									onClick={() => void switchRole('monitor')}
								>
									<Ear className="size-4" /> Switch to listen
								</Button>
							)}
							<Button size="sm" variant="destructive" disabled={switching} onClick={() => void stop()}>
								{switching ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />} Stop
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{(actionError || device.supervisionNotice) && !supervision && (
				<p role="status" className={cn('text-sm', actionError ? 'text-destructive' : 'text-muted-foreground')}>
					{actionError ?? device.supervisionNotice}
				</p>
			)}
			{actionError && supervision && (
				<p role="status" className="text-sm text-destructive">{actionError}</p>
			)}

			<Card>
				<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
					<div>
						<CardTitle className="text-base">Agents</CardTitle>
						<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>{agents.length} online</span>
							<Badge variant="outline">{counts.onCall} on call</Badge>
							<Badge variant="outline">{counts.ready} ready</Badge>
							<Badge variant="outline">{counts.paused} paused</Badge>
							{lastUpdated && <span>Updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
						</div>
					</div>
					<Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
						<RefreshCw className={cn('size-4', refreshing && 'animate-spin')} /> Refresh
					</Button>
				</CardHeader>
				<CardContent className="space-y-3">
					{supervisorNotice && (
						<p role="status" className="text-sm text-muted-foreground">{supervisorNotice}</p>
					)}
					{loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
					{loading ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading agents…
						</div>
					) : agents.length === 0 ? (
						<p className="text-sm text-muted-foreground">None of your agents are online right now.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow className="bg-muted/50 hover:bg-muted/50">
									<TableHead>Agent</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Time in status</TableHead>
									<TableHead>Campaigns ready</TableHead>
									<TableHead>Device</TableHead>
									<TableHead className="sticky right-0 z-10 w-52 bg-card text-right">Supervise</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{agents.map((agent) => {
									const statusLabel = agent.on_call ? 'On call' : agent.status === 'ready' ? 'Ready' : 'Paused';
									const rowBusy = pendingUserId === agent.user_id;
									const buttonsEnabled = canAct && agent.supervisable && !supervision;
									const disabledReason = !agent.on_call
										? 'Not on a call'
										: !agent.supervisable
											? 'Unavailable for this call'
											: supervision
												? 'Stop your current session first'
												: supervisorNotice ?? (device.canSupervise ? undefined : 'Your softphone is busy');
									return (
										<TableRow key={agent.id}>
											<TableCell className="min-w-40 max-w-64 whitespace-normal [overflow-wrap:anywhere]">
												<div className="font-medium">{agentName(agent)}</div>
												{agent.username && (
													<div className="text-xs text-muted-foreground">{agent.username}</div>
												)}
											</TableCell>
											<TableCell>
												<div className="flex flex-wrap items-center gap-1">
													<Badge
														className={cn(
															agent.on_call
																? 'bg-amber-500 text-white'
																: agent.status === 'ready'
																	? 'bg-success text-success-foreground'
																	: ''
														)}
														variant={agent.on_call || agent.status === 'ready' ? 'default' : 'secondary'}
													>
														{statusLabel}
													</Badge>
													{agent.supervised_by && (
														<Badge variant="outline">
															{agent.supervised_by.role === 'whisper' ? 'Whisper' : 'Listening'}:{' '}
															{agentName(agent.supervised_by)}
														</Badge>
													)}
												</div>
											</TableCell>
											<TableCell className="font-mono text-sm tabular-nums">
												{formatDuration(agent.live_state_changed_at, now)}
											</TableCell>
											<TableCell className="min-w-40 max-w-80 whitespace-normal text-sm [overflow-wrap:anywhere]">
												{agent.armed_campaigns.length ? agent.armed_campaigns.join(', ') : '—'}
											</TableCell>
											<TableCell className="text-sm">{deviceLabel(agent.twilio_device_status)}</TableCell>
											<TableCell className="sticky right-0 z-10 w-52 bg-card text-right">
												<div className="flex justify-end gap-2">
													<Button
														size="sm"
														variant="outline"
														disabled={!buttonsEnabled || rowBusy}
														title={disabledReason}
														aria-label={`Listen to ${agentName(agent)}`}
														onClick={() => void start(agent, 'monitor')}
													>
														{rowBusy ? <Loader2 className="size-4 animate-spin" /> : <Ear className="size-4" />} Listen
													</Button>
													<Button
														size="sm"
														variant="outline"
														disabled={!buttonsEnabled || rowBusy}
														title={disabledReason}
														aria-label={`Whisper to ${agentName(agent)}`}
														onClick={() => void start(agent, 'whisper')}
													>
														<MessageSquareText className="size-4" /> Whisper
													</Button>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
