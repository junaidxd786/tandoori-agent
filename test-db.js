const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const query = supabaseAdmin
    .from("conversations")
    .select(`
      id,
      branch_id,
      phone,
      name,
      mode,
      has_unread,
      updated_at,
      created_at,
      branches (id, name, slug, address),
      conversation_states (
        workflow_step,
        order_type,
        address,
        guests,
        reservation_time,
        cart,
        last_error
      ),
      user_sessions (
        active_node,
        status,
        is_bot_active,
        invalid_step_count,
        escalation_reason,
        escalated_at
      ),
      messages (
        content,
        role,
        sender_kind,
        delivery_status,
        created_at
      )
    `)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false, foreignTable: "messages" })
    .limit(1, { foreignTable: "messages" })
    .range(0, 10);

  const { data, error } = await query;
  if (error) {
    console.error("DB Error:", error);
  } else {
    console.log("Success! Data:", data);
  }
}

main().catch(console.error);
