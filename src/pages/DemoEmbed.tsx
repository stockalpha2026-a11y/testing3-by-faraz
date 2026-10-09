import Dashboard from './Dashboard'

// Read-only demo dashboard (The Coffee Concept, sample data) shown inside /admin.
// It uses a fixed demo user and never touches the real sign-in, so the admin stays signed in.
export default function DemoEmbed() {
  return <Dashboard demoMode />
}
