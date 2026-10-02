import { app } from './fr.app';
import { common } from './fr.common';

/** French dictionary: English source string -> French. Missing keys fall back to English. */
export const fr: Record<string, string> = { ...common, ...app };
