const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verify() {
  console.log('🔍 Checking Supabase for the AI reply...');
  
  // 1. Find the conversation for our test number
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id, name')
    .eq('phone', '923001234567')
    .single();

  if (convError || !conv) {
    console.log('❌ No conversation found for test number.');
    return;
  }

  console.log(`✅ Found conversation for: ${conv.name}`);

  // 2. Get the latest message (should be the AI reply)
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(2);

  if (msgError || !messages || messages.length === 0) {
    console.log('❌ No messages found.');
    return;
  }

  console.log('\n--- Recent Chat ---');
  messages.reverse().forEach(m => {
    console.log(`[${m.role.toUpperCase()}] ${m.content}`);
  });
  console.log('-------------------\n');

  if (messages.some(m => m.role === 'assistant')) {
    console.log('✨ SUCCESS: AI responded and saved to database!');
  } else {
    console.log('⏳ Still waiting for AI or something went wrong?');
  }
}

verify().catch(console.error);
