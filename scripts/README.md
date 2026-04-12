# Menu Processing Tools

This directory contains standalone tools for processing menu images and managing menu data for the Tandoori Agent system.

## Scripts Overview

### 1. `process-menu.js` - Menu Image Processor
Processes menu images using AI and generates structured menu data.

**Usage:**
```bash
node scripts/process-menu.js <image-url> [output-file]
```

**Example:**
```bash
node scripts/process-menu.js https://example.com/menu.jpg menu-data.json
```

**What it does:**
- Takes a menu image URL
- Uses AI to extract menu items, prices, and categories
- Validates and cleans the data
- Saves structured JSON data to a file
- Provides processing statistics and sample output

### 2. `validate-menu.js` - Menu Data Validator
Validates menu data JSON files to ensure they meet system requirements.

**Usage:**
```bash
node scripts/validate-menu.js <menu-data-file>
```

**Example:**
```bash
node scripts/validate-menu.js menu-data.json
```

**What it does:**
- Checks data structure and required fields
- Validates item names, prices, and categories
- Reports errors and warnings
- Provides summary statistics
- Ensures data is ready for upload

### 3. `upload-menu.js` - Menu Data Uploader
Uploads validated menu data to the Tandoori Agent database.

**Usage:**
```bash
node scripts/upload-menu.js <menu-data-file> [branch-id]
```

**Example:**
```bash
node scripts/upload-menu.js menu-data.json branch-123
```

**What it does:**
- Loads and validates menu data
- Clears existing menu items for the branch
- Inserts new menu items into the database
- Provides upload confirmation and statistics

## Complete Workflow

1. **Process a menu image:**
   ```bash
   node scripts/process-menu.js https://example.com/menu.jpg menu-data.json
   ```

2. **Validate the processed data:**
   ```bash
   node scripts/validate-menu.js menu-data.json
   ```

3. **Upload to the system:**
   ```bash
   node scripts/upload-menu.js menu-data.json
   ```

## Environment Setup

Make sure you have the required environment variables set in your `.env.local` file:

```env
# Supabase Configuration (required for upload)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI API Keys (required for processing)
OPENROUTER_API_KEY=your_openrouter_key
GOOGLE_AI_API_KEY=your_google_ai_key
```

## Menu Data Format

The processed menu data follows this JSON structure:

```json
{
  "metadata": {
    "processed_at": "2024-01-01T00:00:00.000Z",
    "image_url": "https://example.com/menu.jpg",
    "total_items": 25,
    "categories": ["Appetizers", "Main Course", "Desserts"],
    "source": "ai_processed"
  },
  "items": [
    {
      "name": "Chicken Karahi",
      "price": 850,
      "category": "Main Course",
      "description": "Traditional Pakistani chicken curry",
      "is_available": true,
      "sort_order": 0
    }
  ]
}
```

## Troubleshooting

### Common Issues

1. **"AI returned malformed JSON"**
   - The AI response was truncated or corrupted
   - Try with a different image or adjust the AI prompt
   - Check AI API rate limits

2. **"File not found"**
   - Ensure the image URL is accessible
   - Check network connectivity
   - Verify the URL format

3. **"Invalid menu data format"**
   - Run the validator script to check for issues
   - Ensure the JSON file is properly formatted

4. **"Failed to upload menu"**
   - Check Supabase credentials
   - Ensure the branch ID exists
   - Verify database permissions

### Getting Help

If you encounter issues:

1. Run the validation script to check your data
2. Check the console output for detailed error messages
3. Ensure all environment variables are set
4. Try with a simpler menu image first

## Integration with Main App

These scripts are designed to work independently of the main application, allowing you to:

- Test menu processing without affecting the live system
- Process menus in batch
- Debug AI processing issues
- Prepare menu data for deployment

Once uploaded, the menu data will be available through the regular WhatsApp bot interface.