/**
 * Lead-form ↔ call-script bridge (ENG-278).
 *
 * LeadForm stays the source of truth for form_data (same pattern as
 * LeadNotesContext): it PUBLISHES a view of the active form plus a writer, and
 * EMITS a commit event whenever a value becomes final — a field blur, a
 * pick-style control change, and every field on Save. The call script listens
 * to commits (never to keystrokes) and writes back through `writeField`.
 *
 * Sync rules (decided 2026-09-28): values cross only on blur / save; last write
 * wins in both directions.
 */

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactNode
} from 'react';
import type {FormField} from '@/lib/api';
import type {DialerScript} from '@/script/types';
import type {LeadFormData} from './FormRenderer';

/** What LeadForm publishes while a form is mounted. */
export interface LeadFormView {
	/** Identity of the call this form belongs to (resets the script session). */
	callKey: string;
	/** dialer_forms.form_key of the rendered form — bindings match on it. */
	formKey: string | null;
	schema: FormField[];
	formData: LeadFormData;
	/** Inbound caller id as received (may be the literal 'Unknown'). */
	callerPhone: string | null;
	/** The campaign's published script from the same bundle, or null. */
	script: DialerScript | null;
	/** Script → form. Does NOT emit a commit (no echo back into the script). */
	writeField: (key: string, value: unknown) => void;
	updateField: (key: string, update: (value: unknown) => unknown) => void;
}

export type LeadFormCommit =
	| {target: 'form_field'; key: string; value: unknown}
	| {target: 'lead_column'; column: 'name' | 'caller_phone'; value: unknown};

type Listener = (commit: LeadFormCommit) => void;

interface BridgeContextValue {
	view: LeadFormView | null;
	setView: (view: LeadFormView | null) => void;
	emitCommit: (commit: LeadFormCommit) => void;
	subscribeCommit: (listener: Listener) => () => void;
}

const LeadFormBridgeContext = createContext<BridgeContextValue | null>(null);

export function LeadFormBridgeProvider({children}: {children: ReactNode}) {
	const [view, setViewState] = useState<LeadFormView | null>(null);
	const listeners = useRef(new Set<Listener>());

	const setView = useCallback((next: LeadFormView | null) => {
		setViewState(next);
	}, []);
	const emitCommit = useCallback((commit: LeadFormCommit) => {
		for (const l of listeners.current) l(commit);
	}, []);
	const subscribeCommit = useCallback((listener: Listener) => {
		listeners.current.add(listener);
		return () => {
			listeners.current.delete(listener);
		};
	}, []);

	const value = useMemo(
		() => ({view, setView, emitCommit, subscribeCommit}),
		[view, setView, emitCommit, subscribeCommit]
	);
	return (
		<LeadFormBridgeContext.Provider value={value}>
			{children}
		</LeadFormBridgeContext.Provider>
	);
}

export function useLeadFormBridge() {
	const context = useContext(LeadFormBridgeContext);
	if (!context) {
		throw new Error(
			'useLeadFormBridge must be used within LeadFormBridgeProvider'
		);
	}
	return context;
}
