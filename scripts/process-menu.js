#!/usr/bin/env node

/**
 * Standalone Menu Processing Tool
 *
 * This tool processes menu images using AI and generates menu data
 * that can be uploaded to the Tandoori Agent system.
 *
 * Usage:
 *   node scripts/process-menu.js <image-url> [output-file]
 *
 * Example:
 *   node scripts/process-menu.js https://example.com/menu.jpg menu-data.json
 *
 * Environment Variables Required:
 *   - OPENROUTER_API_KEY or GOOGLE_AI_API_KEY
 */

import { writeFileSync } from 'fs';
import OpenAI from 'openai';

// Initialize AI clients
const openRouterClient = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    })
  : null;

const googleClient = process.env.GOOGLE_AI_API_KEY
  ? new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: process.env.GOOGLE_AI_API_KEY,
    })
  : null;

if (!openRouterClient && !googleClient) {
  console.error('❌ No AI API keys found!');
  console.error('Please set one of these environment variables:');
  console.error('  OPENROUTER_API_KEY');
  console.error('  GOOGLE_AI_API_KEY');
  process.exit(1);
}

async function processMenuImage(imageUrl) {
  const targetClient = googleClient || openRouterClient;
  const targetModel = googleClient ? "gemini-2.0-flash" : "google/gemini-2.0-flash-001";

  const clients = [
    { client: googleClient, model: "gemini-2.0-flash", name: "google" },
    { client: openRouterClient, model: "google/gemini-2.0-flash-001", name: "openrouter" },
  ].filter(c => c.client);

  for (const { client, model, name } of clients) {
    try {
      console.log(`[menu/process] Trying ${name} client with model ${model}`);
      const completion = await client.chat.completions.create({
        model: model,
        max_tokens: 4000,
        messages: [
          {
            role: "system",
            content: `You are a professional menu digitizer for a restaurant.

Extract every menu item visible in this image.

Rules:
1. Strip numbering from the item name.
2. Keep portion or size details when present.
3. Preserve the visible category heading when possible, but keep category names concise (under 24 characters when possible).
4. Return price as a plain number with no currency symbol.
5. If price is unreadable, return null. Never guess.
6. Return JSON only in this shape: { "items": [ { "name": "...", "price": 850, "category": "..." } ] }`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Parse this menu image into JSON." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";

      // Robust JSON parsing
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseError) {
        console.error("[menu/process] JSON parse error:", parseError);
        console.error("[menu/process] Raw response:", raw.slice(0, 500) + (raw.length > 500 ? "..." : ""));

        // Try to fix common JSON issues
        const fixedJson = fixMalformedJson(raw);
        if (fixedJson) {
          try {
            parsed = JSON.parse(fixedJson);
            console.log("[menu/process] Successfully fixed malformed JSON");
          } catch (fixError) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error(`AI returned malformed JSON: ${errorMessage}`);
          }
        } else {
          const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
          throw new Error(`AI returned malformed JSON: ${errorMessage}`);
        }
      }

      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.items)) return parsed.items;

      const fallbackArray = Object.values(parsed).find((value) => Array.isArray(value));
      if (Array.isArray(fallbackArray)) return fallbackArray;

      throw new Error("The AI returned an unexpected menu format.");
    } catch (error) {
      console.warn(`[menu/process] ${name} client failed:`, error.message);
      if (name === "openrouter" && clients.length === 1) {
        throw error;
      }
    }
  }

  throw new Error("All AI clients failed to process the menu image");
}

// Helper function to fix common JSON malformations
function fixMalformedJson(jsonString) {
  if (!jsonString || jsonString.trim() === "") return null;

  let fixed = jsonString.trim();

  // Remove any trailing commas before closing braces/brackets
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // Fix unterminated strings by adding closing quotes
  const lines = fixed.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) {
      lines[i] = line + '"';
    }
  }
  fixed = lines.join('\n');

  // Try to close unterminated objects/arrays
  const openBraces = (fixed.match(/{/g) || []).length;
  const closeBraces = (fixed.match(/}/g) || []).length;
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;

  for (let i = 0; i < openBraces - closeBraces; i++) {
    fixed += '}';
  }

  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    fixed += ']';
  }

  try {
    JSON.parse(fixed);
    return fixed;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scripts/process-menu.js <image-url> [output-file]');
    console.error('Example: node scripts/process-menu.js https://example.com/menu.jpg menu-data.json');
    console.error('\nRequired environment variables:');
    console.error('  OPENROUTER_API_KEY or GOOGLE_AI_API_KEY');
    process.exit(1);
  }

  const imageUrl = args[0];
  const outputFile = args[1] || 'menu-data.json';

  console.log('🖼️  Processing menu image...');
  console.log(`📍 Image URL: ${imageUrl}`);
  console.log(`📄 Output file: ${outputFile}`);

  try {
    const menuItems = await processMenuImage(imageUrl);

    console.log(`✅ Successfully processed ${menuItems.length} menu items`);

    // Validate and clean the menu data
    const cleanedItems = menuItems.map((item, index) => {
      const cleaned = {
        name: String(item.name || '').trim(),
        price: typeof item.price === 'number' ? item.price : (typeof item.price === 'string' ? parseFloat(item.price) : null),
        category: String(item.category || 'General').trim(),
        description: item.description ? String(item.description).trim() : null,
        is_available: true,
        sort_order: index
      };

      if (!cleaned.name) {
        console.warn(`⚠️  Item ${index + 1} missing name, skipping`);
        return null;
      }

      return cleaned;
    }).filter(Boolean);

    console.log(`📊 Final menu data: ${cleanedItems.length} valid items`);

    const categories = [...new Set(cleanedItems.map(item => item.category))];
    console.log(`📂 Categories found: ${categories.join(', ')}`);

    const outputData = {
      metadata: {
        processed_at: new Date().toISOString(),
        image_url: imageUrl,
        total_items: cleanedItems.length,
        categories: categories,
        source: 'ai_processed'
      },
      items: cleanedItems
    };

    writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`💾 Menu data saved to: ${outputFile}`);

    console.log('\n📋 Sample items:');
    cleanedItems.slice(0, 5).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.name} - Rs. ${item.price} (${item.category})`);
    });

    if (cleanedItems.length > 5) {
      console.log(`  ... and ${cleanedItems.length - 5} more items`);
    }

    console.log('\n🎉 Menu processing complete!');
    console.log(`\nNext steps:`);
    console.log(`1. Validate: npm run menu:validate ${outputFile}`);
    console.log(`2. Upload: npm run menu:upload ${outputFile}`);

  } catch (error) {
    console.error('❌ Error processing menu:', error.message);
    console.error('\n🔍 Troubleshooting tips:');
    console.error('1. Check that the image URL is accessible');
    console.error('2. Ensure AI API keys are configured');
    console.error('3. Try with a different image');
    console.error('4. Check the console logs for detailed error information');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});