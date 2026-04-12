#!/usr/bin/env node

/**
 * Menu Data Validator
 *
 * Validates menu data JSON files to ensure they meet the requirements
 * for uploading to the Tandoori Agent system.
 *
 * Usage:
 *   node scripts/validate-menu.js <menu-data-file>
 *
 * Example:
 *   node scripts/validate-menu.js menu-data.json
 */

import { readFileSync } from 'fs';

function validateMenuData(data) {
  const errors = [];
  const warnings = [];

  // Check basic structure
  if (!data.metadata) {
    errors.push('Missing metadata section');
  }

  if (!Array.isArray(data.items)) {
    errors.push('Items must be an array');
    return { valid: false, errors, warnings };
  }

  if (data.items.length === 0) {
    errors.push('No menu items found');
    return { valid: false, errors, warnings };
  }

  // Validate each item
  data.items.forEach((item, index) => {
    const itemNum = index + 1;

    // Required fields
    if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
      errors.push(`Item ${itemNum}: Missing or invalid name`);
    }

    if (item.price === null || item.price === undefined) {
      warnings.push(`Item ${itemNum}: Missing price`);
    } else if (typeof item.price !== 'number' || item.price < 0) {
      errors.push(`Item ${itemNum}: Invalid price (must be a positive number)`);
    }

    // Optional but recommended fields
    if (!item.category || typeof item.category !== 'string') {
      warnings.push(`Item ${itemNum}: Missing or invalid category`);
    }

    // Check for reasonable lengths
    if (item.name && item.name.length > 100) {
      warnings.push(`Item ${itemNum}: Name is very long (${item.name.length} chars)`);
    }

    if (item.category && item.category.length > 50) {
      warnings.push(`Item ${itemNum}: Category is very long (${item.category.length} chars)`);
    }

    if (item.description && item.description.length > 200) {
      warnings.push(`Item ${itemNum}: Description is very long (${item.description.length} chars)`);
    }
  });

  // Check for duplicates
  const names = data.items.map(item => item.name?.toLowerCase().trim()).filter(Boolean);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    warnings.push(`Duplicate item names found: ${[...new Set(duplicates)].join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      totalItems: data.items.length,
      categories: [...new Set(data.items.map(item => item.category).filter(Boolean))],
      priceRange: data.items
        .map(item => item.price)
        .filter(price => typeof price === 'number')
        .reduce((range, price) => ({
          min: Math.min(range.min, price),
          max: Math.max(range.max, price)
        }), { min: Infinity, max: -Infinity })
    }
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scripts/validate-menu.js <menu-data-file>');
    console.error('Example: node scripts/validate-menu.js menu-data.json');
    process.exit(1);
  }

  const filePath = args[0];

  try {
    console.log('🔍 Validating menu data...');
    console.log(`📄 File: ${filePath}`);

    const fileContent = readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);

    const result = validateMenuData(data);

    console.log(`\n📊 Validation Results:`);
    console.log(`✅ Valid: ${result.valid ? 'Yes' : 'No'}`);
    console.log(`📦 Total Items: ${result.summary.totalItems}`);
    console.log(`📂 Categories: ${result.summary.categories.join(', ')}`);

    if (result.summary.priceRange.min !== Infinity) {
      console.log(`💰 Price Range: Rs. ${result.summary.priceRange.min} - Rs. ${result.summary.priceRange.max}`);
    }

    if (result.errors.length > 0) {
      console.log(`\n❌ Errors (${result.errors.length}):`);
      result.errors.forEach(error => console.log(`  • ${error}`));
    }

    if (result.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${result.warnings.length}):`);
      result.warnings.forEach(warning => console.log(`  • ${warning}`));
    }

    if (result.valid) {
      console.log('\n🎉 Menu data is valid and ready for upload!');
    } else {
      console.log('\n❌ Menu data has errors that need to be fixed before upload.');
      process.exit(1);
    }

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`❌ File not found: ${filePath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`❌ Invalid JSON in file: ${filePath}`);
      console.error(`   ${error.message}`);
    } else {
      console.error('❌ Error validating menu data:', error.message);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});