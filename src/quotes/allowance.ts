/**
 * ENG-308 monthly quote allowance, as last reported by the backend (open, Run
 * quote, Quote Compare all return `quote_allowance`). A tiny module store so the
 * Quoter and Compare tabs show the same count without prop-drilling.
 */
import {useSyncExternalStore} from 'react';

export interface QuoteAllowance {
	unlimited: boolean;
	limit: number;
	used: number;
	remaining: number;
}

let current: QuoteAllowance | null = null;
const listeners = new Set<() => void>();

export const setQuoteAllowance = (next: QuoteAllowance | null | undefined): void => {
	if (!next) return;
	current = next;
	listeners.forEach((listener) => listener());
};

export const useQuoteAllowance = (): QuoteAllowance | null =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current
	);
