/**
 * VITE_BASE_PATH is set at build time when the app is deployed under a sub-path
 * (e.g. /crm). Empty string means the app is at the domain root.
 */
export const BASE_PATH: string = import.meta.env.VITE_BASE_PATH ?? '';
