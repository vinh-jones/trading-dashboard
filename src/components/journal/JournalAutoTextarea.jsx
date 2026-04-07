import { JOURNAL_INPUT_ST } from "./journalConstants";

export function JournalAutoTextarea({ value, onChange, minH, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      onInput={e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
      placeholder={placeholder}
      style={{ ...JOURNAL_INPUT_ST, minHeight: minH, resize: "none", lineHeight: 1.6 }}
    />
  );
}
