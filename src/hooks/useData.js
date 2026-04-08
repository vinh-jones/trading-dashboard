import { createContext, useContext } from "react";

export const DataContext = createContext(null);
export function useData() { return useContext(DataContext); }
