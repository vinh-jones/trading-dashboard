// Shared localStorage toggle for the Pipeline Detail panel.
// Both dashboards listen on 'tw-pipeline-detail' — emitting this event
// from the focus/gauge "DETAIL →" button opens the panel on the Review tab.
const KEY = "tw-pipeline-detail-open";

export function getPipelineDetailOpen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPipelineDetailOpen(open) {
  try {
    localStorage.setItem(KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable — silent fallback */
  }
}
