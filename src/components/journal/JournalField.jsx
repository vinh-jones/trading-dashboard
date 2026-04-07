import { JOURNAL_LABEL_ST } from "./journalConstants";

export function JournalField({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={JOURNAL_LABEL_ST}>{label}</label>
      {children}
    </div>
  );
}
