const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("--- CONTACTS ---");
  const { data: contacts, error: cErr } = await supabaseAdmin.from("contacts").select("*");
  if (cErr) console.error(cErr);
  else console.table(contacts);

  console.log("--- CONVERSATIONS ---");
  const { data: convs, error: vErr } = await supabaseAdmin.from("conversations").select("*");
  if (vErr) console.error(vErr);
  else console.table(convs);

  console.log("--- BRANCHES ---");
  const { data: branches, error: bErr } = await supabaseAdmin.from("branches").select("*");
  if (bErr) console.error(bErr);
  else console.table(branches);
}

main().catch(console.error);
