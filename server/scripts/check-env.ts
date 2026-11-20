// pnpm run check:env: verifies everything the pipeline depends on.
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

async function main() {
  console.log('Environment (server/.env)');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GROQ_API_KEY', 'COMPOSIO_API_KEY']) {
    if (process.env[key]?.trim()) ok(key);
    else bad(`${key} is missing`);
  }
  if (failures) return;

  const { config } = await import('../src/config.js');
  const { supabase } = await import('../src/supabase.js');

  console.log('Supabase');
  for (const table of ['meetings', 'transcript_segments', 'action_items', 'discuss_later', 'knowledge_chunks', 'contacts', 'activity_log', 'pending_actions', 'documents', 'meeting_attachments']) {
    // A real select: HEAD requests report success even for missing tables.
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error) bad(`table ${table}: ${error.message}`);
    else ok(`table ${table}`);
  }
  for (const name of [config.audioBucket, 'documents', config.attachmentsBucket]) {
    const bucket = await supabase.storage.getBucket(name);
    if (bucket.error) bad(`storage bucket "${name}": ${bucket.error.message}`);
    else ok(`storage bucket "${name}"`);
  }
  const rpc = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: JSON.stringify(new Array(384).fill(0.01)),
    match_count: 1,
  });
  if (rpc.error) bad(`function match_knowledge_chunks: ${rpc.error.message}`);
  else ok('function match_knowledge_chunks');
  if (failures) console.log('  → Run server/supabase/migrations/001_init.sql 002_voice_agent.sql and 003_web_app.sql in the Supabase SQL editor.');

  console.log('Groq');
  const models = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
  });
  if (!models.ok) bad(`API key rejected (${models.status})`);
  else {
    const ids = ((await models.json()) as { data: { id: string }[] }).data.map((m) => m.id);
    for (const model of [config.whisperModel, ...config.extractModels, ...config.voiceModels]) {
      if (ids.includes(model)) ok(`model ${model}`);
      else bad(`model ${model} not available to this key`);
    }
  }

  console.log('Composio');
  const { isToolkitConnected } = await import('../src/composio.js');
  for (const toolkit of ['googledocs', 'gmail', 'googlecalendar', 'slack', 'googlesheets']) {
    try {
      if (await isToolkitConnected(toolkit)) ok(`${toolkit} connected for user "${config.composioUserId}"`);
      else bad(`${toolkit} not connected for user "${config.composioUserId}" (run hack-kit: pnpm tsx src/connect-toolkit.ts ${toolkit})`);
    } catch (err) {
      bad(`Composio ${toolkit}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('Voice agent');
  if (config.voiceApiKey) ok('VOICE_LLM_API_KEY set');
  else bad('VOICE_LLM_API_KEY is empty: /v1/chat/completions is disabled');

  console.log('Local tools');
  if (ffmpegPath && fs.existsSync(ffmpegPath as unknown as string)) ok('ffmpeg (for chunking long recordings)');
  else bad('ffmpeg-static binary missing; run pnpm install in server/');
}

main()
  .catch((err) => bad(err instanceof Error ? err.message : String(err)))
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
    process.exit(failures ? 1 : 0);
  });
