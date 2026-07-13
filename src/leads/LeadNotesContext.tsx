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
  type ReactNode,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

export function LeadNotesProvider({ children }: { children: ReactNode }) {
  const [note, setNote] = useState<ActiveLeadNote | null>(null);
  const setActiveNote = useCallback((next: ActiveLeadNote | null) => {
    setNote(next);
  }, []);
  return (
    <LeadNotesContext.Provider value={{ note, setNote: setActiveNote }}>
      {children}
    </LeadNotesContext.Provider>
  );
}

export function useLeadNotes() {
  const context = useContext(LeadNotesContext);
  if (!context) {
    throw new Error("useLeadNotes must be used within LeadNotesProvider");
  }
  return context;
}

/** Renders only while the active lead form has a `note` or `notes` field. */
export function LeadNotesPanel() {
  const { note } = useLeadNotes();
  if (!note) return null;
  const id = `active-lead-${note.key}`;
  return (
    <Card className="xl:sticky xl:top-28 shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle>{note.label || "Notes"}</CardTitle>
        <p className="text-sm leading-5 text-muted-foreground">
          Notes are saved with this lead.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Label htmlFor={id} className="sr-only">
          {note.label || "Notes"}
        </Label>
        <Textarea
          id={id}
          value={note.value}
          onChange={(event) => note.onChange(event.target.value)}
          placeholder="Write notes for this lead…"
          className="min-h-[26rem] resize-y leading-6"
        />
      </CardContent>
    </Card>
  );
}
