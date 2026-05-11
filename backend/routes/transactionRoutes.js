const express = require('express');
const router = express.Router();
const { processUpload } = require('../controllers/bulkController');
const { bulkUploadStatements } = require('../controllers/uploadController');
const { recategorizeTransaction, approveTransaction, bulkApproveTransactions, bulkAssignAndApproveTransactions, manualCategorizeTransaction, correctTransaction, updateSourceAccount, updateTransactionNote, manualAddTransaction, retryPipeline } = require('../controllers/transactionController');

const authMiddleware = require('../middleware/authMiddleware');

// 🛡️ Route: POST /upload-bulk
// Atomically uploads and stages a batch of transactions from a statement file.
router.post('/upload-bulk', authMiddleware, bulkUploadStatements);

// 🛡️ Route: POST /categorize-bulk
// Processes a batch of parsed transactions using the waterfall categorization pipeline.
router.post('/categorize-bulk', authMiddleware, processUpload);

// 🛡️ Route: PATCH /:id/recategorize
// Updates a transaction with a new offset_account_id and marks as MANUAL.
// Body: { offset_account_id: number }
router.patch('/:id/recategorize', authMiddleware, recategorizeTransaction);

// 🛡️ Route: PATCH /:id/approve
// Updates a transaction to mark as approved and posted.
router.patch('/:id/approve', authMiddleware, approveTransaction);

// 🛡️ Route: POST /approve-bulk
// Approves and posts multiple transactions in bulk.
// Body: { transaction_ids: [id1, id2, ...] }
router.post('/approve-bulk', authMiddleware, bulkApproveTransactions);

// 🛡️ Route: POST /assign-approve-bulk
// Assigns a new account and bulk approves multiple transactions.
// Body: { transaction_ids: [id1, id2, ...], offset_account_id: id }
router.post('/assign-approve-bulk', authMiddleware, bulkAssignAndApproveTransactions);

// 🛡️ Route: POST /manual-categorize
// Creates a transaction row from an uncategorized transaction.
// Body: { uncategorized_transaction_id: id, offset_account_id: id }
router.post('/manual-categorize', authMiddleware, manualCategorizeTransaction);

// 🛡️ Route: POST /manual-add
// Creates a brand-new transaction directly from user input (no uncategorized source).
// Body: { base_account_id, offset_account_id, amount, transaction_type, transaction_date, details, user_note? }
router.post('/manual-add', authMiddleware, manualAddTransaction);

// 🛡️ Route: PATCH /:uncategorized_transaction_id/correct
// Corrects the amount and/or type of a parsed transaction.
// Deletes journal_entries + transactions, resets uncategorized_transaction to PENDING.
// Body: { amount?: number, transaction_type?: 'DEBIT' | 'CREDIT' }
router.patch('/:uncategorized_transaction_id/correct', authMiddleware, correctTransaction);
// 🛡️ Route: PATCH /:uncategorized_transaction_id/source-account
// Updates the source account for a specific uncategorized transaction
// Body: { account_id: id }
router.patch('/:uncategorized_transaction_id/source-account', authMiddleware, updateSourceAccount);

// 🛡️ Route: PATCH /:transaction_id/note
// Updates only the user_note field on an existing transactions row.
// Body: { user_note: string }
router.patch('/:transaction_id/note', authMiddleware, updateTransactionNote);

// 🛡️ Route: POST /retry-pipeline
// Re-triggers the auto-pipeline for a failed or stale-running document.
// Body: { document_id }
router.post('/retry-pipeline', authMiddleware, retryPipeline);

module.exports = router;
