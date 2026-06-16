"use client";

import { createContext, useContext } from "react";

/**
 * Whether estimated $ values are revealed. Off by default — the user opts in via
 * a button so we never show unrequested value figures. Read with useValuesShown().
 */
const ValuesShownContext = createContext<boolean>(false);

export const ValuesShownProvider = ValuesShownContext.Provider;

export function useValuesShown(): boolean {
  return useContext(ValuesShownContext);
}
