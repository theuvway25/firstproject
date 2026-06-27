const supabase = require('../config/supabaseClient');

/**
 * Checks if a newly uploaded transaction is a "mirror image" of a transfer 
 * already recorded from a different bank account.
 * 
 * @param {string} userId - The UUID of the user.
 * @param {number} amount - The transaction amount.
 * @param {string} type - The transaction balance nature ('CREDIT' or 'DEBIT').
 * @param {string|Date} date - The transaction date (YYYY-MM-DD).
 * @param {number} baseAccountId - The ID of the current base account.
 * @returns {Promise<number|null>} Returns the transaction_id of the matching Side A transaction, or null if no match.
 */
async function findMirrorTransaction(userId, amount, type, date, baseAccountId) {
  try {
    if (!userId || !amount || !type || !date || !baseAccountId) {
      return null;
    }

    // 1. Opposite Logic: Calculate exact opposite type
    const oppositeType = type === 'INCOME' ? 'EXPENSE' : 'INCOME';

    // 2. Date Window Logic (+/- 1 day)
    // Create Date objects using the input string. 
    // By passing 'YYYY-MM-DD', Javascript defaults to UTC midnight, fully timezone neutral.
    const inputDate = new Date(date);
    
    const startDate = new Date(inputDate);
    startDate.setDate(startDate.getDate() - 1);

    const endDate = new Date(inputDate);
    endDate.setDate(endDate.getDate() + 1);

    const formatDate = (d) => d.toISOString().split('T')[0];

    // 3. Search the transactions table
    const { data: matches, error } = await supabase
      .from('transactions')
      .select('transaction_id')
      .eq('user_id', userId)
      .eq('amount', amount)
      .eq('transaction_type', oppositeType)
      .neq('base_account_id', baseAccountId)
      .eq('is_contra', false) // Strict Requirement: has not been matched yet
      .gte('transaction_date', formatDate(startDate))
      .lte('transaction_date', formatDate(endDate))
      .limit(1);

    if (error) {
      console.error('❌ Error executing findMirrorTransaction in Supabase:', error);
      return null;
    }

    if (matches && matches.length > 0) {
      return matches[0].transaction_id;
    }

    return null;

  } catch (err) {
    console.error('❌ findMirrorTransaction encountered an exception:', err);
    return null;
  }
}

/**
 * Stage 0: Batch Contra Radar
 * Iterates through a batch of transactions and finds mirror image transfers
 * either inside the batch itself or falling back to search the DB for last 3 days.
 * 
 * @param {Array} transactionsBatch - Array of parsed transaction rows.
 * @param {string} userId - User UUID.
 * @param {object} supabaseClient - Shared Supabase client instance.
 * @returns {Promise<Array>} List of resolved transactions, excluding Side-B duplicates.
 */
