// ── Source platforms ───────────────────────────────────────────
// Scraping is scoped to Google Reviews only. Re-add other sources here
// (and PLATFORM_ICONS in Dashboard.tsx) if they come back later.
export const PLATFORMS = [
  { id: 'google',      label: 'Google Reviews',  icon: '🔍', available: true,  desc: 'Monitor your Google Business reviews daily' },
  { id: 'trustpilot',  label: 'Trustpilot',       icon: '⭐', available: false, desc: 'Coming soon — Trustpilot review monitoring' },
  { id: 'tripadvisor', label: 'TripAdvisor',      icon: '🦉', available: false, desc: 'Coming soon — TripAdvisor monitoring' },
]
