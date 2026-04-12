#!/usr/bin/env node

/**
 * Menu Upload Tool
 *
 * Uploads validated menu data to the Tandoori Agent system.
 *
 * Usage:
 *   node scripts/upload-menu.js <menu-data-file> [branch-id]
 *
 * Environment Variables Required:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Example:
 *   node scripts/upload-menu.js menu-data.json branch-123
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  console.error('\nPlease set these in your .env.local file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadMenuData(menuData, branchId) {
  console.log('📤 Uploading menu data...');

  const { items, metadata } = menuData;

  // Prepare menu items for database
  const menuItems = items.map(item => ({
    branch_id: branchId,
    name: item.name,
    price: item.price,
    category: item.category || 'General',
    description: item.description,
    is_available: item.is_available !== false,
    sort_order: item.sort_order || 0
  }));

  // First, clear existing menu items for this branch
  console.log('🧹 Clearing existing menu items...');
  const { error: deleteError } = await supabase
    .from('menu_items')
    .delete()
    .eq('branch_id', branchId);

  if (deleteError) {
    throw new Error(`Failed to clear existing menu: ${deleteError.message}`);
  }

  // Insert new menu items
  console.log(`📝 Inserting ${menuItems.length} menu items...`);
  const { error: insertError } = await supabase
    .from('menu_items')
    .insert(menuItems);

  if (insertError) {
    throw new Error(`Failed to insert menu items: ${insertError.message}`);
  }

  // Update metadata if needed
  console.log('📊 Menu upload complete!');
  return {
    uploaded: menuItems.length,
    categories: [...new Set(menuItems.map(item => item.category))]
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scripts/upload-menu.js <menu-data-file> [branch-id]');
    console.error('Example: node scripts/upload-menu.js menu-data.json branch-123');
    console.error('\nIf branch-id is not provided, it will try to use the first available branch.');
    process.exit(1);
  }

  const filePath = args[0];
  let branchId = args[1];

  try {
    console.log('📂 Loading menu data...');
    const fileContent = readFileSync(filePath, 'utf8');
    const menuData = JSON.parse(fileContent);

    // Validate basic structure
    if (!menuData.items || !Array.isArray(menuData.items)) {
      throw new Error('Invalid menu data format: missing items array');
    }

    console.log(`📋 Found ${menuData.items.length} menu items`);

    // Get branch ID if not provided
    if (!branchId) {
      console.log('🔍 Finding available branches...');
      const { data: branches, error: branchError } = await supabase
        .from('branches')
        .select('id, name')
        .limit(1);

      if (branchError) {
        throw new Error(`Failed to fetch branches: ${branchError.message}`);
      }

      if (!branches || branches.length === 0) {
        throw new Error('No branches found. Please create a branch first or specify a branch ID.');
      }

      branchId = branches[0].id;
      console.log(`📍 Using branch: ${branches[0].name} (${branchId})`);
    }

    // Upload the menu data
    const result = await uploadMenuData(menuData, branchId);

    console.log('\n🎉 Menu upload successful!');
    console.log(`📦 Uploaded: ${result.uploaded} items`);
    console.log(`📂 Categories: ${result.categories.join(', ')}`);
    console.log(`🏪 Branch ID: ${branchId}`);

    console.log('\n💡 Next steps:');
    console.log('1. Test the menu by sending "menu" to your WhatsApp bot');
    console.log('2. Verify that all categories and items appear correctly');
    console.log('3. Check that prices are displayed properly');

  } catch (error) {
    console.error('❌ Error uploading menu:', error.message);
    console.error('\n🔍 Troubleshooting tips:');
    console.error('1. Ensure the menu data file is valid JSON');
    console.error('2. Check that your Supabase credentials are correct');
    console.error('3. Verify that the branch ID exists');
    console.error('4. Run the validation script first: node scripts/validate-menu.js <file>');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});