/**
 * Quote page state (ENG-286). A quote is keyed by the caller's PHONE NUMBER
 * (per agent): the page opens by phone (in-call form, CRM contact) or by a
 * saved lead id (the backend resolves its number). The backend creates the
 * quote on first open; every save then goes to the number it returned.
 *
 * Saves:
 *  - ~1s after every change settles,
 *  - every 10s as a safety net (only when something is unsaved),
 *  - when the tab is hidden or closed.
 * One save is in flight at a time. Saves carry the version last read; a stale
 * save comes back with the winning row (`current`), which we adopt.
 *
 * With neither a phone nor a lead the page is a scratch quote: nothing saves.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {QS_SUCCESS, openQuoteSession, saveQuoteSession} from './api';
import type {FormQuotePrefill} from './formPrefill';
import {emptySessionState, type LeadPrefill, type LeadSource, type QuoteSessionState} from './types';

const AUTOSAVE_MS = 1000;
const PERIODIC_SAVE_MS = 10_000;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface QuoteTarget {
	leadId: string | null;
	phone: string | null;
}

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

export function useQuoteSession(target: QuoteTarget, formPrefill: FormQuotePrefill | null = null) {
	const opensSession = !!(target.leadId || target.phone);
	const [state, setState] = useState<QuoteSessionState>(() =>
		applyFormPrefill(emptySessionState(), formPrefill)
	);
	const [loading, setLoading] = useState(opensSession);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [prefill, setPrefill] = useState<LeadPrefill | null>(() => mergeIdentity(null, formPrefill));
	const [leadSource, setLeadSource] = useState<LeadSource | null>(null);
	const [carriers, setCarriers] = useState<string[] | null>(null);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	/** The E.164 number the backend keyed this quote by. Null = scratch. */
	const [phone, setPhone] = useState<string | null>(null);
	/** When this open RESUMED an existing quote: its last-updated time. */
	const [resumedFrom, setResumedFrom] = useState<string | null>(null);
	const leadPrefillRef = useRef<LeadPrefill | null>(null);

	const phoneRef = useRef<string | null>(null);
	const versionRef = useRef(0);
	const loadedRef = useRef(false);
	const dirtyRef = useRef(false);
	// One save at a time: overlapping saves share a version and the second would
	// read as a false conflict. A change made mid-save stays dirty for the next.
	const savingRef = useRef(false);
	const stateRef = useRef(state);
	stateRef.current = state;

	useEffect(() => {
		if (!opensSession) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		openQuoteSession(target)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== QS_SUCCESS || !res.phone) {
					setLoadError(res.statusMessage || 'Could not open this quote');
					return;
				}
				phoneRef.current = res.phone;
				setPhone(res.phone);
				leadPrefillRef.current = res.prefill ?? null;
				if (res.created === false && res.session) setResumedFrom(res.session.updated_at);
				setPrefill(mergeIdentity(res.prefill ?? null, formPrefill));
				setLeadSource(res.lead_source ?? null);
				setCarriers(res.carriers ?? null);
				const loaded = res.session
					? {...emptySessionState(), ...res.session.state}
					: emptySessionState();
				versionRef.current = res.session?.version ?? 0;
				setState(applyFormPrefill(loaded, formPrefill));
				loadedRef.current = true;
				// Persist what the form just filled in, so a callback resumes with it.
				if (formPrefill && Object.keys(formPrefill.client).length) dirtyRef.current = true;
			})
			.catch((err) => {
				if (!cancelled) setLoadError(err?.message || 'Could not open this quote');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
		// Opened once per page load; the target never changes after mount.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const flush = useCallback(async () => {
		const key = phoneRef.current;
		if (!key || !loadedRef.current || !dirtyRef.current || savingRef.current) return;
		savingRef.current = true;
		dirtyRef.current = false;
		setSaveStatus('saving');
		try {
			const res = await saveQuoteSession(key, stateRef.current, versionRef.current);
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
		} finally {
			savingRef.current = false;
		}
	}, []);

	useEffect(() => {
		if (!dirtyRef.current) return;
		const t = window.setTimeout(flush, AUTOSAVE_MS);
		return () => window.clearTimeout(t);
	}, [state, flush]);

	// Safety net: catch anything a missed debounce left unsaved.
	useEffect(() => {
		const t = window.setInterval(() => void flush(), PERIODIC_SAVE_MS);
		return () => window.clearInterval(t);
	}, [flush]);

	// Last-chance save when the tab is hidden, switched away from, or closed.
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === 'hidden') void flush();
		};
		const onPageHide = () => void flush();
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', onPageHide);
		};
	}, [flush]);

	const update = useCallback((fn: (prev: QuoteSessionState) => QuoteSessionState) => {
		dirtyRef.current = true;
		setState(fn);
	}, []);

	/** Replace a resumed quote with a fresh one for this number (a different
	 *  person on the same line): seeded from the lead + live form, nothing kept. */
	const startNewQuote = useCallback(() => {
		const lead = leadPrefillRef.current;
		const base = emptySessionState();
		const seeded: QuoteSessionState = lead
			? {...base, client: {...base.client, ...lead.client}, coverage: {...base.coverage, ...lead.coverage}}
			: base;
		update(() => applyFormPrefill(seeded, formPrefill));
		setResumedFrom(null);
	}, [update, formPrefill]);

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
		phone,
		resumedFrom,
		dismissResumed: () => setResumedFrom(null),
		startNewQuote,
		persisted: !!phone
	};
}

export type QuoteSessionApi = ReturnType<typeof useQuoteSession>;
