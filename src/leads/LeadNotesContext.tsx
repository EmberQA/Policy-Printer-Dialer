/**
 * Shared live note field for the Dial layout. LeadForm remains the source of
 * truth for form_data; this context only lets its notes/note field render in the
 * prominent left-side panel while preserving the exact same saved value.
 */

import {
	createContext,
	useCallback,
	useContext,
	useState,
	type ReactNode
} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';

export interface ActiveLeadNote {
	key: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
}

const LeadNotesContext = createContext<{
	note: ActiveLeadNote | null;
	setNote: (note: ActiveLeadNote | null) => void;
} | null>(null);

export function LeadNotesProvider({children}: {children: ReactNode}) {
	const [note, setNote] = useState<ActiveLeadNote | null>(null);
	const setActiveNote = useCallback((next: ActiveLeadNote | null) => {
		setNote(next);
	}, []);
	return (
		<LeadNotesContext.Provider value={{note, setNote: setActiveNote}}>
			{children}
		</LeadNotesContext.Provider>
	);
}

export function useLeadNotes() {
	const context = useContext(LeadNotesContext);
	if (!context) {
		throw new Error('useLeadNotes must be used within LeadNotesProvider');
	}
	return context;
}

/** Renders only while the active lead form has a `note` or `notes` field. */
export function LeadNotesPanel() {
	const {note, setNote} = useLeadNotes();
	if (!note) return null;
	const id = `active-lead-${note.key}`;
	return (
		<Card className="shadow-xs">
			<CardHeader className="gap-0.5 px-4 pb-2 pt-3">
				<CardTitle className="text-base">{note.label || 'Notes'}</CardTitle>
				<p className="text-xs leading-4 text-muted-foreground">
					Notes are saved with this lead.
				</p>
			</CardHeader>
			<CardContent className="px-4 pb-4 pt-0">
				<Label htmlFor={id} className="sr-only">
					{note.label || 'Notes'}
				</Label>
				<Textarea
					id={id}
					value={note.value}
					onChange={(event) => {
						const value = event.target.value;
						// Update the controlled input in the same event as the keystroke.
						// Waiting for LeadForm's effect to echo it back restores stale text.
						setNote({...note, value});
						note.onChange(value);
					}}
					placeholder="Write notes for this lead…"
					className="h-32 min-h-32 max-h-32 field-sizing-fixed resize-none overflow-y-auto leading-6"
				/>
			</CardContent>
		</Card>
	);
}
