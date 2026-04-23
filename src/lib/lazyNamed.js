import { lazy } from "react";

// React.lazy expects a module with a `default` export. This codebase uses
// named exports for components, so wrap the loader to re-shape the module.
export function lazyNamed(loader, exportName) {
  return lazy(() => loader().then(m => ({ default: m[exportName] })));
}
