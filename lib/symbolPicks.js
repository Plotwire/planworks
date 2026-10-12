// How an account's Symbol Library ticks are stored in its settings
// (user_settings.data.symbolLibrary). Kept apart from lib/symbolLibrary.js so
// code that only saves the ticks (AppShell) doesn't load every symbol drawing.
export const settingsFromPicks = (picks) => ({ picks: [...new Set(picks)], v: 1 });
