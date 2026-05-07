const logger = require('../utils/logger');

const supabase = require('../config/supabaseClient');
const llmBatchFallback = require('../services/llmBatchFallback');
const { isGarbage } = require('../services/personalCacheService');
const { isPersonName } = require('../services/vectorMatchService');

// ─────────────────────────────────────────────────────────────────────────────
// processUploadSSE
// ─────────────────────────────────────────────────────────────────────────────
// After the architecture split:
//   • Stages 1–3 (Rules → P_EXACT → Vector) run automatically via
//     autoPipelineController, triggered by the Python grouping job.
//   • This SSE handler only runs:
//       - Stage 0: Contra radar
//       - Stage 4: LLM fallback for rows in llm_queue
//       - Vector cache promotion (staging → confirmed)
//
// The "Categorise" button therefore only needs to be clicked for the LLM
// fallback step. If llm_queue is empty the handler signals { done: true }
// immediately.
// ─────────────────────────────────────────────────────────────────────────────

async function processUploadSSE(req, res) {
  const emit = (message, stage) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ message, stage })}\n\n`);
    }
  };

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    logger.info('Categorization request received', {
      documentIds: req.body?.document_ids,
      userId: req.user?.id
    });

    const { document_ids } = req.body;

    if (!document_ids || !Array.isArray(document_ids)) {
      logger.warn('Invalid payload received', { hasDocumentIds: !!document_ids, isArray: Array.isArray(document_ids) });
      emit('Something went wrong', 'error');
      res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
      res.end();
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      logger.error('User authentication missing');
      emit('Something went wrong', 'error');
      res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
      res.end();
      return;
    }

    // ==========================================
    // FETCH ALL TRANSACTIONS FOR THESE DOCUMENTS
    // Required for Stage 0 (Contra Radar) and to maintain
    // compatibility with existing pipeline logic.
    // ==========================================
    const { data: transactions, error: fetchErr } = await supabase
      .from('uncategorized_transactions')
      .select('*')
      .in('document_id', document_ids)
      .eq('user_id', userId);

    if (fetchErr || !transactions) {
      logger.error('Failed to fetch transactions for documents', { error: fetchErr?.message, document_ids });
      emit('Something went wrong', 'error');
      res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
      res.end();
      return;
    }

    // ==========================================
    // FETCH FALLBACK ACCOUNTS
    // ==========================================
    const { data: fallbackAccounts } = await supabase
      .from('accounts')
      .select('account_id, account_name, account_type')
      .eq('user_id', userId)
      .eq('is_system_generated', true)
      .in('account_name', ['Uncategorised Expense', 'Uncategorised Income']);

    const uncategorisedExpenseId = fallbackAccounts?.find(
      acc => acc.account_name === 'Uncategorised Expense'
    )?.account_id;
    const uncategorisedIncomeId = fallbackAccounts?.find(
      acc => acc.account_name === 'Uncategorised Income'
    )?.account_id;

    if (!uncategorisedExpenseId || !uncategorisedIncomeId) {
      logger.error('Fallback accounts not found', { userId });
      emit('Something went wrong', 'error');
      res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
      res.end();
      return;
    }

    logger.info('Starting LLM categorization pipeline', {
      totalTransactions: transactions.length,
      uncategorisedExpenseId,
      uncategorisedIncomeId
    });

    // ==========================================
    // INCREMENTAL FLUSH INFRASTRUCTURE
    // writtenUncatIds: tracks which uncategorized_transaction_ids have already
    // been inserted so no flush ever double-writes a row.
    // flushToDb: shared row-mapper + inserter used at every flush point.
    // ==========================================
    const writtenUncatIds = new Set();

    const flushToDb = async (items) => {
      const rows = items
        .filter(item => item.document_id)
        .filter(item => !item.uncategorized_transaction_id || !writtenUncatIds.has(item.uncategorized_transaction_id))
        .map(item => {
          const transactionType = item.debit ? 'DEBIT' : 'CREDIT';

          let finalOffsetAccountId = item.offset_account_id;
          let finalCategorisedBy   = item.categorised_by;
          let finalAttentionLevel  = item.attention_level;
          let isUncategorised      = item.is_uncategorised || false;

          if (!finalOffsetAccountId) {
            // Strict Lock: Do not flush to transactions table if no category was found.
            // This prevents unresolved rows from jumping the queue prematurely.
            return null;
          }

          return {
            user_id: userId,
            base_account_id: item.base_account_id || null,
            offset_account_id: finalOffsetAccountId,
            document_id: item.document_id,
            transaction_date: item.txn_date,
            details: item.details,
            clean_merchant_name: item.clean_merchant_name || null,
            amount: item.debit || item.credit || 0,
            transaction_type: transactionType,
            categorised_by: finalCategorisedBy,
            confidence_score: item.confidence_score || 0.5,
            is_contra: item.is_contra || false,
            posting_status: 'DRAFT',
            attention_level: finalAttentionLevel || 'LOW',
            review_status: 'PENDING',
            uncategorized_transaction_id: item.uncategorized_transaction_id || null,
            extracted_id: item.extracted_id || null,
            is_uncategorised: item.is_contra ? false : isUncategorised
          };
        }).filter(Boolean);

      if (rows.length === 0) return;

      const { error } = await supabase
        .from('transactions')
        .insert(rows);

      if (error) {
        logger.error('Flush insert failed', { error: error.message, count: rows.length });
      } else {
        logger.info('Flush insert successful', { count: rows.length });
        for (const row of rows) {
          if (row.uncategorized_transaction_id) {
            writtenUncatIds.add(row.uncategorized_transaction_id);
          }
        }
      }
    };

    // ==========================================
    // GROUPING WAIT GATE
    // Poll until all documents have finished the background grouping job
    // (grouping_status transitions from 'pending' → 'done').
    // By the time grouping_status = 'done', autoPipelineController has also
    // completed (it runs synchronously inside the /internal/auto-pipeline call
    // before the grouping job returns).
    // ==========================================
    if (document_ids.length > 0) {
      logger.info('Waiting for grouping + auto-pipeline to complete', { docIds: document_ids });

      const POLL_INTERVAL_MS = 3000;
      const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const startTime = Date.now();
      let pendingDocs = [];

      do {
        // Wait for docs that are NOT in terminal statuses
        const { data: docRows } = await supabase
          .from('documents')
          .select('document_id, grouping_status')
          .in('document_id', document_ids)
          .not('grouping_status', 'in', '("pipeline_done", "pipeline_failed")');

        pendingDocs = docRows || [];

        if (pendingDocs.length > 0) {
          if (Date.now() - startTime >= TIMEOUT_MS) {
            logger.warn('Grouping wait gate timed out — proceeding anyway', {
              pendingDocIds: pendingDocs.map(d => d.document_id)
            });
            break;
          }
          const statuses = [...new Set(pendingDocs.map(d => d.grouping_status))];
          emit(`Waiting for background processing (${statuses.join(', ')})…`, 'grouping');
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } while (pendingDocs.length > 0);

      logger.info('Grouping wait gate passed');
    }

    // ==========================================
    // STAGE 0: CONTRA RADAR (moved to autoPipeline)
    // Contra detection now runs inside autoPipelineController right after upload.
    // Emit the SSE signal so the frontend refreshes; no work needed here.
    // ==========================================
    res.write(`data: ${JSON.stringify({ flush: true, stage: 'contra' })}\n\n`);
    logger.info('Flush 1 (contra) signal sent — contra detection already handled by auto-pipeline');

    // ── FLUSH 2: No-op signal — pre-categorised rows written by auto-pipeline ─
    // auto-pipeline already wrote Stages 1–3 rows to transactions.
    // Just emit the SSE signal so the frontend can refresh.
    res.write(`data: ${JSON.stringify({ flush: true, stage: 'pre_categorised' })}\n\n`);
    logger.info('Flush 2 (pre_categorised) signal sent — data already written by auto-pipeline');

    // ── FLUSH 3: No-op signal — pipeline rows written by auto-pipeline ─────────
    res.write(`data: ${JSON.stringify({ flush: true, stage: 'pipeline' })}\n\n`);
    logger.info('Flush 3 (pipeline) signal sent — data already written by auto-pipeline');

    // ==========================================
    // FETCH LLM LEFTOVERS FROM llm_queue
    // ==========================================
    const { data: queueRows, error: queueErr } = await supabase
      .from('llm_queue')
      .select(
        'uncategorized_transaction_id, ' +
        'uncategorized_transactions!inner(uncategorized_transaction_id, details, txn_date, debit, credit, account_id, document_id, vector_cache_ref, clean_merchant_name, group_id)'
      )
      .in('document_id', document_ids)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (queueErr) {
      logger.error('Failed to fetch llm_queue rows', { error: queueErr.message });
    }

    const llmQueueRows = queueRows || [];
    
    // ── HEALER LOGIC: If queue is empty but rows are still "Pending Categorisation" ──
    // This happens if the auto-pipeline crashed before writing to llm_queue.
    if (llmQueueRows.length === 0) {
      logger.info('[BULK-CAT] llm_queue empty — checking for Limbo rows');
      const { data: limboRows } = await supabase
        .from('uncategorized_transactions')
        .select('uncategorized_transaction_id')
        .in('document_id', document_ids)
        .eq('user_id', userId);

      // Check which ones are already in 'transactions'
      const uncatIds = (limboRows || []).map(r => r.uncategorized_transaction_id);
      if (uncatIds.length > 0) {
        const { data: resolvedExits } = await supabase
          .from('transactions')
          .select('uncategorized_transaction_id')
          .in('uncategorized_transaction_id', uncatIds);
        
        const resolvedSet = new Set((resolvedExits || []).map(r => r.uncategorized_transaction_id));
        const trulyPending = uncatIds.filter(id => !resolvedSet.has(id));

        if (trulyPending.length > 0) {
          logger.info('[BULK-CAT] Found truly pending rows — re-triggering auto-pipeline', { count: trulyPending.length });
          emit(`Recovering ${trulyPending.length} transactions…`, 'recovery');
          
          const autoPipeline = require('./autoPipelineController');
          await autoPipeline.runAutoPipeline({ 
            headers: { authorization: `Bearer ${process.env.INTERNAL_SECRET || ''}` },
            body: { document_id: document_ids[0], user_id: userId, transactions: trulyPending }
          }, { 
            json: () => {}, 
            status: () => ({ json: () => {} }) 
          });

          // Re-fetch queue after healing
          const { data: refetchedRows } = await supabase
            .from('llm_queue')
            .select('uncategorized_transaction_id, uncategorized_transactions!inner(uncategorized_transaction_id, details, txn_date, debit, credit, account_id, document_id, vector_cache_ref)')
            .in('document_id', document_ids)
            .eq('user_id', userId)
            .eq('status', 'pending');
          
          if (refetchedRows && refetchedRows.length > 0) {
            llmQueueRows.push(...refetchedRows);
            logger.info('[BULK-CAT] Recovery successful', { newCount: llmQueueRows.length });
          }
        }
      }
    }

    if (llmQueueRows.length === 0) {
      logger.info('llm_queue empty — truly no LLM work needed');
      emit('Done', 'done');
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // Flatten queue rows into a usable shape that mirrors what the old pipeline produced
    const llmTransactions = llmQueueRows.map(qr => {
      const u = qr.uncategorized_transactions || {};
      return {
        uncategorized_transaction_id: qr.uncategorized_transaction_id,
        details: u.details,
        txn_date: u.txn_date,
        debit: u.debit,
        credit: u.credit,
        account_id: u.account_id,
        document_id: u.document_id,
        vector_cache_ref: u.vector_cache_ref,
        clean_merchant_name: u.clean_merchant_name || null,
        group_id: u.group_id || null,
        base_account_id: u.account_id || null,
        offset_account_id: null,
      };
    });

    // Track vector_cache_refs for promotion later
    const llmVectorCacheRefs = llmTransactions
      .map(t => t.vector_cache_ref)
      .filter(Boolean);

    // ==========================================
    // PRE-LLM FILTER 1 — GARBAGE
    // Rows whose raw details are system noise (pure UPI refs, hex IDs, VPA
    // handles, etc.) will never produce a useful LLM result.  Short-circuit
    // them immediately as FALLBACK / attention HIGH.
    // ==========================================
    const garbageIds = new Set();
    const garbageRows = [];
    const afterGarbage  = [];

    for (const txn of llmTransactions) {
      if (isGarbage(txn.details)) {
        logger.info('[PRE-LLM] Garbage filter hit', { id: txn.uncategorized_transaction_id, details: txn.details?.slice(0, 60) });
        txn.offset_account_id = txn.debit ? uncategorisedExpenseId : uncategorisedIncomeId;
        txn.categorised_by    = 'FALLBACK';
        txn.confidence_score  = 0.0;
        txn.attention_level   = 'HIGH';
        garbageIds.add(txn.uncategorized_transaction_id);
        garbageRows.push(txn);
      } else {
        afterGarbage.push(txn);
      }
    }

    if (garbageRows.length > 0) {
      await flushToDb(garbageRows);
      // Mark llm_queue rows as done
      await supabase.from('llm_queue').update({ status: 'done' })
        .in('uncategorized_transaction_id', [...garbageIds]).eq('user_id', userId);
      // Mark uncategorized_transactions as categorized
      await supabase.from('uncategorized_transactions').update({ grouping_status: 'categorized' })
        .in('uncategorized_transaction_id', [...garbageIds]);
      logger.info('[PRE-LLM] Garbage filter flushed', { count: garbageRows.length });
    }

    // ==========================================
    // PRE-LLM FILTER 2 — PERSON NAME
    // Single-token strings longer than 18 chars (e.g. MRVARADVIDYADHAR) are
    // almost certainly UPI person-to-person payments.  LLM cannot categorise
    // them reliably; mark as FALLBACK immediately.
    // ==========================================
    const personIds  = new Set();
    const personRows = [];
    const afterPerson = [];

    for (const txn of afterGarbage) {
      if (isPersonName(txn.clean_merchant_name)) {
        logger.info('[PRE-LLM] Person-name filter hit', { id: txn.uncategorized_transaction_id, name: txn.clean_merchant_name });
        txn.offset_account_id = txn.debit ? uncategorisedExpenseId : uncategorisedIncomeId;
        txn.categorised_by    = 'FALLBACK';
        txn.confidence_score  = 0.0;
        txn.attention_level   = 'HIGH';
        personIds.add(txn.uncategorized_transaction_id);
        personRows.push(txn);
      } else {
        afterPerson.push(txn);
      }
    }

    if (personRows.length > 0) {
      await flushToDb(personRows);
      await supabase.from('llm_queue').update({ status: 'done' })
        .in('uncategorized_transaction_id', [...personIds]).eq('user_id', userId);
      await supabase.from('uncategorized_transactions').update({ grouping_status: 'categorized' })
        .in('uncategorized_transaction_id', [...personIds]);
      logger.info('[PRE-LLM] Person-name filter flushed', { count: personRows.length });
    }

    // ==========================================
    // PRE-LLM FILTER 3 — MERCHANT DEDUPLICATION
    // Multiple rows with the same clean_merchant_name need only ONE LLM call.
    // Keep one representative per unique name; track siblings separately.
    // Rows with no clean_merchant_name are always sent individually.
    // ==========================================
    const dedupedForLlm    = [];    // representative rows sent to LLM
    const merchantSiblings = new Map(); // cleanNameUpper -> txn[]
    const seenMerchants    = new Set();

    for (const txn of afterPerson) {
      const key = txn.clean_merchant_name ? txn.clean_merchant_name.toUpperCase() : null;
      if (!key) {
        // No merchant name — always include individually
        dedupedForLlm.push(txn);
        continue;
      }
      if (!seenMerchants.has(key)) {
        seenMerchants.add(key);
        dedupedForLlm.push(txn);
        merchantSiblings.set(key, []);
      } else {
        merchantSiblings.get(key).push(txn);
      }
    }

    const dedupSavings = afterPerson.length - dedupedForLlm.length;
    if (dedupSavings > 0) {
      logger.info('[PRE-LLM] Merchant deduplication', {
        originalCount: afterPerson.length,
        dedupedCount: dedupedForLlm.length,
        saved: dedupSavings
      });
    }


    // ==========================================
    // STAGE 4: BATCH LLM FALLBACK
    // Operates on dedupedForLlm (not the raw llmTransactions) so the LLM only
    // sees one representative per unique merchant name (Fix 3).
    // ==========================================
    emit(`Asking AI to categorise ${dedupedForLlm.length} transactions…`, 'llm');
    logger.info('Stage 4: LLM Batch Fallback', { count: dedupedForLlm.length, original: afterPerson.length });

    // finalResults still tracks ALL pre-LLM rows (including pre-filter rejects)
    // for the summary log; only dedupedForLlm is sent to the model.
    const finalResults = [...llmTransactions];

    const debitLeftovers  = dedupedForLlm.filter(t => t.debit);
    const creditLeftovers = dedupedForLlm.filter(t => t.credit);

    logger.info('LLM batch separation', {
      debitCount: debitLeftovers.length,
      creditCount: creditLeftovers.length
    });

    // Helper: mutate finalResults entries with LLM prediction AND fan-out to
    // merchant-name duplicates (Fix 3 fan-out).
    const applyLlmResult = (prediction) => {
      const repId = prediction.uncategorized_transaction_id || prediction.transaction_id;
      const targets = finalResults.filter(t =>
        (t.uncategorized_transaction_id || t.transaction_id) === repId
      );
      for (const match of targets) {
        match.offset_account_id = prediction.offset_account_id;
        match.categorised_by    = prediction.categorised_by || 'LLM';
        match.confidence_score  = prediction.confidence_score;
        match.llm_merchant_name = prediction.llm_merchant_name || null;
        match.attention_level   = prediction.confidence_score >= 0.8 ? 'LOW'
          : prediction.confidence_score >= 0.5 ? 'MEDIUM' : 'HIGH';

        // Fix 3: Fan-out result to merchant-name siblings
        const key = match.clean_merchant_name ? match.clean_merchant_name.toUpperCase() : null;
        if (key && merchantSiblings.has(key)) {
          for (const sibling of merchantSiblings.get(key)) {
            sibling.offset_account_id = match.offset_account_id;
            sibling.categorised_by    = match.categorised_by;
            sibling.confidence_score  = match.confidence_score;
            sibling.attention_level   = match.attention_level;
          }
        }
      }
    };

    // Process DEBIT transactions
    if (debitLeftovers.length > 0) {
      const { data: debitAccounts } = await supabase
        .from('accounts')
        .select('account_id, account_name, balance_nature')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('is_system_generated', false)
        .eq('include_in_llm', true)
        .eq('balance_nature', 'DEBIT')
        .eq('account_type', 'EXPENSE')
        .not('account_name', 'in', '("Uncategorised Expense")');

      const debitCategories = debitAccounts || [];
      logger.info('DEBIT categories for LLM', { count: debitCategories.length });

      if (debitCategories.length > 0) {
        const debitLlmResults = await llmBatchFallback.categorizeBatch(debitLeftovers, debitCategories);
        logger.info('DEBIT LLM categorization complete', { resultsCount: debitLlmResults.length });
        for (const prediction of debitLlmResults) {
          applyLlmResult(prediction);
        }

        // ── FLUSH 4: Debit LLM results (reps + Fix 3 siblings) ───────────────
        // Collect the deduped reps AND their merchant siblings
        const debitRepUncatIds = new Set(debitLeftovers.map(t => t.uncategorized_transaction_id));
        const debitSiblingRows = debitLeftovers.flatMap(t => {
          const key = t.clean_merchant_name ? t.clean_merchant_name.toUpperCase() : null;
          return (key && merchantSiblings.has(key)) ? merchantSiblings.get(key) : [];
        });
        const debitUncatIds = new Set([
          ...debitRepUncatIds,
          ...debitSiblingRows.map(t => t.uncategorized_transaction_id)
        ]);
        const debitResolved = finalResults.filter(
          t => debitUncatIds.has(t.uncategorized_transaction_id)
        );
        if (debitResolved.length > 0) {
          await flushToDb(debitResolved);
          res.write(`data: ${JSON.stringify({ flush: true, stage: 'llm_debit' })}\n\n`);
          logger.info('Flush 4 (llm_debit) complete', { count: debitResolved.length });
        }
      }
    }

    // Process CREDIT transactions
    if (creditLeftovers.length > 0) {
      const { data: creditAccounts } = await supabase
        .from('accounts')
        .select('account_id, account_name, balance_nature')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('is_system_generated', false)
        .eq('include_in_llm', true)
        .eq('balance_nature', 'CREDIT')
        .eq('account_type', 'INCOME')
        .not('account_name', 'in', '("Uncategorised Income")');

      const creditCategories = creditAccounts || [];
      logger.info('CREDIT categories for LLM', { count: creditCategories.length });

      if (creditCategories.length > 0) {
        const creditLlmResults = await llmBatchFallback.categorizeBatch(creditLeftovers, creditCategories);
        logger.info('CREDIT LLM categorization complete', { resultsCount: creditLlmResults.length });
        for (const prediction of creditLlmResults) {
          applyLlmResult(prediction);
        }

        // ── FLUSH 5: Credit LLM results (reps + Fix 3 siblings) ─────────────
        // Collect the deduped reps AND their merchant siblings
        const creditRepUncatIds = new Set(creditLeftovers.map(t => t.uncategorized_transaction_id));
        const creditSiblingRows = creditLeftovers.flatMap(t => {
          const key = t.clean_merchant_name ? t.clean_merchant_name.toUpperCase() : null;
          return (key && merchantSiblings.has(key)) ? merchantSiblings.get(key) : [];
        });
        const creditUncatIds = new Set([
          ...creditRepUncatIds,
          ...creditSiblingRows.map(t => t.uncategorized_transaction_id)
        ]);
        const creditResolved = finalResults.filter(
          t => creditUncatIds.has(t.uncategorized_transaction_id)
        );
        if (creditResolved.length > 0) {
          await flushToDb(creditResolved);
          res.write(`data: ${JSON.stringify({ flush: true, stage: 'llm_credit' })}\n\n`);
          logger.info('Flush 5 (llm_credit) complete', { count: creditResolved.length });
        }
      }
    }

    // ── FIX 4: GROUP FAN-OUT ──────────────────────────────────────────────────
    // After the LLM resolved the group representative(s), find all uncategorized
    // siblings that share the same group_id + document_id but haven't been
    // written to transactions yet.  Apply the rep's category with categorised_by
    // = 'LLM_FANOUT' so it's distinguishable in logs / audits.
    const llmResolvedReps = dedupedForLlm.filter(t => t.offset_account_id && t.group_id);
    if (llmResolvedReps.length > 0) {
      // Collect unique (group_id, document_id) pairs
      const groupPairs = [...new Map(
        llmResolvedReps.map(t => [`${t.group_id}__${t.document_id}`, t])
      ).values()];

      for (const rep of groupPairs) {
        // Fetch all uncategorized siblings in this group that aren't yet in transactions
        const { data: siblings } = await supabase
          .from('uncategorized_transactions')
          .select('uncategorized_transaction_id, account_id, txn_date, details, debit, credit, document_id, clean_merchant_name')
          .eq('group_id', rep.group_id)
          .eq('document_id', rep.document_id)
          .neq('uncategorized_transaction_id', rep.uncategorized_transaction_id);

        if (!siblings || siblings.length === 0) continue;

        // Exclude any that are already written (by name dedup, garbage, person filters)
        const unwrittenSiblings = siblings.filter(
          s => !writtenUncatIds.has(s.uncategorized_transaction_id)
        );

        if (unwrittenSiblings.length === 0) continue;

        const fanOutRows = unwrittenSiblings.map(s => ({
          ...s,
          base_account_id: s.account_id || null,
          offset_account_id: rep.offset_account_id,
          categorised_by: 'LLM_FANOUT',
          confidence_score: rep.confidence_score,
          attention_level: rep.attention_level || 'HIGH',
        }));

        await flushToDb(fanOutRows);

        // Mark these siblings in llm_queue as done (they may not be in the queue
        // because autoPipelineController skips sibling inserts — but guard anyway)
        const fanOutIds = fanOutRows.map(s => s.uncategorized_transaction_id).filter(Boolean);
        if (fanOutIds.length > 0) {
          await supabase.from('llm_queue').update({ status: 'done' })
            .in('uncategorized_transaction_id', fanOutIds).eq('user_id', userId);
          await supabase.from('uncategorized_transactions').update({ grouping_status: 'categorized' })
            .in('uncategorized_transaction_id', fanOutIds);
        }

        logger.info('[FIX4] Group fan-out applied', {
          group_id: rep.group_id,
          repId: rep.uncategorized_transaction_id,
          siblings: fanOutRows.length
        });
      }
    }

    // ── SAFETY FLUSH: Any remaining unwritten rows ────────────────────────────
    {
      const unwritten = finalResults.filter(
        t => t.uncategorized_transaction_id && !writtenUncatIds.has(t.uncategorized_transaction_id)
      );
      if (unwritten.length > 0) {
        logger.info('Safety flush: writing remaining rows', { count: unwritten.length });
        await flushToDb(unwritten);
      }
    }

    // ==========================================
    // PROMOTE STAGING VECTORS → CONFIRMED
    // For all transactions processed in this SSE run, promote their
    // personal_vector_cache entries from 'staging' to 'confirmed'.
    // This is the approve-time finalisation of the user's history.
    // ==========================================
    if (llmVectorCacheRefs.length > 0) {
      const { error: promoteErr } = await supabase
        .from('personal_vector_cache')
        .update({ status: 'confirmed' })
        .in('cache_id', llmVectorCacheRefs)
        .eq('status', 'staging');

      if (promoteErr) {
        logger.warn('Vector cache promotion failed', { error: promoteErr.message });
      } else {
        logger.info('Vector cache promoted staging → confirmed', { count: llmVectorCacheRefs.length });
      }
    }

    // ==========================================
    // MARK llm_queue ROWS AS DONE
    // ==========================================
    {
      const processedUncatIds = llmTransactions.map(t => t.uncategorized_transaction_id).filter(Boolean);
      if (processedUncatIds.length > 0) {
        const { error: qDoneErr } = await supabase
          .from('llm_queue')
          .update({ status: 'done' })
          .in('uncategorized_transaction_id', processedUncatIds)
          .eq('user_id', userId);

        if (qDoneErr) {
          logger.warn('Failed to mark llm_queue rows as done', { error: qDoneErr.message });
        }
      }
    }

    // ==========================================
    // CATEGORIZATION SUMMARY LOG
    // ==========================================
    const summaryCounts = {};
    for (const item of finalResults) {
      const method = item.categorised_by || 'UNCATEGORISED';
      summaryCounts[method] = (summaryCounts[method] || 0) + 1;
    }
    const totalCategorised   = finalResults.filter(t => t.categorised_by).length;
    const totalUncategorised = finalResults.filter(t => !t.categorised_by).length;

    logger.info('Categorization summary', {
      total: finalResults.length,
      categorised: totalCategorised,
      uncategorised: totalUncategorised,
      breakdown: summaryCounts,
      writtenToDb: writtenUncatIds.size
    });

    logger.info('LLM categorization complete', { totalResults: finalResults.length });

    emit('Done', 'done');
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;

  } catch (err) {
    logger.error('Bulk categorization exception', { error: err.message, stack: err.stack });
    emit('Something went wrong', 'error');
    res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
    res.end();
    return;
  }
}

module.exports = {
  processUpload: processUploadSSE
};