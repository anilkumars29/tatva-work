// pnpm run seed:contacts: upserts the demo contacts the voice agent and app use.
// Addresses come from server/.env so personal emails stay out of the repo:
//   DEMO_CONTACT_EMAIL  (default crewmate.0007@gmail.com) for the teammates
//   DEMO_OWNER_EMAIL    your own address (the "Anil K." contact)
import { supabase } from '../src/supabase.js';

const team = process.env.DEMO_CONTACT_EMAIL?.trim() || 'crewmate.0007@gmail.com';
const owner = process.env.DEMO_OWNER_EMAIL?.trim() || team;

const contacts = [
  { name: 'Priya Sharma', email: team, slack_handle: 'priya', role: 'Vendor Manager', aliases: ['Priya'] },
  { name: 'Rahul Das', email: team, slack_handle: 'rahul', role: 'Engineering Lead', aliases: ['Rahul'] },
  { name: 'Meera Nair', email: team, slack_handle: 'meera', role: 'Finance', aliases: ['Meera', 'Mira'] },
  { name: 'Anil K.', email: owner, slack_handle: 'anil', role: 'Project Lead', aliases: ['Anil', 'Anil Kumar', 'me', 'myself'] },
];

// Earlier demo names (Milestone 3) are replaced by the ones above.
const retired = ['Rahul Verma', 'Meera Iyer', 'Anil Kumar'];
const removed = await supabase.from('contacts').delete().in('name', retired).select('name');
if (removed.error) {
  console.error(`Seeding failed: ${removed.error.message}`);
  process.exit(1);
}
for (const c of removed.data) console.log(`  - removed ${c.name}`);

const { data, error } = await supabase.from('contacts').upsert(contacts, { onConflict: 'name' }).select('name, email, role');
if (error) {
  console.error(`Seeding failed: ${error.message}`);
  console.error('Run server/supabase/migrations/002_voice_agent.sql and 003_web_app.sql in the Supabase SQL editor first.');
  process.exit(1);
}
for (const c of data) console.log(`  ✓ ${c.name} (${c.role}) <${c.email}>`);
process.exitCode = 0;
