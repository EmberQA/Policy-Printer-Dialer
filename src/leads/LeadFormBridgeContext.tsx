/**
 * Lead-form → call-script-doc bridge (ENG-298).
 *
 * LeadForm stays the source of truth for form_data (same pattern as
 * LeadNotesContext): it PUBLISHES its schema + current values so the call
 * script doc (src/scriptDoc) can show linked blanks. Read-only — the script
 * doc never writes back into the form.
 */

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode
} from 'react';
import type {FormField} from '@/lib/api';
import type {LeadFormData} from './FormRenderer';

/** What LeadForm publishes while a form is mounted. */
export interface LeadFormView {
	schema: FormField[];
	formData: LeadFormData;
}

interface BridgeContextValue {
	view: LeadFormView | null;
	setView: (view: LeadFormView | null) => void;
}

const LeadFormBridgeContext = createContext<BridgeContextValue | null>(null);

export function LeadFormBridgeProvider({children}: {children: ReactNode}) {
	const [view, setViewState] = useState<LeadFormView | null>(null);

	const setView = useCallback((next: LeadFormView | null) => {
		setViewState(next);
	}, []);

	const value = useMemo(() => ({view, setView}), [view, setView]);
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
