// pnpm run seed:contacts: upserts the demo contacts the voice agent can email.
// Addresses come from server/.env so personal emails stay out of the repo:
//   DEMO_CONTACT_EMAIL  (default crewmate.0007@gmail.com) for the teammates
//   DEMO_OWNER_EMAIL    your own address (the "Anil" contact)
import { supabase } from '../src/supabase.js';

const team = process.env.DEMO_CONTACT_EMAIL?.trim() || 'crewmate.0007@gmail.com';
const owner = process.env.DEMO_OWNER_EMAIL?.trim() || team;

const contacts = [
  { name: 'Priya Sharma', email: team, slack_handle: 'priya', aliases: ['Priya'] },
  { name: 'Rahul Verma', email: owner, slack_handle: 'rahul', aliases: ['Rahul'] },
  { name: 'Meera Iyer', email: team, slack_handle: 'meera', aliases: ['Meera', 'Mira'] },
  { name: 'Anil Kumar', email: owner, slack_handle: 'anil', aliases: ['Anil', 'me', 'myself'] },
];

const { data, error } = await supabase.from('contacts').upsert(contacts, { onConflict: 'name' }).select('name, email');
if (error) {
  console.error(`Seeding failed: ${error.message}`);
  console.error('Run server/supabase/migrations/002_voice_agent.sql in the Supabase SQL editor first.');
  process.exit(1);
}
for (const c of data) console.log(`  ✓ ${c.name} <${c.email}>`);
process.exitCode = 0;
