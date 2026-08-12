// Shared scheduler constants — this file has NO "use client" directive on
// purpose: page.tsx (server) and scheduler-grid.tsx (client) both import
// from here. Importing a value from a "use client" module into a server
// component hands you a client-reference proxy, not the value — that turned
// the entries query window into NaN dates and blanked the whole scheduler
// (2026-08-13).

// The mobile agenda scrolls continuously through this many days either side
// of the focused week (±4 weeks). page.tsx widens its entries query by the
// same amount so every visible day has its data.
export const AGENDA_WINDOW_DAYS = 28;
