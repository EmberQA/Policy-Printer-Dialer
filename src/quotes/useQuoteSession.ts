/**
 * Quote page state (ENG-286): load the lead's saved session (or seed a new one
 * from the lead's prefill), then autosave every change ~1s after it settles.
 *
 * Saves carry the version last read; a stale save comes back with the winning
 * row (`current`), which we adopt — someone else (another tab) moved it on.
 * Without a lead_id nothing is persisted; the page works as a scratch quoter.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {QS_SUCCESS, openQuoteSession, saveQuoteSession} from './api';
import type {FormQuotePrefill} from './formPrefill';
import {emptySessionState, type LeadPrefill, type LeadSource, type QuoteSessionState} from './types';

const AUTOSAVE_MS = 1000;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const seedFromPrefill = (prefill: LeadPrefill | undefined): QuoteSessionState => {
	const base = emptySessionState();
	if (!prefill) return base;
	return {
		...base,
		client: {...base.client, ...prefill.client},
		coverage: {...base.coverage, ...prefill.coverage}
	};
};

/** The live form is the newest data the agent has typed: its known values win. */
const applyFormPrefill = (
	state: QuoteSessionState,
	form: FormQuotePrefill | null
): QuoteSessionState =>
	form && Object.keys(form.client).length
		? {...state, client: {...state.client, ...form.client}}
		: state;

/** Header identity: form names/phone over the lead record's. */
const mergeIdentity = (lead: LeadPrefill | null, form: FormQuotePrefill | null): LeadPrefill | null =>
	form
		? {
				firstName: form.firstName ?? lead?.firstName ?? null,
				lastName: form.lastName ?? lead?.lastName ?? null,
				phone: form.phone ?? lead?.phone ?? null,
				client: lead?.client ?? {},
				coverage: lead?.coverage ?? {}
			}
		: lead;

export function useQuoteSession(leadId: string | null, formPrefill: FormQuotePrefill | null = null) {
	const [state, setState] = useState<QuoteSessionState>(() =>
		applyFormPrefill(emptySessionState(), formPrefill)
	);
	const [loading, setLoading] = useState(!!leadId);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [prefill, setPrefill] = useState<LeadPrefill | null>(() => mergeIdentity(null, formPrefill));
	const [leadSource, setLeadSource] = useState<LeadSource | null>(null);
	const [carriers, setCarriers] = useState<string[] | null>(null);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [saveMessage, setSaveMessage] = useState<string | null>(null);

	const versionRef = useRef(0);
	const loadedRef = useRef(false);
	const dirtyRef = useRef(false);
	const stateRef = useRef(state);
	stateRef.current = state;

	useEffect(() => {
		if (!leadId) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		openQuoteSession(leadId)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== QS_SUCCESS) {
					setLoadError(res.statusMessage || 'Could not open this lead');
					return;
				}
				setPrefill(mergeIdentity(res.prefill ?? null, formPrefill));
				setLeadSource(res.lead_source ?? null);
				setCarriers(res.carriers ?? null);
				const loaded = res.session
					? {...emptySessionState(), ...res.session.state}
					: seedFromPrefill(res.prefill);
				versionRef.current = res.session?.version ?? 0;
				setState(applyFormPrefill(loaded, formPrefill));
				loadedRef.current = true;
				// Persist what the form just filled in, so a callback resumes with it.
				if (formPrefill && Object.keys(formPrefill.client).length) dirtyRef.current = true;
			})
			.catch((err) => {
				if (!cancelled) setLoadError(err?.message || 'Could not open this lead');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [leadId]);

	const flush = useCallback(async () => {
		if (!leadId || !loadedRef.current || !dirtyRef.current) return;
		dirtyRef.current = false;
		setSaveStatus('saving');
		try {
			const res = await saveQuoteSession(leadId, stateRef.current, versionRef.current);
			if (res.statusCode === QS_SUCCESS && res.session) {
				versionRef.current = res.session.version;
				setSaveStatus('saved');
				setSaveMessage(null);
			} else if (res.current) {
				versionRef.current = res.current.version;
				setState({...emptySessionState(), ...res.current.state});
				setSaveStatus('conflict');
				setSaveMessage(res.statusMessage);
			} else {
				dirtyRef.current = true;
				setSaveStatus('error');
				setSaveMessage(res.statusMessage || 'Save failed');
			}
		} catch (err: any) {
			dirtyRef.current = true;
			setSaveStatus('error');
			setSaveMessage(err?.message || 'Save failed');
		}
	}, [leadId]);

	useEffect(() => {
		if (!dirtyRef.current) return;
		const t = window.setTimeout(flush, AUTOSAVE_MS);
		return () => window.clearTimeout(t);
	}, [state, flush]);

	// Last-chance save when the tab closes mid-debounce.
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === 'hidden') void flush();
		};
		document.addEventListener('visibilitychange', onHide);
		return () => document.removeEventListener('visibilitychange', onHide);
	}, [flush]);

	const update = useCallback((fn: (prev: QuoteSessionState) => QuoteSessionState) => {
		dirtyRef.current = true;
		setState(fn);
	}, []);

	return {
		state,
		update,
		loading,
		loadError,
		prefill,
		leadSource,
		carriers,
		setCarriers,
		saveStatus,
		saveMessage,
		persisted: !!leadId
	};
}

export type QuoteSessionApi = ReturnType<typeof useQuoteSession>;
