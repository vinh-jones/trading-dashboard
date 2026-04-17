import { JOURNAL_LABEL_ST } from "./journalConstants";
import { theme } from "../../lib/theme";

export function JournalField({ label, children }) {
  return (
    <div style={{ marginBottom: theme.space[3] }}>
      <label style={JOURNAL_LABEL_ST}>{label}</label>
      {children}
    </div>
  );
}
