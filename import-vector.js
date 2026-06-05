/**
 * import-vector.js
 * ────────────────
 * Reads a CSV and imports rows into global_vector_cache with embeddings.
 *
 * CSV format (required header row):
 *   account_name,keywords,template_account_name
 *
 *   account_name          — human label for this entry (not stored, just for your reference)
 *   keywords              — the text that gets embedded and stored as clean_name
 *   template_account_name — must match account_name in coa_templates exactly
 *
 * Usage:
 *   node import-vector.js                      ← uses vector-data.csv by default
 *   node import-vector.js my-data.csv
 *
 * Setup:
 *   - backend/.env must have SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - ML service must be running (set ML_SERVICE_URL in .env or below)
 */

'use strict';

require('dotenv').config({ path: './backend/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:5000';
const BATCH_SIZE = 50;   // rows per embedding batch call
const DRY_RUN = process.argv.includes('--dry-run');   // --dry-run to preview without inserting
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Minimal CSV parser (no extra deps needed) ─────────────────────────────────
function parseCSV(content) {
  const lines = content.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());

  const required = ['account_name', 'keywords', 'template_account_name'];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new Error(`CSV missing required column: "${col}". Header found: ${header.join(', ')}`);
    }
  }

  return lines.slice(1).map((line, i) => {
    // Handle quoted fields with commas
    const values = [];
    let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur.trim());

    if (values.length < header.length) {
      throw new Error(`Row ${i + 2}: expected ${header.length} columns, got ${values.length}`);
    }

    const row = {};
    header.forEach((h, idx) => { row[h] = values[idx] || ''; });
    return row;
  });
}

// ── Chunk array into batches ──────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env');
    process.exit(1);
  }

  // ── 1. Load CSV ─────────────────────────────────────────────────────────────
  const csvFile = process.argv.find(a => a.endsWith('.csv'))
    ? path.resolve(process.argv.find(a => a.endsWith('.csv')))
    : path.join(__dirname, 'vector-data.csv');

  if (!fs.existsSync(csvFile)) {
    console.error(`❌  File not found: ${csvFile}`);
    console.error('\n    Expected CSV format:');
    console.error('    account_name,keywords,template_account_name');
    console.error('    "Fast Food","fast food burger pizza fried chicken takeaway","Food & Dining"');
    process.exit(1);
  }

  let rows;
  try {
    rows = parseCSV(fs.readFileSync(csvFile, 'utf8'));
  } catch (e) {
    console.error('❌  CSV parse error:', e.message);
    process.exit(1);
  }
  console.log(`\n📂  Loaded ${rows.length} row(s) from ${path.basename(csvFile)}`);

  // ── 2. Validate — no empty keywords ─────────────────────────────────────────
  const invalid = rows.filter((r, i) => {
    if (!r.keywords.trim()) return console.error(`  ⚠️  Row ${i + 2}: empty keywords — skipping`) || true;
    if (!r.template_account_name.trim()) return console.error(`  ⚠️  Row ${i + 2}: empty template_account_name — skipping`) || true;
  });
  rows = rows.filter(r => r.keywords.trim() && r.template_account_name.trim());

  if (rows.length === 0) {
    console.error('❌  No valid rows to process.');
    process.exit(1);
  }

  // ── 3. Fetch coa_templates — build name → id map ────────────────────────────
  console.log('📋  Fetching COA templates from Supabase...');
  const { data: templates, error: tplErr } = await supabase
    .from('coa_templates')
    .select('template_id, account_name');

  if (tplErr) {
    console.error('❌  Failed to fetch coa_templates:', tplErr.message);
    process.exit(1);
  }

  const templateMap = {};
  templates.forEach(t => { templateMap[t.account_name.trim().toLowerCase()] = t.template_id; });
  console.log(`    Found ${templates.length} templates.`);

  // ── 4. Resolve template_id for each row ─────────────────────────────────────
  const resolved = [], unmatched = [];
  for (const row of rows) {
    const key = row.template_account_name.trim().toLowerCase();
    const id = templateMap[key];
    if (!id) { unmatched.push(row.template_account_name); continue; }
    resolved.push({ ...row, template_id: id });
  }

  if (unmatched.length > 0) {
    console.warn(`\n⚠️   Could not find template for ${unmatched.length} row(s):`);
    [...new Set(unmatched)].forEach(n => console.warn(`      - "${n}"`));
    console.warn('    These rows will be skipped. Check spelling against coa_templates.account_name.\n');
  }

  if (resolved.length === 0) {
    console.error('❌  No rows matched a template. Nothing to insert.');
    process.exit(1);
  }
  console.log(`✅  ${resolved.length} row(s) matched to templates.`);

  if (DRY_RUN) {
    console.log('\n🔍  DRY RUN — rows that would be inserted:');
    resolved.forEach(r =>
      console.log(`  template_id=${r.template_id}  clean_name="${r.keywords}"  (${r.account_name})`)
    );
    console.log('\nRe-run without --dry-run to insert.');
    return;
  }

  // ── 5. Generate embeddings in batches ───────────────────────────────────────
  console.log(`\n🤖  Generating embeddings via ML service at ${ML_URL}...`);
  const batches = chunk(resolved, BATCH_SIZE);
  const withEmbed = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`    Batch ${i + 1}/${batches.length} (${batch.length} rows)... `);

    let res, data;
    try {
      res = await fetch(`${ML_URL}/embed/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: batch.map(r => r.keywords) }),
      });
      data = await res.json();
    } catch (e) {
      console.error(`\n❌  ML service request failed: ${e.message}`);
      console.error('    Is the ML service running?');
      process.exit(1);
    }

    if (!res.ok || !data.results) {
      console.error('\n❌  ML service error:', JSON.stringify(data));
      process.exit(1);
    }

    data.results.forEach((result, j) => {
      withEmbed.push({
        clean_name: batch[j].keywords,
        target_template_id: batch[j].template_id,
        embedding: result.embedding,
        is_semantic_anchor: true,
        is_verified: true,
        approval_count: 1,
      });
    });

    console.log('done');
  }

  // ── 6. Insert into Supabase (upsert on clean_name) ──────────────────────────
  console.log(`\n💾  Inserting ${withEmbed.length} row(s) into global_vector_cache...`);

  const insertBatches = chunk(withEmbed, 100);
  let inserted = 0, skipped = 0;

  for (const batch of insertBatches) {
    const { data: result, error } = await supabase
      .from('global_vector_cache')
      .upsert(batch, {
        onConflict: 'clean_name',
        ignoreDuplicates: false,      // update existing row if clean_name already exists
      })
      .select('cache_id');

    if (error) {
      console.error('❌  Insert error:', error.message);
      process.exit(1);
    }
    inserted += result.length;
  }

  console.log(`\n✅  Done.`);
  console.log(`    Inserted / updated : ${inserted}`);
  if (unmatched.length) console.log(`    Skipped (no template match): ${unmatched.length}`);
  console.log('\n    Verify in Supabase → global_vector_cache, filter is_semantic_anchor = true\n');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