async function findAndLinkContras(transactionsBatch, userId, supabaseClient) {
  try {
    if (!transactionsBatch || !Array.isArray(transactionsBatch) || !userId) {
      return transactionsBatch; 
    }

    const resolvedBatch = [];
    const skippedIndices = new Set(); 

    for (let i = 0; i < transactionsBatch.length; i++) {
        if (skippedIndices.has(i)) continue;

        const txn = { ...transactionsBatch[i] };
        const amount = txn.debit || txn.credit || 0;
        const type = txn.debit ? 'EXPENSE' : 'INCOME';
        const oppositeType = type === 'EXPENSE' ? 'INCOME' : 'EXPENSE';
        const baseAccountId = txn.account_id || txn.base_account_id;
        const txnDate = new Date(txn.txn_date || txn.transaction_date);

        let matchFound = false;

        // 1. Search INSIDE the batch itself for Side B
        for (let j = i + 1; j < transactionsBatch.length; j++) {
            if (skippedIndices.has(j)) continue;

            const candidate = transactionsBatch[j];
            const cAmount = candidate.debit || candidate.credit || 0;
            const cType = candidate.debit ? 'EXPENSE' : 'INCOME';
            const cBaseAccountId = candidate.account_id || candidate.base_account_id;
            const cDate = new Date(candidate.txn_date || candidate.transaction_date);

            if (amount === cAmount && oppositeType === cType && baseAccountId !== cBaseAccountId) {
                const diffTime = Math.abs(txnDate - cDate);
                const diffDays = diffTime / (1000 * 60 * 60 * 24);

                if (diffDays <= 2) {
                    // Side A — mark contra, offset points to Side B's account
                    txn.offset_account_id = cBaseAccountId;
                    txn.is_contra = true;
                    txn.categorised_by = 'G_RULE';
                    txn.confidence_score = 1.00;

                    // Side B — also mark contra, offset points back to Side A's account
                    // Push it directly instead of skipping it
                    const sideB = {
                        ...transactionsBatch[j],
                        offset_account_id: baseAccountId,
                        is_contra: true,
                        categorised_by: 'G_RULE',
                        confidence_score: 1.00
                    };
                    resolvedBatch.push(sideB);

                    skippedIndices.add(j);
                    matchFound = true;
                    break;
                }
            }
        }

        // 2. Fallback: Search Database (query last 3 days)
        if (!matchFound && supabaseClient) {
            const startDate = new Date(txnDate);
            startDate.setDate(startDate.getDate() - 3);
            const endDate = new Date(txnDate);
            endDate.setDate(endDate.getDate() + 3);

            const formatDate = (d) => d.toISOString().split('T')[0];

            const { data: dbMatch, error } = await supabaseClient
                .from('transactions')
                .select('transaction_id, base_account_id')
                .eq('user_id', userId)
                .eq('amount', amount)
                .eq('transaction_type', oppositeType)
                .neq('base_account_id', baseAccountId)
                .eq('is_contra', false)
                .gte('transaction_date', formatDate(startDate))
                .lte('transaction_date', formatDate(endDate))
                .limit(1);

            if (!error && dbMatch && dbMatch.length > 0) {
                txn.offset_account_id = dbMatch[0].base_account_id;
                txn.is_contra = true;
                txn.categorised_by = 'G_RULE';
                txn.confidence_score = 1.00;

                // Retroactively update the mirror transaction that was already written.
                // First, fetch its current posting_status so we know if ledger entries exist.
                const { data: mirrorTxn, error: mirrorFetchError } = await supabaseClient
                    .from('transactions')
                    .select('transaction_id, posting_status, review_status')
                    .eq('transaction_id', dbMatch[0].transaction_id)
                    .single();

                if (mirrorFetchError) {
                    console.error('❌ Failed to fetch mirror transaction for contra update:', mirrorFetchError);
                } else {
                    const wasPosted = mirrorTxn?.posting_status === 'POSTED';

                    if (wasPosted) {
                        // The mirror was already approved & had ledger entries written.
                        // Those entries recorded a real income/expense — wrong for a contra.
                        // Delete them first so the books stay clean.
                        const { error: ledgerDeleteError } = await supabaseClient
                            .from('journal_entries')
                            .delete()
                            .eq('transaction_id', dbMatch[0].transaction_id);

                        if (ledgerDeleteError) {
                            console.error('❌ Failed to delete stale ledger entries for contra mirror:', ledgerDeleteError);
                        } else {
                            console.warn(`⚠️  Contra Radar: deleted stale ledger entries for already-posted transaction_id ${dbMatch[0].transaction_id}. Transaction reset to PENDING for user review.`);
                        }
                    }

                    // Now update the mirror transaction:
                    //   - Mark it contra so no new ledger entries are ever created for it
                    //   - Reset to PENDING / DRAFT so the user is aware it changed
                    const { error: updateError } = await supabaseClient
                        .from('transactions')
                        .update({
                            is_contra: true,
                            is_uncategorised: false, // contra is always categorised — it routes to the mirror account
                            categorised_by: 'G_RULE',
                            offset_account_id: txn.account_id || txn.base_account_id,
                            attention_level: 'LOW',
                            review_status: 'PENDING',
                            ...(wasPosted && { posting_status: 'DRAFT' }) // revert POSTED → DRAFT if ledger was cleaned
                        })
                        .eq('transaction_id', dbMatch[0].transaction_id);

                    if (updateError) {
                        console.error('❌ Failed to retroactively update mirror contra transaction:', updateError);
                    } else {
                        console.log(`✅ Contra linked: updated mirror transaction_id ${dbMatch[0].transaction_id}${wasPosted ? ' (ledger entries removed, reset to DRAFT/PENDING)' : ''}`);
                    }
                }
            }
        }

        resolvedBatch.push(txn);
    }

    return resolvedBatch;

  } catch (err) {
    console.error('❌ findAndLinkContras encountered an exception:', err);
    return transactionsBatch;
  }
}

module.exports = {
  findMirrorTransaction,
  findAndLinkContras
};
