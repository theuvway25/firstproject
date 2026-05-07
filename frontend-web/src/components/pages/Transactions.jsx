import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import AccountPickerModal from '../AccountPickerModal';
import { Toast, useToast } from '../Toast';
import { supabase } from '../../shared/supabase';
import { formatDate } from '../../utils/dateUtils';
import { ICONS } from '../Icons';
import '../../styles/Transactions.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const ATTENTION_ORDER = ['HIGH', 'MEDIUM', 'LOW'];

// Small inline editor that appears when the amount cell is clicked
const AmountEditor = ({ txn, onSave, onCancel }) => {
  const isDebit = txn.debit != null;
  const initialAmt = isDebit ? txn.debit : txn.credit;
  const [editAmount, setEditAmount] = useState(initialAmt != null ? Number(initialAmt).toFixed(2) : '');
  const [editType, setEditType] = useState(isDebit ? 'DEBIT' : 'CREDIT');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const handleSave = async () => {
    const parsed = parseFloat(editAmount);
    if (isNaN(parsed) || parsed < 0) return;
    setSaving(true);
    await onSave(txn.uncategorized_transaction_id, parsed, editType);
    setSaving(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="amount-editor" onClick={(e) => e.stopPropagation()}>
      <div className="amount-editor-type-toggle">
        <button
          className={`type-btn ${editType === 'DEBIT' ? 'active debit' : ''}`}
          onClick={() => setEditType('DEBIT')}
        >− Dr</button>
        <button
          className={`type-btn ${editType === 'CREDIT' ? 'active credit' : ''}`}
          onClick={() => setEditType('CREDIT')}
        >+ Cr</button>
      </div>
      <input
        ref={inputRef}
        className="amount-editor-input"
        type="number"
        step="0.01"
        min="0"
        value={editAmount}
        onChange={(e) => setEditAmount(e.target.value)}
        onBlur={(e) => {
          if (e.target.value) setEditAmount(Number(e.target.value).toFixed(2));
        }}
        onKeyDown={handleKey}
      />
      <div className="amount-editor-actions">
        <button className="amount-editor-save" onClick={handleSave} disabled={saving}>
          {saving ? '...' : '✓'}
        </button>
        <button className="amount-editor-cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
};

// Recursive tree view for choosing a destination (offset) account filter
const OffsetAccountTree = ({ accounts, selectedIds, onToggle, searchQuery = '' }) => {
  const [expandedIds, setExpandedIds] = useState(new Set());
  const q = searchQuery.trim().toLowerCase();

  const toggle = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Build tree from flat list — roots are accounts with no parent in list
  const accountMap = {};
  accounts.forEach(a => { accountMap[a.account_id] = { ...a, children: [] }; });
  const roots = [];
  accounts.forEach(a => {
    if (a.parent_account_id && accountMap[a.parent_account_id]) {
      accountMap[a.parent_account_id].children.push(accountMap[a.account_id]);
    } else {
      roots.push(accountMap[a.account_id]);
    }
  });

  // Auto-expand ancestors of any pre-selected account so the checkbox is visible
  useEffect(() => {
    if (accounts.length === 0 || selectedIds.size === 0) return;
    const toExpand = new Set();
    selectedIds.forEach(id => {
      let current = accounts.find(a => a.account_id === id);
      while (current?.parent_account_id) {
        toExpand.add(current.parent_account_id);
        current = accounts.find(a => a.account_id === current.parent_account_id);
      }
    });
    if (toExpand.size > 0) {
      setExpandedIds(prev => new Set([...prev, ...toExpand]));
    }
  }, [accounts, selectedIds]);

  // Returns true if node or any descendant matches search
  const nodeMatches = (node) => {
    if (!q) return true;
    if (node.account_name.toLowerCase().includes(q)) return true;
    return (node.children || []).some(child => nodeMatches(child));
  };

  const renderNode = (node, depth = 0) => {
    if (!nodeMatches(node)) return null;

    const hasChildren = node.children && node.children.length > 0;
    // Auto-expand when searching
    const isExpanded = q ? true : expandedIds.has(node.account_id);
    const isSelected = selectedIds.has(node.account_id);
    const nameLC = node.account_name.toLowerCase();
    const matchIdx = q ? nameLC.indexOf(q) : -1;

    // Highlight matched portion of account name
    const nameEl = matchIdx >= 0 ? (
      <span>
        {node.account_name.slice(0, matchIdx)}
        <mark style={{ background: 'rgba(167,139,250,0.35)', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}>
          {node.account_name.slice(matchIdx, matchIdx + q.length)}
        </mark>
        {node.account_name.slice(matchIdx + q.length)}
      </span>
    ) : node.account_name;

    return (
      <div key={node.account_id}>
        <label
          className="filter-option"
          style={{ paddingLeft: `${12 + depth * 14}px`, gap: '6px', alignItems: 'center' }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.preventDefault(); if (!q) toggle(node.account_id); }}
              style={{
                background: 'none', border: 'none', cursor: q ? 'default' : 'pointer',
                padding: '0 2px', color: 'var(--text-secondary)',
                fontSize: '10px', lineHeight: 1, flexShrink: 0
              }}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: '14px', flexShrink: 0 }} />
          )}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(node.account_id)}
            style={{ flexShrink: 0 }}
          />
          <span style={{ fontSize: '12.5px', color: depth === 0 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: depth === 0 ? 600 : 400 }}>
            {nameEl}
          </span>
        </label>
        {hasChildren && isExpanded && node.children
          .filter(child => nodeMatches(child))
          .sort((a, b) => a.account_name.localeCompare(b.account_name))
          .map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const visibleRoots = roots
    .filter(root => nodeMatches(root))
    .sort((a, b) => a.account_name.localeCompare(b.account_name));

  return (
    <div style={{ maxHeight: '220px', overflowY: 'auto', paddingBottom: '4px' }}>
      {visibleRoots.length === 0
        ? <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>No matching accounts</div>
        : visibleRoots.map(root => renderNode(root))}
    </div>
  );
};

const Transactions = () => {
  const navigate = useNavigate();
  const location = useLocation();  // read nav state BEFORE lazy useState inits below
  const [searchParams, setSearchParams] = useSearchParams();
  const { toasts, showToast } = useToast();
  const [isCategorizing, setIsCategorizing] = useState(() => {
    return localStorage.getItem('isCategorizing') === 'true';
  });
  const [categoriseStatus, setCategoriseStatus] = useState(() => {
    return localStorage.getItem('categoriseStatus') || '';
  });
  const [isApprovingBulk, setIsApprovingBulk] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [recatTarget, setRecatTarget] = useState(null);
  const [manualTarget, setManualTarget] = useState(null);
  const [srcAccTarget, setSrcAccTarget] = useState(null);
  const [approvingIds, setApprovingIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [correctingId, setCorrectingId] = useState(null);
  const [cachedAccounts, setCachedAccounts] = useState([]);

  // ── Pipeline processing state — documents being auto-categorised ————————
  const [processingDocIds, setProcessingDocIds] = useState(new Set());
  const [failedDocIds, setFailedDocIds] = useState(new Set());
  const [docNames, setDocNames] = useState({});
  const [retrying, setRetrying] = useState(false);

  // ── Pipeline progress bar — time-based, synced to real completion ──────────
  const [pipelineStartedAt, setPipelineStartedAt] = useState(null); // earliest pipeline_started_at ms
  const [pipelineProgress, setPipelineProgress] = useState(0);      // 0-100
  const [pipelineErrorMsg, setPipelineErrorMsg] = useState('');     // contextual error hint
  const progressIntervalRef = useRef(null);
  const PIPELINE_ESTIMATED_MS = 35_000; // 35 s = comfortable upper bound

  // ── Similar transactions popup state ────────────────────────────
  const [similarTxns, setSimilarTxns] = useState([]);
  const [similarSuggestedAccount, setSimilarSuggestedAccount] = useState(null);
  const [similarAccountOverrides, setSimilarAccountOverrides] = useState({});
  const [similarPickerTarget, setSimilarPickerTarget] = useState(null);
  const [isApprovingSimilar, setIsApprovingSimilar] = useState(false);

  // ── Manual Review popup state ─────────────────────────────────────
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewEditState, setReviewEditState] = useState({}); // keyed by uncategorized_transaction_id
  const [reviewPickerField, setReviewPickerField] = useState(null); // 'src' | 'dest'
  const [reviewValidationMsg, setReviewValidationMsg] = useState('');
  const [reviewApproving, setReviewApproving] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);

  // ── Manual Add popup state ────────────────────────────────────────
  const EMPTY_MANUAL_FORM = {
    txn_date: new Date().toISOString().split('T')[0],
    details: '',
    amount: '',
    transaction_type: 'DEBIT',
    base_account_id: null,
    _src_account_name: '',
    offset_account_id: null,
    _offset_account_name: '',
    user_note: '',
  };
  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [manualAddForm, setManualAddForm] = useState(EMPTY_MANUAL_FORM);
  const [manualAddPicker, setManualAddPicker] = useState(null); // 'src' | 'dest'
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  const [manualAddSaving, setManualAddSaving] = useState(false);
  const [manualAddError, setManualAddError] = useState('');

  // ── Filter popup state ────────────────────────────────────────
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const [filterAccounts, setFilterAccounts] = useState([]); // { account_id, account_name }
  const [filterDocuments, setFilterDocuments] = useState([]); // { document_id, file_name }
  const [selectedAccountIds, setSelectedAccountIds] = useState(() => {
    // Seeded from Accounts page navigation state (srcAccId = bank/CC account)
    const id = location.state?.srcAccId;
    return id ? new Set([id]) : new Set();
  });
  const [selectedDocIds, setSelectedDocIds] = useState(new Set());
  const [selectedOffsetAccountIds, setSelectedOffsetAccountIds] = useState(() => {
    // Seeded from Accounts page navigation state (destAccId = COA account)
    const id = location.state?.destAccId;
    return id ? new Set([id]) : new Set();
  }); // dest-account filter
  const [offsetAccountSearch, setOffsetAccountSearch] = useState(''); // search within dest-account tree
  const [txnTypeFilter, setTxnTypeFilter] = useState('ALL'); // 'ALL' | 'DEBIT' | 'CREDIT'
  const [searchQuery, setSearchQuery] = useState('');
  const [dateSortOrder, setDateSortOrder] = useState('desc'); // 'asc' | 'desc'
  
  // ── Date Range popup state ────────────────────────────────────
  const [isDatePopupOpen, setIsDatePopupOpen] = useState(false);
  const datePopupRef = useRef(null);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const toLocalISO = (d) => {
    const tzoffset = d.getTimezoneOffset() * 60000; // offset in milliseconds
    return new Date(d - tzoffset).toISOString().split('T')[0];
  };

  const setQuickDate = (option) => {
    const today = new Date();
    let start = '';
    let end = toLocalISO(today);

    if (option === '7D') {
      const d = new Date(today);
      d.setDate(today.getDate() - 7);
      start = toLocalISO(d);
    } else if (option === '30D') {
      const d = new Date(today);
      d.setDate(today.getDate() - 30);
      start = toLocalISO(d);
    } else if (option === 'THIS_MONTH') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      start = toLocalISO(d);
    } else if (option === 'LAST_MONTH') {
      const dStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const dEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      start = toLocalISO(dStart);
      end = toLocalISO(dEnd);
    } else if (option === 'THIS_YEAR') {
      const d = new Date(today.getFullYear(), 0, 1);
      start = toLocalISO(d);
    } else if (option === 'LAST_FY') {
      const currentYear = today.getFullYear();
      let startYear = currentYear - 1;
      let endYear = currentYear;
      if (today.getMonth() < 3) { // Jan-Mar (0-2)
          startYear = currentYear - 2;
          endYear = currentYear - 1;
      }
      const dStart = new Date(startYear, 3, 1); // April 1st
      const dEnd = new Date(endYear, 2, 31); // March 31st
      start = toLocalISO(dStart);
      end = toLocalISO(dEnd);
    }
    setDateRange({ start, end });
  };

  const fetchTransactions = async (currentFilter = activeFilter, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('uncategorized_transactions')
        .select(`
          uncategorized_transaction_id,
          txn_date,
          details,
          debit,
          credit,
          document_id,
          account_id,
          group_id,
          source_account:account_id ( account_id, account_name ),
          source_document:document_id ( document_id, file_name ),
          transactions!uncategorized_transaction_id (
            transaction_id,
            review_status,
            attention_level,
            offset_account_id,
            categorised_by,
            is_uncategorised,
            user_note,
            accounts:offset_account_id (
              account_name
            )
          )
        `)
        .eq('user_id', user.id)
        .order('txn_date', { ascending: false });

      if (error) throw error;

      setTransactions(data || []);

      // ── Check which documents are still being processed by the auto-pipeline
      const docIds = [...new Set((data || []).map(t => t.document_id).filter(Boolean))];
      if (docIds.length > 0) {
        const { data: docStatuses } = await supabase
          .from('documents')
          .select('document_id, file_name, grouping_status, pipeline_started_at, created_at')
          .in('document_id', docIds);

        if (docStatuses) {
          setDocNames(prev => {
            const next = { ...prev };
            docStatuses.forEach(d => { if (d.file_name) next[d.document_id] = d.file_name; });
            return next;
          });
        }

        const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;     // 5 min: running but no finish
        const NULL_PIPELINE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min: never started (backend asleep)
        const stillProcessing = new Set();
        const failed = new Set();
        const startedAts = [];
        let errorHint = '';

        for (const doc of docStatuses || []) {
          if (doc.grouping_status === 'pipeline_done') continue;
          if (doc.grouping_status === 'pipeline_failed') {
            failed.add(doc.document_id);
            errorHint = 'pipeline_failed';
            continue;
          }

          // Case 1: pipeline_started_at is NULL — backend was asleep and never picked this up
          const neverStarted = (
            !doc.pipeline_started_at &&
            doc.created_at &&
            (doc.grouping_status === 'done' || doc.grouping_status === 'pending') &&
            Date.now() - new Date(doc.created_at).getTime() > NULL_PIPELINE_TIMEOUT_MS
          );

          // Case 2: pipeline started but timed out
          const isStale = (
            (doc.grouping_status === 'pipeline_running' || doc.grouping_status === 'done' || doc.grouping_status === 'pending') &&
            doc.pipeline_started_at &&
            Date.now() - new Date(doc.pipeline_started_at).getTime() > PIPELINE_TIMEOUT_MS
          );

          if (neverStarted) {
            failed.add(doc.document_id);
            errorHint = errorHint || 'never_started';
            continue;
          }

          if (isStale) {
            failed.add(doc.document_id);
            errorHint = errorHint || 'stale';
            continue;
          }
          stillProcessing.add(doc.document_id);
          if (doc.pipeline_started_at) startedAts.push(new Date(doc.pipeline_started_at).getTime());
        }

        if (errorHint) setPipelineErrorMsg(errorHint);

        // Capture the earliest started_at so the progress bar knows when processing began
        if (startedAts.length > 0) {
          setPipelineStartedAt(prev => prev ?? Math.min(...startedAts));
        }

        setProcessingDocIds(stillProcessing);
        setFailedDocIds(failed);
      } else {
        setProcessingDocIds(new Set());
        setFailedDocIds(new Set());
      }

      // Auto-select LOW attention when filtering to PENDING_APP
      if (currentFilter === 'PENDING_APP') {
        const lowAttentionIds = new Set();
        (data || []).forEach((txn) => {
          const isCategorised = txn.transactions && txn.transactions.length > 0;
          if (isCategorised && txn.transactions[0].review_status === 'PENDING') {
            const isUncategorised = txn.transactions[0].is_uncategorised;
            if (txn.transactions[0].attention_level === 'LOW' && !isUncategorised) {
              lowAttentionIds.add(txn.transactions[0].transaction_id);
            }
          }
        });
        setSelectedIds(lowAttentionIds);
      }
    } catch (err) {
      console.error('Fetch transactions failed:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Populate filter options once on mount
  useEffect(() => {
    fetchTransactions('ALL');

    // Check if categorization was running when user left - show notification
    if (localStorage.getItem('isCategorizing') === 'true') {
      showToast('Categorization is still running in the background. You can continue using the app.', 'info');
    }

    const loadFilterOptions = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Distinct accounts that appear in uncategorized_transactions
      const { data: accData } = await supabase
        .from('uncategorized_transactions')
        .select('source_account:account_id ( account_id, account_name )')
        .eq('user_id', user.id);

      const { data: docData } = await supabase
        .from('uncategorized_transactions')
        .select('source_document:document_id ( document_id, file_name )')
        .eq('user_id', user.id);

      // De-duplicate
      const accMap = {};
      (accData || []).forEach(r => {
        if (r.source_account) accMap[r.source_account.account_id] = r.source_account;
      });
      const docMap = {};
      (docData || []).forEach(r => {
        if (r.source_document) docMap[r.source_document.document_id] = r.source_document;
      });

      setFilterAccounts(Object.values(accMap));
      setFilterDocuments(Object.values(docMap));
    };

    const loadAllAccounts = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: acctData } = await supabase
        .from('accounts')
        .select('account_id, account_name, account_type, balance_nature, parent_account_id, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('account_type', { ascending: true })
        .order('account_name', { ascending: true });

      setCachedAccounts(acctData || []);
    };

    loadFilterOptions();
    loadAllAccounts();
  }, []);

  // Clear the navigation state from history so the filter isn't re-applied
  // on back/forward navigation (the filter is already in React state).
  useEffect(() => {
    if (location.state?.srcAccId || location.state?.destAccId) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, []);

  // ── Poll documents table while any are still being pipeline-processed ——————
  useEffect(() => {
    if (processingDocIds.size === 0) return;

    const interval = setInterval(async () => {
      const { data: docStatuses } = await supabase
        .from('documents')
        .select('document_id, file_name, grouping_status, pipeline_started_at, created_at')
        .in('document_id', [...processingDocIds]);

      if (docStatuses) {
        setDocNames(prev => {
          const next = { ...prev };
          docStatuses.forEach(d => { if (d.file_name) next[d.document_id] = d.file_name; });
          return next;
        });
      }

      const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;
      const NULL_PIPELINE_TIMEOUT_MS = 3 * 60 * 1000;
      const stillProcessing = new Set();
      const failed = new Set();
      let errorHint = '';

      for (const doc of docStatuses || []) {
        if (doc.grouping_status === 'pipeline_done') continue;
        if (doc.grouping_status === 'pipeline_failed') {
          failed.add(doc.document_id);
          errorHint = 'pipeline_failed';
          continue;
        }

        // Case 1: never started (backend was asleep)
        const neverStarted = (
          !doc.pipeline_started_at &&
          doc.created_at &&
          (doc.grouping_status === 'done' || doc.grouping_status === 'pending') &&
          Date.now() - new Date(doc.created_at).getTime() > NULL_PIPELINE_TIMEOUT_MS
        );

        // Case 2: started but timed out
        if (
          doc.grouping_status === 'pipeline_running' &&
          doc.pipeline_started_at &&
          Date.now() - new Date(doc.pipeline_started_at).getTime() > PIPELINE_TIMEOUT_MS
        ) {
          failed.add(doc.document_id);
          errorHint = errorHint || 'stale';
          continue;
        }

        if (neverStarted) {
          failed.add(doc.document_id);
          errorHint = errorHint || 'never_started';
          continue;
        }

        stillProcessing.add(doc.document_id);
        // Keep pipelineStartedAt seeded in case fetchTransactions missed it
        if (doc.pipeline_started_at) {
          setPipelineStartedAt(prev => prev ?? new Date(doc.pipeline_started_at).getTime());
        }
      }

      if (errorHint) setPipelineErrorMsg(errorHint);

      setProcessingDocIds(stillProcessing);
      setFailedDocIds(prev => new Set([...prev, ...failed]));

      if (stillProcessing.size === 0) {
        clearInterval(interval);
        fetchTransactions(activeFilter, true); // silent refresh to show new rows
      }
    }, 4000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingDocIds]);

  // ── Drive the progress bar: tick forward based on elapsed time, jump to 100% on completion ──
  useEffect(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

    if (processingDocIds.size === 0) {
      if (pipelineProgress > 0 && pipelineProgress < 100) {
        // Pipeline just finished — snap to 100%, then reset after a brief pause
        setPipelineProgress(100);
        const done = setTimeout(() => {
          setPipelineProgress(0);
          setPipelineStartedAt(null);
        }, 700);
        return () => clearTimeout(done);
      }
      return;
    }

    if (!pipelineStartedAt) return; // haven't captured start time yet — wait next poll

    // Tick every 250 ms — fill using a logarithmic curve that slows near 90%
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - pipelineStartedAt;
      const fraction = elapsed / PIPELINE_ESTIMATED_MS;
      // Logarithmic: fast early, asymptotically approaches 90%
      const pct = 90 * (1 - Math.exp(-3 * fraction));
      setPipelineProgress(Math.min(90, Math.max(3, pct))); // always show at least 3%
    }, 250);

    return () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingDocIds.size, pipelineStartedAt]);

  // Close popups on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setIsFilterOpen(false);
      }
      if (datePopupRef.current && !datePopupRef.current.contains(e.target)) {
        setIsDatePopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleAccountFilter = (id) => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleDocFilter = (id) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleOffsetAccountFilter = (id) => {
    setSelectedOffsetAccountIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Returns the set of account_ids that are the given root OR any descendant of it
  const getDescendantIds = (rootId, allAccounts) => {
    const result = new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift();
      allAccounts.forEach(acc => {
        if (acc.parent_account_id === current && !result.has(acc.account_id)) {
          result.add(acc.account_id);
          queue.push(acc.account_id);
        }
      });
    }
    return result;
  };

  // Expanded set of all offset account ids that should pass the filter
  // (i.e. any selected account + all its descendants)
  const expandedOffsetIds = React.useMemo(() => {
    if (selectedOffsetAccountIds.size === 0) return new Set();
    const expanded = new Set();
    selectedOffsetAccountIds.forEach(id => {
      getDescendantIds(id, cachedAccounts).forEach(d => expanded.add(d));
    });
    return expanded;
  }, [selectedOffsetAccountIds, cachedAccounts]);

  // Same expansion for the source (bank/CC) account filter
  const expandedSrcIds = React.useMemo(() => {
    if (selectedAccountIds.size === 0) return new Set();
    const expanded = new Set();
    selectedAccountIds.forEach(id => {
      getDescendantIds(id, cachedAccounts).forEach(d => expanded.add(d));
    });
    return expanded;
  }, [selectedAccountIds, cachedAccounts]);

  const clearAllFilters = () => {
    setSelectedAccountIds(new Set());
    setSelectedDocIds(new Set());
    setSelectedOffsetAccountIds(new Set());
    setTxnTypeFilter('ALL');
  };

  const activeFilterCount = selectedAccountIds.size + selectedDocIds.size + selectedOffsetAccountIds.size + (txnTypeFilter !== 'ALL' ? 1 : 0);

  const handleAccountCreated = (newAccount) => {
    setCachedAccounts(prev => [...prev, newAccount]);
  };

  // ── Shared helper: patch one row in local state by uncategorized_transaction_id ──
  const updateTxnInState = (uncatId, patchFn) => {
    setTransactions(prev => prev.map(txn =>
      txn.uncategorized_transaction_id === uncatId ? patchFn(txn) : txn
    ));
  };

  // ── Returns true when the document for this row is still being auto-processed ──
  const isRowProcessing = (txn) => processingDocIds.has(txn.document_id);
  // ── Returns true when the document for this row has a pipeline failure ───────
  const isRowFailed = (txn) => failedDocIds.has(txn.document_id);

  // ── Retry handler: re-triggers pipeline for every failed document ──────────
  const handleRetryPipeline = async () => {
    setRetrying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      for (const docId of failedDocIds) {
        await fetch(`${API_BASE_URL}/api/transactions/retry-pipeline`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ document_id: docId }),
        });
      }
      // Move failed docs back into the processing bucket so polling resumes
      setProcessingDocIds(prev => new Set([...prev, ...failedDocIds]));
      setFailedDocIds(new Set());
      setPipelineErrorMsg('');
    } catch (err) {
      console.error('Retry pipeline failed:', err);
      showToast('Failed to retry pipeline. Please try again.', 'error');
    } finally {
      setRetrying(false);
    }
  };

  const handleCategorize = async () => {
    const uncategorizedItems = filteredTransactions.filter(
      txn => !(txn.transactions && txn.transactions.length > 0)
    );
    if (uncategorizedItems.length === 0) {
      showToast('All transactions are already categorised!', 'success');
      return;
    }
    setIsCategorizing(true);
    localStorage.setItem('isCategorizing', 'true');
    setCategoriseStatus('Starting…');
    localStorage.setItem('categoriseStatus', 'Starting…');
    showToast('Categorization started. You can continue using other parts of the app.', 'info');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${API_BASE_URL}/api/transactions/categorize-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ 
          document_ids: [...new Set(uncategorizedItems.map(t => t.document_id))] 
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.message) {
              setCategoriseStatus(payload.message);
              localStorage.setItem('categoriseStatus', payload.message);
            }
            if (payload.flush) {
              fetchTransactions(activeFilter, true);
            }
            if (payload.done) {
              showToast('✅ Bulk categorise success!', 'success');
              fetchTransactions(activeFilter, true);
            }
            if (payload.type === 'error' || payload.error) {
              showToast(payload.message || 'Bulk categorisation failed', 'error');
              break; // Error from backend means we should stop
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error('Categorise failed:', err);
      showToast('Failed to categorise transactions', 'error');
    } finally {
      setIsCategorizing(false);
      localStorage.removeItem('isCategorizing');
      setCategoriseStatus('');
      localStorage.removeItem('categoriseStatus');
    }
  };

  const handleApprove = (transactionId, isUncategorised, uncatId) => {
    if (isUncategorised) {
      showToast('Cannot approve: transaction uses uncategorised account. Please assign a category first.', 'error');
      return;
    }
    // Snapshot for rollback
    const prev = transactions.find(t => t.uncategorized_transaction_id === uncatId);
    // Update immediately — zero perceived latency
    updateTxnInState(uncatId, txn => ({
      ...txn,
      transactions: [{ ...txn.transactions[0], review_status: 'APPROVED' }]
    }));
    // Fire API and handle similar-txn popup
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${API_BASE_URL}/api/transactions/${transactionId}/approve`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
          }
        });
        if (!response.ok) {
          const errorData = await response.json();
          showToast(errorData.error || 'Failed to approve — reverted', 'error');
          // Roll back
          if (prev) setTransactions(p => p.map(t =>
            t.uncategorized_transaction_id === uncatId ? prev : t
          ));
        } else {
          // Show similar transactions popup if the server found any
          const result = await response.json();
          if (result.similarTransactions?.length > 0) {
            setSimilarTxns(result.similarTransactions);
            setSimilarSuggestedAccount(result.suggestedAccount);
            setSimilarAccountOverrides({});
          }
        }
      } catch {
        showToast('Failed to approve — reverted', 'error');
        if (prev) setTransactions(p => p.map(t =>
          t.uncategorized_transaction_id === uncatId ? prev : t
        ));
      }
    })();
  };

  const handleApproveSelected = async () => {
    if (selectedIds.size === 0) return;
    
    // We only approve rows that are categorised (have a transaction_id)
    const transactionIdsToApprove = filteredTransactions
      .filter(t => selectedIds.has(t.uncategorized_transaction_id) && t.transactions?.length > 0 && !t.transactions[0].is_uncategorised)
      .map(t => t.transactions[0].transaction_id);

    if (transactionIdsToApprove.length === 0) {
      showToast('No categorised transactions selected to approve.', 'info');
      return;
    }

    setIsApprovingBulk(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_BASE_URL}/api/transactions/approve-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ transaction_ids: transactionIdsToApprove })
      });
      fetchTransactions(activeFilter, true);
      setSelectedIds(new Set());
    } catch (err) {
      showToast('Bulk approval failed', 'error');
    } finally {
      setIsApprovingBulk(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsApprovingBulk(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${API_BASE_URL}/api/transactions/approve-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ transaction_ids: Array.from(selectedIds) })
      });

      const data = await response.json();

      if (response.ok) {
        if (data.blocked_count && data.blocked_count > 0) {
          showToast(`${data.approved_count} transactions approved. ${data.blocked_count} transactions require categorisation.`, 'warning');
        } else {
          showToast(`${data.approved_count} transactions approved`, 'success');
        }
        // Optimistic: mark approved IDs as APPROVED in local state
        const blockedSet = new Set(data.blocked_transaction_ids || []);
        setTransactions(prev => prev.map(txn => {
          if (!txn.transactions?.[0]) return txn;
          const tid = txn.transactions[0].transaction_id;
          if (selectedIds.has(tid) && !blockedSet.has(tid)) {
            return { ...txn, transactions: [{ ...txn.transactions[0], review_status: 'APPROVED' }] };
          }
          return txn;
        }));
        setSelectedIds(new Set());
      } else {
        if (data.blocked_transaction_ids && data.blocked_transaction_ids.length > 0) {
          const blockedCount = data.blocked_transaction_ids.length;
          showToast(`Cannot approve: ${blockedCount} transactions are uncategorised.`, 'error');
        } else {
          showToast(data.error || 'Bulk approval failed', 'error');
        }
      }
    } catch (err) {
      console.error('Bulk approve failed:', err);
      showToast('Bulk approval failed', 'error');
    } finally {
      setIsApprovingBulk(false);
    }
  };

  const handleRecategorize = (selectedAccount) => {
    const uncatId = recatTarget.uncategorized_transaction_id;
    const transactionId = recatTarget.transactions[0].transaction_id;
    const prevTxn = transactions.find(t => t.uncategorized_transaction_id === uncatId);
    // Close modal & update UI immediately
    setRecatTarget(null);
    updateTxnInState(uncatId, txn => ({
      ...txn,
      transactions: [{
        ...txn.transactions[0],
        offset_account_id: selectedAccount.account_id,
        accounts: { account_name: selectedAccount.account_name },
        categorised_by: 'MANUAL',
        review_status: 'APPROVED',
        is_uncategorised: false,
      }]
    }));
    // Fire API in background
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(
          `${API_BASE_URL}/api/transactions/${transactionId}/recategorize`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || ''}`
            },
            body: JSON.stringify({ offset_account_id: selectedAccount.account_id })
          }
        );
        const result = await response.json();
        if (response.ok) {
          // Trigger auto-approve in the background
          fetch(`${API_BASE_URL}/api/transactions/${transactionId}/approve`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || ''}`
            }
          }).catch(console.error);

          if (result.similarTransactions && result.similarTransactions.length > 0) {
            setSimilarTxns(result.similarTransactions);
            setSimilarSuggestedAccount(result.suggestedAccount);
            setSimilarAccountOverrides({});
          }
        } else {
          showToast('Failed to update category — reverted', 'error');
          if (prevTxn) setTransactions(p => p.map(t =>
            t.uncategorized_transaction_id === uncatId ? prevTxn : t
          ));
        }
      } catch {
        showToast('Failed to update category — reverted', 'error');
        if (prevTxn) setTransactions(p => p.map(t =>
          t.uncategorized_transaction_id === uncatId ? prevTxn : t
        ));
      }
    })();
  };

  const handleManualCategorize = (selectedAccount) => {
    const uncatId = manualTarget.uncategorized_transaction_id;
    const prevTxn = transactions.find(t => t.uncategorized_transaction_id === uncatId);
    // Close modal & update UI immediately
    setManualTarget(null);
    updateTxnInState(uncatId, txn => ({
      ...txn,
      transactions: [{
        transaction_id: null, // will be filled by server, not needed for display
        review_status: 'APPROVED',
        attention_level: 'LOW',
        offset_account_id: selectedAccount.account_id,
        categorised_by: 'MANUAL',
        is_uncategorised: false,
        accounts: { account_name: selectedAccount.account_name },
      }]
    }));
    // Fire API in background
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${API_BASE_URL}/api/transactions/manual-categorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({
            uncategorized_transaction_id: uncatId,
            offset_account_id: selectedAccount.account_id
          })
        });
        const result = await response.json();
        if (response.ok) {
          if (result.similarTransactions && result.similarTransactions.length > 0) {
            setSimilarTxns(result.similarTransactions);
            setSimilarSuggestedAccount(result.suggestedAccount);
            setSimilarAccountOverrides({});
          }
        } else {
          showToast('Failed to save categorization — reverted', 'error');
          if (prevTxn) setTransactions(p => p.map(t =>
            t.uncategorized_transaction_id === uncatId ? prevTxn : t
          ));
        }
      } catch {
        showToast('Failed to save categorization — reverted', 'error');
        if (prevTxn) setTransactions(p => p.map(t =>
          t.uncategorized_transaction_id === uncatId ? prevTxn : t
        ));
      }
    })();
  };

  const handleChangeSourceAccount = (selectedAccount) => {
    const uncatId = srcAccTarget.uncategorized_transaction_id;
    const prevTxn = transactions.find(t => t.uncategorized_transaction_id === uncatId);
    setSrcAccTarget(null);
    updateTxnInState(uncatId, txn => ({
      ...txn,
      account_id: selectedAccount.account_id,
      source_account: { account_id: selectedAccount.account_id, account_name: selectedAccount.account_name },
      transactions: txn.transactions?.length > 0 ? [{
        ...txn.transactions[0],
        base_account_id: selectedAccount.account_id
      }] : txn.transactions
    }));
    
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${API_BASE_URL}/api/transactions/${uncatId}/source-account`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({ account_id: selectedAccount.account_id })
        });
        if (!response.ok) {
          const data = await response.json();
          showToast(data.error || 'Failed to update source account — reverted', 'error');
          if (prevTxn) setTransactions(p => p.map(t =>
            t.uncategorized_transaction_id === uncatId ? prevTxn : t
          ));
        }
      } catch {
        showToast('Failed to update source account — reverted', 'error');
        if (prevTxn) setTransactions(p => p.map(t =>
          t.uncategorized_transaction_id === uncatId ? prevTxn : t
        ));
      }
    })();
  };

  const handleSimilarBulkConfirm = async () => {
    setIsApprovingSimilar(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      };

      // Split: pre-pipeline txns (no transaction_id yet) vs already-in-transactions-table
      const prePipeline = similarTxns.filter(t => t.is_pre_pipeline);
      const normal     = similarTxns.filter(t => !t.is_pre_pipeline);

      // Pre-pipeline → manual-categorize (creates + approves in one step)
      await Promise.all(prePipeline.map(txn => {
        const account = similarAccountOverrides[txn.uncategorized_transaction_id] || similarSuggestedAccount;
        return fetch(`${API_BASE_URL}/api/transactions/manual-categorize`, {
          method: 'POST', headers,
          body: JSON.stringify({
            uncategorized_transaction_id: txn.uncategorized_transaction_id,
            offset_account_id: account.account_id
          })
        });
      }));

      // Normal → recategorize to apply any account override, then bulk-approve
      if (normal.length > 0) {
        await Promise.all(normal.map(txn => {
          const account = similarAccountOverrides[txn.transaction_id] || similarSuggestedAccount;
          return fetch(`${API_BASE_URL}/api/transactions/${txn.transaction_id}/recategorize`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ offset_account_id: account.account_id })
          });
        }));
        await fetch(`${API_BASE_URL}/api/transactions/approve-bulk`, {
          method: 'POST', headers,
          body: JSON.stringify({ transaction_ids: normal.map(t => t.transaction_id) })
        });
      }

      showToast(`${similarTxns.length} similar transactions confirmed`, 'success');
      setSimilarTxns([]);
      setSimilarSuggestedAccount(null);

      // Remove confirmed transactions from the review queue so they don't show
      // up as pending cards when the user resumes the review flow.
      // Both pre-pipeline and normal txns now carry uncategorized_transaction_id.
      const confirmedUncatIds = new Set(
        similarTxns
          .map(t => t.uncategorized_transaction_id)
          .filter(Boolean)
      );
      if (confirmedUncatIds.size > 0) {
        setReviewQueue(prev => {
          const filtered = prev.filter(
            q => !confirmedUncatIds.has(q.uncategorized_transaction_id)
          );
          // Clamp reviewIndex so it doesn't point past the end
          setReviewIndex(i => Math.min(i, Math.max(0, filtered.length - 1)));
          return filtered;
        });
      }

      fetchTransactions(activeFilter, true);
    } catch (err) {
      showToast('Failed to confirm similar transactions', 'error');
    } finally {
      setIsApprovingSimilar(false);
    }
  };

  const handleSimilarIndividualApprove = async (txn) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`
      };
      // Unique key used to look up any per-row account override
      const overrideKey = txn.transaction_id ?? txn.uncategorized_transaction_id;
      const account = similarAccountOverrides[overrideKey] || similarSuggestedAccount;

      if (txn.is_pre_pipeline) {
        // No transactions row yet — manual-categorize creates + approves in one step
        await fetch(`${API_BASE_URL}/api/transactions/manual-categorize`, {
          method: 'POST', headers,
          body: JSON.stringify({
            uncategorized_transaction_id: txn.uncategorized_transaction_id,
            offset_account_id: account.account_id
          })
        });
      } else {
        await fetch(`${API_BASE_URL}/api/transactions/${txn.transaction_id}/recategorize`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ offset_account_id: account.account_id })
        });
        await fetch(`${API_BASE_URL}/api/transactions/${txn.transaction_id}/approve`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${session?.access_token || ''}` }
        });
      }

      // Remove from similar popup list
      const confirmedUncatId = txn.uncategorized_transaction_id;
      setSimilarTxns(prev => {
        const remaining = prev.filter(t =>
          txn.is_pre_pipeline
            ? t.uncategorized_transaction_id !== txn.uncategorized_transaction_id
            : t.transaction_id !== txn.transaction_id
        );
        if (remaining.length === 0) fetchTransactions(activeFilter, true);
        return remaining;
      });

      // Also remove from review queue if the txn has a matching uncategorized_transaction_id
      if (confirmedUncatId) {
        setReviewQueue(prev => {
          const filtered = prev.filter(q => q.uncategorized_transaction_id !== confirmedUncatId);
          setReviewIndex(i => Math.min(i, Math.max(0, filtered.length - 1)));
          return filtered;
        });
      }
    } catch (err) {
      showToast('Failed to approve transaction', 'error');
    }
  };

  const handleCorrect = (uncategorizedTransactionId, amount, transaction_type) => {
    const prevTxn = transactions.find(t => t.uncategorized_transaction_id === uncategorizedTransactionId);
    // Update immediately
    setCorrectingId(null);
    updateTxnInState(uncategorizedTransactionId, txn => {
      const updatedTxn = {
        ...txn,
        debit: transaction_type === 'DEBIT' ? amount : 0,
        credit: transaction_type === 'CREDIT' ? amount : 0,
      };
      if (txn.transactions && txn.transactions.length > 0) {
        updatedTxn.transactions = [{ ...txn.transactions[0], review_status: 'PENDING' }];
      } else {
        updatedTxn.transactions = [];
      }
      return updatedTxn;
    });
    // Fire API in background
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(
          `${API_BASE_URL}/api/transactions/${uncategorizedTransactionId}/correct`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || ''}`
            },
            body: JSON.stringify({ amount, transaction_type })
          }
        );
        const data = await response.json();
        if (response.status === 403) {
          showToast(data.error, 'error');
          if (prevTxn) setTransactions(p => p.map(t =>
            t.uncategorized_transaction_id === uncategorizedTransactionId ? prevTxn : t
          ));
        } else if (!response.ok) {
          showToast(data.error || 'Failed to correct — reverted', 'error');
          if (prevTxn) setTransactions(p => p.map(t =>
            t.uncategorized_transaction_id === uncategorizedTransactionId ? prevTxn : t
          ));
        }
      } catch {
        showToast('Failed to correct — reverted', 'error');
        if (prevTxn) setTransactions(p => p.map(t =>
          t.uncategorized_transaction_id === uncategorizedTransactionId ? prevTxn : t
        ));
      }
    })();
  };

  // ── Manual Review helpers ─────────────────────────────────────────

  /**
   * Build the ordered review queue.
   *
   * CATEGORISED rows (have a non-APPROVED transactions row):
   *   1. Sort by attention_level HIGH→MEDIUM→LOW
   *   2. Within same level, sort by txn_date ascending
   *   3. Walk the sorted list; when a txn is first encountered, immediately
   *      pull in all its remaining siblings (same group_id) so they
   *      appear consecutively. The "stored index" (position in the primary
   *      sorted list) is only advanced after the full sibling group is done.
   *
   * UNCATEGORISED rows (no transactions row at all):
   *   1. Sort by txn_date ascending
   *   2. Within the same date, group by group_id
   *
   * Categorised rows come before uncategorised rows in the final queue.
   */
  const buildReviewQueue = () => {
    const ATTENTION_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const categorised = [];
    const uncategorised = [];

    filteredTransactions.forEach(txn => {
      const txnRow = txn.transactions?.[0];

      // If there's an active selection, restrict queue to only selected transactions
      if (selectedIds.size > 0) {
        if (!selectedIds.has(txn.uncategorized_transaction_id)) return;
      }

      if (txnRow && txnRow.review_status !== 'APPROVED') {
        categorised.push(txn);
      } else if (!txn.transactions || txn.transactions.length === 0) {
        uncategorised.push(txn);
      }
    });

    // ── CATEGORISED: attention_level → txn_date, then sibling-walk ────────────
    categorised.sort((a, b) => {
      const aRow = a.transactions[0];
      const bRow = b.transactions[0];
      const attRank =
        (ATTENTION_RANK[aRow.attention_level] ?? 2) -
        (ATTENTION_RANK[bRow.attention_level] ?? 2);
      if (attRank !== 0) return attRank;
      return new Date(a.txn_date).getTime() - new Date(b.txn_date).getTime();
    });

    // Walk the sorted list. When a txn is first seen, immediately pull ALL of
    // its remaining siblings (any date, same attention_level bucket) right
    // after it. The outer loop index i ("stored index") only advances once
    // all siblings of that group have been collected.
    const catResult = [];
    const catSeen = new Set();
    for (let i = 0; i < categorised.length; i++) {
      const txn = categorised[i];
      if (catSeen.has(txn.uncategorized_transaction_id)) continue; // already pulled in as a sibling
      catResult.push(txn);
      catSeen.add(txn.uncategorized_transaction_id);
      // Pull remaining siblings before advancing i
      if (txn.group_id) {
        for (let j = i + 1; j < categorised.length; j++) {
          const sib = categorised[j];
          if (
            sib.group_id === txn.group_id &&
            !catSeen.has(sib.uncategorized_transaction_id)
          ) {
            catResult.push(sib);
            catSeen.add(sib.uncategorized_transaction_id);
          }
        }
      }
      // i increments naturally — siblings already in catSeen are skipped by the guard above
    }

    // ── UNCATEGORISED: txn_date → group_id (within same date) ───────
    uncategorised.sort((a, b) => {
      const dateD =
        new Date(a.txn_date).getTime() - new Date(b.txn_date).getTime();
      if (dateD !== 0) return dateD;
      // Within the same date, group siblings together
      const aGrp = a.group_id || '';
      const bGrp = b.group_id || '';
      return aGrp.localeCompare(bGrp);
    });

    return [...catResult, ...uncategorised];
  };

  const openReview = (startId = null) => {
    const queue = buildReviewQueue();
    if (queue.length === 0) {
      showToast('No transactions to review', 'info');
      return;
    }
    setReviewQueue(queue);
    
    let initialIndex = 0;
    if (startId) {
      const idx = queue.findIndex(t => t.uncategorized_transaction_id === startId);
      if (idx !== -1) initialIndex = idx;
    }

    setReviewIndex(initialIndex);
    setReviewEditState({});
    setReviewValidationMsg('');
    setReviewDone(false);
    setIsReviewOpen(true);
  };

  const handleManualAddSave = async () => {
    const { txn_date, details, amount, transaction_type, base_account_id, offset_account_id, user_note } = manualAddForm;
    if (!txn_date) { setManualAddError('Date is required.'); return; }
    if (!details.trim()) { setManualAddError('Details are required.'); return; }
    if (!amount || isNaN(amount) || Number(amount) <= 0) { setManualAddError('Enter a valid positive amount.'); return; }
    if (!base_account_id) { setManualAddError('Select a source account.'); return; }
    if (!offset_account_id)  { setManualAddError('Select a category / dest account.'); return; }
    setManualAddError('');
    setManualAddSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE_URL}/api/transactions/manual-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ txn_date, details: details.trim(), amount: Number(amount), transaction_type, base_account_id, offset_account_id, transaction_date: txn_date, user_note: user_note || null })
      });
      if (!res.ok) {
        const json = await res.json();
        setManualAddError(json.error || 'Failed to save transaction.');
        return;
      }
      showToast('Transaction added successfully', 'success');
      setIsManualAddOpen(false);
      setManualAddForm(EMPTY_MANUAL_FORM);
      fetchTransactions(activeFilter, true);
    } catch {
      setManualAddError('Network error. Please try again.');
    } finally {
      setManualAddSaving(false);
    }
  };

  const handleBulkAssignAccountSelect = async (account) => {
    if (selectedIds.size === 0) return;
    setIsBulkAssigning(true);
    setIsBulkAssignOpen(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE_URL}/api/transactions/assign-approve-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({
          uncategorized_transaction_ids: Array.from(selectedIds),
          offset_account_id: account.account_id
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to bulk assign');
      
      showToast(`Successfully assigned and approved ${json.approved_count} transactions`, 'success');
      setSelectedIds(new Set());
      fetchTransactions(activeFilter, true);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsBulkAssigning(false);
    }
  };

  const closeReview = () => {
    setIsReviewOpen(false);
    setReviewPickerField(null);
    setReviewValidationMsg('');
    setReviewApproving(false);
    fetchTransactions(activeFilter, true);
  };

  /** Patch the editState for current card */
  const patchReviewEdit = (uncatId, patch) => {
    setReviewEditState(prev => ({
      ...prev,
      [uncatId]: { ...(prev[uncatId] || {}), ...patch }
    }));
  };

  /**
   * Save any pending edits (except note-only) via the correct endpoint.
   * Returns the API response data (or null on failure).
   */
  const saveReviewCorrection = async (txn, edits) => {
    const uncatId = txn.uncategorized_transaction_id;
    const body = {};
    if (edits.amount !== undefined)         body.amount           = edits.amount;
    if (edits.transaction_type !== undefined) body.transaction_type = edits.transaction_type;
    if (edits.details !== undefined)        body.details          = edits.details;
    if (edits.txn_date !== undefined)       body.txn_date         = edits.txn_date;
    if (edits.base_account_id !== undefined) body.base_account_id  = edits.base_account_id;
    if (edits.user_note !== undefined)      body.user_note        = edits.user_note;

    if (Object.keys(body).length === 0) return null;

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_BASE_URL}/api/transactions/${uncatId}/correct`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Correction failed');
    return json;
  };

  /**
   * Save just the note for an already-approved transaction.
   */
  const saveNoteOnly = async (transactionId, note) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_BASE_URL}/api/transactions/${transactionId}/note`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ user_note: note })
    });
    if (!res.ok) throw new Error('Failed to save note');
  };

  /** Fire the approve API for a categorised row — returns the parsed JSON response. */
  const approveReviewTxn = async (transactionId) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_BASE_URL}/api/transactions/${transactionId}/approve`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${session?.access_token || ''}` }
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Approve failed');
    }
    return json; // contains { success, similarTransactions, suggestedAccount }
  };

  /** Fire the manual-categorize API for an uncategorised row — returns the parsed JSON response. */
  const manualCategorizeReviewTxn = async (uncatId, offsetAccountId) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_BASE_URL}/api/transactions/manual-categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ uncategorized_transaction_id: uncatId, offset_account_id: offsetAccountId })
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Categorize failed');
    }
    return json; // contains { success, similarTransactions, suggestedAccount }
  };

  /**
   * Skip handler — discard in-flight edits and move card to end of queue.
   * Nothing is saved to the DB.
   */
  const handleReviewSkip = () => {
    const current = reviewQueue[reviewIndex];
    if (!current) return;
    const uncatId = current.uncategorized_transaction_id;

    // Discard edits for this card so they don’t linger when it comes back
    setReviewEditState(prev => {
      const next = { ...prev };
      delete next[uncatId];
      return next;
    });

    // Move card to end of queue
    setReviewQueue(prev => {
      const next = [...prev];
      const [card] = next.splice(reviewIndex, 1);
      next.push({ ...card, _siblingPrefill: undefined });
      return next;
    });

    // Index stays at same position, which now points to the next card
    setReviewIndex(prev => Math.min(prev, reviewQueue.length - 2));
    setReviewValidationMsg('');
  };

  /**
   * Save & Skip handler — persist any in-flight edits to the DB, then move
   * the card to the end of the queue without approving it.
   */
  const handleReviewSaveAndSkip = async () => {
    const current = reviewQueue[reviewIndex];
    if (!current) return;
    const uncatId = current.uncategorized_transaction_id;
    const edits = reviewEditState[uncatId] || {};
    const txnRow = current.transactions?.[0];

    const CORRECTION_FIELDS = ['amount', 'transaction_type', 'details', 'txn_date', 'base_account_id', 'user_note'];
    const correctionEdits = Object.fromEntries(
      Object.entries(edits).filter(([k]) => CORRECTION_FIELDS.includes(k))
    );
    const hasCorrectionEdits = Object.keys(correctionEdits).length > 0;
    const noteOnly = hasCorrectionEdits &&
      Object.keys(correctionEdits).length === 1 &&
      correctionEdits.user_note !== undefined;

    setReviewApproving(true);
    try {
      if (hasCorrectionEdits && !noteOnly) {
        await saveReviewCorrection(current, correctionEdits);
      } else if (hasCorrectionEdits && noteOnly && txnRow?.transaction_id) {
        await saveNoteOnly(txnRow.transaction_id, correctionEdits.user_note);
      }
      // offset_account_id change alone is deferred to Approve — nothing to save here
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
      setReviewApproving(false);
      return;
    }
    setReviewApproving(false);

    // Clear edits (they’re now persisted) and move card to end of queue
    setReviewEditState(prev => {
      const next = { ...prev };
      delete next[uncatId];
      return next;
    });
    setReviewQueue(prev => {
      const next = [...prev];
      const [card] = next.splice(reviewIndex, 1);
      next.push({ ...card, _siblingPrefill: undefined });
      return next;
    });
    setReviewIndex(prev => Math.min(prev, reviewQueue.length - 2));
    setReviewValidationMsg('');
  };

  /**
   * Approve & Next handler — the main action button.
   */
  const handleReviewApprove = async () => {
    const current = reviewQueue[reviewIndex];
    if (!current) return;
    const uncatId = current.uncategorized_transaction_id;
    const edits = reviewEditState[uncatId] || {};
    const txnRow = current.transactions?.[0];
    const isCategorised = !!txnRow;

    // Resolve target offset_account_id
    const offsetAccountId = edits.offset_account_id ?? (isCategorised ? txnRow?.offset_account_id : null);
    const offsetAccountName = edits._offset_account_name ??
      (isCategorised ? txnRow?.accounts?.account_name : null);

    if (!offsetAccountId) {
      setReviewValidationMsg('Please assign a category before approving');
      return;
    }
    setReviewValidationMsg('');
    setReviewApproving(true);

    try {
      // ── Classify edits ─────────────────────────────────────────────────────
      // CORRECTION_FIELDS go to PATCH /correct and may trigger a clean-slate.
      // offset_account_id is NOT a correction field — it routes to recategorize
      // or manual-categorize. Including it in coreEdits was causing the bug where
      // manualCategorizeReviewTxn was called on an already-categorised transaction,
      // hitting the unique constraint and silently leaving the wrong account.
      const CORRECTION_FIELDS = ['amount', 'transaction_type', 'details', 'txn_date', 'base_account_id', 'user_note'];
      const correctionEdits = Object.fromEntries(
        Object.entries(edits).filter(([k]) => CORRECTION_FIELDS.includes(k))
      );
      const hasCorrectionEdits = Object.keys(correctionEdits).length > 0;
      const noteOnly = hasCorrectionEdits &&
        Object.keys(correctionEdits).length === 1 &&
        correctionEdits.user_note !== undefined;
      const offsetChanged = edits.offset_account_id !== undefined;

      // ── Step 1: Structural correction (triggers clean-slate) ───────────────
      let cleanSlateHappened = false;
      let preservedNote = edits.user_note;

      if (hasCorrectionEdits && !noteOnly) {
        const correctResult = await saveReviewCorrection(current, correctionEdits);
        if (correctResult !== null) {
          // /correct deleted the transactions row — need a fresh manualCategorize
          cleanSlateHappened = true;
        }
        if (correctResult?.preserved_note !== undefined && edits.user_note === undefined) {
          preservedNote = correctResult.preserved_note;
        }
      }

      // ── Step 2: Note-only save (no clean-slate) ────────────────────────────
      if (hasCorrectionEdits && noteOnly && txnRow?.transaction_id) {
        await saveNoteOnly(txnRow.transaction_id, correctionEdits.user_note);
      }

      // ── Step 3: Approve / categorize ──────────────────────────────────────
      let approveResult = null;
      if (!isCategorised || cleanSlateHappened) {
        // Uncategorised row, or the transactions row was just deleted by /correct.
        // Create a fresh transactions row via manual-categorize.
        approveResult = await manualCategorizeReviewTxn(uncatId, offsetAccountId);

        // Re-apply preserved note on the newly created transactions row
        if (preservedNote) {
          (async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const { data: newTxn } = await supabase
                .from('transactions')
                .select('transaction_id')
                .eq('uncategorized_transaction_id', uncatId)
                .eq('user_id', user.id)
                .maybeSingle();
              if (newTxn?.transaction_id) {
                await saveNoteOnly(newTxn.transaction_id, preservedNote);
              }
            } catch {}
          })();
        }
      } else if (offsetChanged) {
        // Categorised PENDING — user picked a different destination account.
        // Recategorize (updates the existing transactions row), then approve.
        const { data: { session } } = await supabase.auth.getSession();
        const recatRes = await fetch(
          `${API_BASE_URL}/api/transactions/${txnRow.transaction_id}/recategorize`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || ''}`
            },
            body: JSON.stringify({ offset_account_id: offsetAccountId })
          }
        );
        if (!recatRes.ok) {
          const recatJson = await recatRes.json();
          throw new Error(recatJson.error || 'Recategorize failed');
        }
        approveResult = await recatRes.json(); // recategorize returns similarTransactions
        await approveReviewTxn(txnRow.transaction_id);
      } else {
        // Categorised PENDING, no offset change — pure approval (or note-only).
        approveResult = await approveReviewTxn(txnRow.transaction_id);
      }

      // Show similar transactions popup if the server found any
      if (approveResult?.similarTransactions?.length > 0) {
        setSimilarTxns(approveResult.similarTransactions);
        setSimilarSuggestedAccount(approveResult.suggestedAccount);
        setSimilarAccountOverrides({});
      }

      // ── Step 4+5: Pre-fill next sibling (if same group) then advance queue ───
      //
      // Only look at the IMMEDIATE next card. When the user approves that one,
      // the same logic fires for the card after it — cascading naturally.
      // Skip and Save & Skip never reach this path.
      const nextCard = reviewQueue[reviewIndex + 1];
      const hasSiblingNext = !!(nextCard
        && nextCard.group_id
        && nextCard.group_id === current.group_id);

      console.log('[Review] Sibling pre-fill check:', {
        approvedUncatId: uncatId,
        approvedGroup: current.group_id,
        nextCardGroup: nextCard?.group_id,
        hasSiblingNext,
        queueLength: reviewQueue.length,
        reviewIndex
      });
      // Single queue update: remove approved card + optionally stamp sibling
      setReviewQueue(prev => {
        const filtered = prev.filter((_, i) => i !== reviewIndex);
        if (!hasSiblingNext) return filtered;
        // After removal the next card shifts to reviewIndex position
        return filtered.map((q, i) => {
          if (i !== reviewIndex) return q;
          return { ...q, _siblingPrefill: { offset_account_id: offsetAccountId, account_name: offsetAccountName } };
        });
      });

      if (reviewQueue.length - 1 === 0) {
        setReviewDone(true);
        setTimeout(() => closeReview(), 1500);
      } else {
        setReviewIndex(prev => Math.min(prev, reviewQueue.length - 2));
        setReviewEditState(prev => {
          const next = { ...prev };
          // Clear the just-approved card's edits
          delete next[uncatId];
          // Pre-fill the next sibling's editState so approval works immediately
          if (hasSiblingNext) {
            const nextUncatId = nextCard.uncategorized_transaction_id;
            const existing = next[nextUncatId];
            // Don't overwrite if user already manually picked a non-suggested account
            if (!existing?.offset_account_id || existing?._sibling_suggested) {
              next[nextUncatId] = {
                ...(existing || {}),
                offset_account_id: offsetAccountId,
                _offset_account_name: offsetAccountName,
                _sibling_suggested: true
              };
            }
          }
          return next;
        });
      }
    } catch (err) {
      showToast(err.message || 'Failed to approve', 'error');
    } finally {
      setReviewApproving(false);
    }
  };

  // ── Keyboard handler for the review popup ────────────────────────
  useEffect(() => {
    if (!isReviewOpen) return;
    const handler = (e) => {
      // Don’t intercept when user is typing in an input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { e.preventDefault(); closeReview(); }
      if (e.key === ' ')     { e.preventDefault(); handleReviewSkip(); }
      if (e.key === 'Enter') { e.preventDefault(); handleReviewApprove(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewOpen, reviewIndex, reviewQueue, reviewEditState]);


  const secondaryFiltered = transactions.filter((txn) => {
    const isCategorised = txn.transactions && txn.transactions.length > 0;
    
    // Date Range Filter
    if (dateRange.start || dateRange.end) {
      const tDate = txn.txn_date.split('T')[0];
      if (dateRange.start && tDate < dateRange.start) return false;
      if (dateRange.end && tDate > dateRange.end) return false;
    }

    // Wait for cachedAccounts to be loaded before applying account-expansion filters
    // (descendant expansion is meaningless until the account tree is available)
    const accountsReady = cachedAccounts.length > 0;
    if (accountsReady && expandedSrcIds.size > 0 && !expandedSrcIds.has(txn.account_id)) return false;
    if (selectedDocIds.size > 0 && !selectedDocIds.has(txn.document_id)) return false;
    if (txnTypeFilter === 'DEBIT' && !(txn.debit > 0)) return false;
    if (txnTypeFilter === 'CREDIT' && !(txn.credit > 0)) return false;
    // Destination (offset) account filter — includes sub-accounts
    if (accountsReady && expandedOffsetIds.size > 0) {
      const offsetId = isCategorised ? txn.transactions[0]?.offset_account_id : null;
      if (!offsetId || !expandedOffsetIds.has(offsetId)) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (txn.details && txn.details.toLowerCase().includes(q)) return true;
      if (txn.debit && txn.debit.toString().includes(q)) return true;
      if (txn.credit && txn.credit.toString().includes(q)) return true;
      if (isCategorised && txn.transactions[0].accounts?.account_name?.toLowerCase().includes(q)) return true;
      return false;
    }
    return true;
  });

  const filteredTransactions = secondaryFiltered.filter((txn) => {
    const isCategorised = txn.transactions && txn.transactions.length > 0;
    if (activeFilter === 'PENDING_CAT' && isCategorised) return false;
    if (activeFilter === 'PENDING_APP' && !(isCategorised && txn.transactions[0].review_status === 'PENDING')) return false;
    if (activeFilter === 'APPROVED' && !(isCategorised && txn.transactions[0].review_status === 'APPROVED')) return false;
    return true;
  }).sort((a, b) => {
    const tA = new Date(a.txn_date).getTime();
    const tB = new Date(b.txn_date).getTime();
    return dateSortOrder === 'asc' ? tA - tB : tB - tA;
  });

  const handleFilterChange = (newFilter) => {
    setActiveFilter(newFilter);
    if (newFilter !== 'PENDING_APP') {
      setSelectedIds(new Set());
    }
  };

  const getGroupedTransactions = () => {
    if (activeFilter !== 'PENDING_APP') return null;
    const grouped = {};
    ATTENTION_ORDER.forEach((level) => { grouped[level] = []; });
    filteredTransactions.forEach((txn) => {
      const level = txn.transactions[0].attention_level || 'LOW';
      if (grouped[level]) grouped[level].push(txn);
    });
    return ATTENTION_ORDER.map((level) => ({
      level,
      transactions: grouped[level]
    })).filter((group) => group.transactions.length > 0);
  };

  const getEligibleIdsInView = () => {
    return filteredTransactions.filter(txn => {
      const isCategorised = txn.transactions && txn.transactions.length > 0;
      const status = isCategorised ? txn.transactions[0].review_status : 'Pending Categorisation';
      return status !== 'APPROVED';
    }).map(t => t.uncategorized_transaction_id);
  };

  const handleSelectAllFiltered = (e) => {
    const eligibleIds = getEligibleIdsInView();
    if (e.target.checked) {
      const newSelected = new Set([...selectedIds, ...eligibleIds]);
      setSelectedIds(newSelected);
    } else {
      const currentViewIds = new Set(eligibleIds);
      const newSelected = new Set([...selectedIds].filter(id => !currentViewIds.has(id)));
      setSelectedIds(newSelected);
    }
  };

  const eligibleIdsInView = getEligibleIdsInView();
  const isAllSelected = eligibleIdsInView.length > 0 && eligibleIdsInView.every(id => selectedIds.has(id));

  const toggleSelectAll = (level) => {
    const txnsInLevel = filteredTransactions.filter(
      (txn) => txn.transactions[0].attention_level === level
    );
    const selectableTxns = txnsInLevel.filter((txn) => !txn.transactions[0].is_uncategorised);
    const idsInLevel = new Set(selectableTxns.map((txn) => txn.transactions[0].transaction_id));
    const allSelected = selectableTxns.every((txn) =>
      selectedIds.has(txn.transactions[0].transaction_id)
    );
    if (allSelected) {
      const newSelected = new Set(selectedIds);
      idsInLevel.forEach((id) => newSelected.delete(id));
      setSelectedIds(newSelected);
    } else {
      setSelectedIds(new Set([...selectedIds, ...idsInLevel]));
    }
  };

  const isGroupSelected = (level) => {
    const txnsInLevel = filteredTransactions.filter(
      (txn) => txn.transactions[0].attention_level === level
    );
    const selectableTxns = txnsInLevel.filter((txn) => !txn.transactions[0].is_uncategorised);
    return selectableTxns.length > 0 && selectableTxns.every((txn) =>
      selectedIds.has(txn.transactions[0].transaction_id)
    );
  };

  // Renders the amount cell. Clicking opens the inline AmountEditor.
  const renderAmountCell = (txn) => {
    // Use != null so that debit=0 is correctly treated as DEBIT (not credit)
    const isDebit = txn.debit != null;
    const amount = isDebit ? txn.debit : txn.credit;
    const formattedAmount = Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (correctingId === txn.uncategorized_transaction_id) {
      return (
        <AmountEditor
          txn={txn}
          onSave={handleCorrect}
          onCancel={() => setCorrectingId(null)}
        />
      );
    }

    return (
      <div
        className={`amount-cell-clickable ${isDebit ? 'debit-cell' : 'credit-cell'}`}
        title="Tap to edit amount or change transaction type"
        onClick={() => setCorrectingId(txn.uncategorized_transaction_id)}
      >
        {isDebit ? `- ₹${formattedAmount}` : `+ ₹${formattedAmount}`}
        <span className="amount-edit-hint">✎</span>
      </div>
    );
  };

  const allCount = secondaryFiltered.length;
  const pendingCatCount = secondaryFiltered.filter(t =>
    !(t.transactions && t.transactions.length > 0)
  ).length;
  const pendingAppCount = secondaryFiltered.filter(t =>
    t.transactions?.[0]?.review_status === 'PENDING'
  ).length;
  const approvedCount = secondaryFiltered.filter(t =>
    t.transactions?.[0]?.review_status === 'APPROVED'
  ).length;

  return (
    <div className="transactions-container">
      <div className="page-header">
        <div id="transactions-header-title" className="header-title">
          <h1 id="transactions-title">Transactions</h1>
          <p>Manage and categorize your bank statements and ledger entries.</p>
        </div>
        <div className="header-actions">
          {/* Manual Add button — always visible */}
          <button
            id="transactions-manual-add-btn"
            className="action-btn"
            onClick={() => { setManualAddForm(EMPTY_MANUAL_FORM); setManualAddError(''); setIsManualAddOpen(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Manually add a transaction that isn't in any uploaded statement"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add Transaction
          </button>
          {/* Review button — only visible when there are non-approved transactions */}
          {transactions.some(t => {
            const row = t.transactions?.[0];
            return !row || row.review_status !== 'APPROVED';
          }) && (
            <button
              id="transactions-review-btn"
              className="action-btn review-btn"
              onClick={openReview}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Step through each uncategorised transaction one at a time to review and approve"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Review {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </button>
          )}

          {selectedIds.size > 0 && (
            <button
              className="action-btn primary-btn"
              onClick={() => setIsBulkAssignOpen(true)}
              disabled={isBulkAssigning}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title={`Assign the same category to all ${selectedIds.size} selected transactions at once`}
            >
              {isBulkAssigning ? <span className="spinner-small" style={{ borderColor: 'white', borderTopColor: 'transparent' }} /> : <ICONS.Plus />}
              Assign Account ({selectedIds.size})
            </button>
          )}
          {activeFilter === 'PENDING_APP' ? (
            <button
              className={`action-btn approve-selected ${selectedIds.size > 0 ? 'has-selection' : ''}`}
              onClick={handleBulkApprove}
              disabled={selectedIds.size === 0 || isApprovingBulk}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title={selectedIds.size === 0 ? 'Select transactions above to approve them in bulk' : `Mark all ${selectedIds.size} selected transactions as approved`}
            >
              {isApprovingBulk ? <span className="spinner-small"></span> : <ICONS.Check />}
              {isApprovingBulk ? `Approving ${selectedIds.size}...` : `Approve Selected (${selectedIds.size})`}
            </button>
          ) : (
            <button
              id="transactions-categorize-btn"
              className={`action-btn ${isCategorizing ? 'categorising' : ''}`}
              onClick={handleCategorize}
              disabled={isCategorizing || processingDocIds.size > 0}
              title={processingDocIds.size > 0
                ? 'Please wait — your uploaded statements are still being processed'
                : 'Automatically categorise all uncategorised transactions using AI'}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isCategorizing
                ? <><span className="spinner-small"></span> {categoriseStatus || 'Categorising…'}</>
                : <><ICONS.Robot /> AI Categorise</>
              }
            </button>
          )}
        </div>
      </div>

      {/* ── Pipeline processing banner — sits above the tab bar ——————————— */}
      {/* Phase 1: processingDocIds detected but pipeline hasn't reported started_at yet
              → show shimmer immediately so the screen never looks frozen.
          Phase 2: pipelineStartedAt known → switch to deterministic fill bar.
          Phase 3: pipelineProgress === 100 → completion flash, then reset. */}
      {(processingDocIds.size > 0 || pipelineProgress > 0) && (() => {
        const isIndeterminate = processingDocIds.size > 0 && !pipelineStartedAt; // Phase 1
        const isDone = pipelineProgress >= 100;
        const docCount = processingDocIds.size;
        
        const processingNames = Array.from(processingDocIds)
          .map(id => docNames[id])
          .filter(Boolean)
          .join(', ');

        return (
          <div className="pipeline-processing-banner">
            <div className="pipeline-banner-text">
              {!isDone && <span className="pipeline-spinner" />}
              <span>
                {isDone
                  ? 'Processing complete — transactions updated.'
                  : `Processing ${processingNames || `${docCount} document${docCount > 1 ? 's' : ''}`}… transactions will update automatically.`}
              </span>
              {/* Only show % once we have real progress (Phase 2+) */}
              {!isIndeterminate && pipelineProgress > 0 && (
                <span className="pipeline-pct">{Math.round(pipelineProgress)}%</span>
              )}
            </div>
            <div className="pipeline-progress-track">
              <div
                className={`pipeline-progress-fill${isIndeterminate ? ' indeterminate' : ''}`}
                style={isIndeterminate ? undefined : { width: `${pipelineProgress}%` }}
              />
            </div>
          </div>
        );
      })()}


      {/* ── Pipeline error banner ————————————————————————————————— */}
      {failedDocIds.size > 0 && (() => {
        const isNeverStarted = pipelineErrorMsg === 'never_started';
        const isStale       = pipelineErrorMsg === 'stale';
        
        const failedNames = Array.from(failedDocIds)
          .map(id => docNames[id])
          .filter(Boolean)
          .join(', ');

        return (
          <div className="pipeline-error-banner">
            <div className="pipeline-error-content">
              <span className="pipeline-error-icon">⚠</span>
              <div className="pipeline-error-text">
                <span className="pipeline-error-title">
                  {failedNames ? `${failedNames} failed to process.` : `${failedDocIds.size} document${failedDocIds.size > 1 ? 's' : ''} failed to process.`}
                </span>
                <span className="pipeline-error-subtitle">
                  {isNeverStarted
                    ? 'The background processor was asleep and missed the upload. Retry to wake it up.'
                    : isStale
                    ? 'The pipeline timed out — the server may have gone to sleep mid-run.'
                    : 'An unexpected pipeline error occurred.'}
                </span>
              </div>
            </div>
            <button
              className="pipeline-retry-btn"
              onClick={handleRetryPipeline}
              disabled={retrying}
            >
              {retrying
                ? <><span className="spinner-small" /> Waking up…</>
                : '↺ Retry'}
            </button>
          </div>
        );
      })()}

      <div id="transactions-tabs" className="filter-tabs">
        <button
          id="transactions-tab-all"
          className={`filter-tab ${activeFilter === 'ALL' ? 'active' : ''}`}
          onClick={() => handleFilterChange('ALL')}
        >All ({allCount})</button>
        <button
          id="transactions-tab-pending-cat"
          className={`filter-tab ${activeFilter === 'PENDING_CAT' ? 'active' : ''}`}
          onClick={() => handleFilterChange('PENDING_CAT')}
        >Pending Categorisation ({pendingCatCount})</button>
        <button
          id="transactions-tab-pending-app"
          className={`filter-tab ${activeFilter === 'PENDING_APP' ? 'active' : ''}`}
          onClick={() => handleFilterChange('PENDING_APP')}
        >Pending Approval ({pendingAppCount})</button>
        <button
          id="transactions-tab-approved"
          className={`filter-tab ${activeFilter === 'APPROVED' ? 'active' : ''}`}
          onClick={() => handleFilterChange('APPROVED')}
        >Approved ({approvedCount})</button>

        {/* ── Search Input ── fills remaining space */}
        <div className="search-input-wrapper" style={{ flex: 1, marginLeft: 'auto', display: 'flex', alignItems: 'stretch' }}>
          <input
            type="text"
            placeholder="Search details, amounts, categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0 12px',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* ── Date Range Popup ── */}
        <div className="filter-popup-wrapper" ref={datePopupRef} style={{ marginLeft: '4px' }}>
          <button
            className={`filter-tab ${(dateRange.start || dateRange.end) ? 'filter-tab-active' : ''}`}
            onClick={() => setIsDatePopupOpen(v => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Date
            {(dateRange.start || dateRange.end) && (
              <span className="filter-count-badge">1</span>
            )}
          </button>

          {isDatePopupOpen && (
            <div className="filter-popup" style={{ width: '280px' }}>
              <div className="filter-popup-header">
                <span>Date Range</span>
                {(dateRange.start || dateRange.end) && (
                  <button className="filter-clear-btn" onClick={() => { setDateRange({start: '', end: ''}); setIsDatePopupOpen(false); }}>Clear</button>
                )}
              </div>
              
              <div className="filter-group">
                <div className="filter-group-label" style={{ marginBottom: '8px' }}>Quick Select</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', padding: '0 12px 8px' }}>
                  <button className="filter-tab" style={{ justifyContent: 'center' }} onClick={() => setQuickDate('7D')}>Last 7 Days</button>
                  <button className="filter-tab" style={{ justifyContent: 'center' }} onClick={() => setQuickDate('30D')}>Last 30 Days</button>
                  <button className="filter-tab" style={{ justifyContent: 'center' }} onClick={() => setQuickDate('THIS_MONTH')}>This Month</button>
                  <button className="filter-tab" style={{ justifyContent: 'center' }} onClick={() => setQuickDate('LAST_MONTH')}>Last Month</button>
                  <button className="filter-tab" style={{ justifyContent: 'center' }} onClick={() => setQuickDate('THIS_YEAR')}>This Year</button>
                  <button className="filter-tab" style={{ justifyContent: 'center' }} onClick={() => setQuickDate('LAST_FY')}>Last FY</button>
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-group-label" style={{ marginBottom: '8px' }}>Custom Range</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 12px 6px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 'bold' }}>Start Date</label>
                    <input 
                      type="date" 
                      className="amount-editor-input" 
                      style={{ height: '36px' }}
                      value={dateRange.start}
                      onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 'bold' }}>End Date</label>
                    <input 
                      type="date" 
                      className="amount-editor-input" 
                      style={{ height: '36px' }}
                      value={dateRange.end}
                      onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Filter popup ── */}
        <div className="filter-popup-wrapper" ref={filterRef} style={{ marginLeft: '4px' }}>
          <button
            className={`filter-tab ${activeFilterCount > 0 ? 'filter-tab-active' : ''}`}
            onClick={() => setIsFilterOpen(v => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
            Filter
            {activeFilterCount > 0 && (
              <span className="filter-count-badge">{activeFilterCount}</span>
            )}
          </button>

          {isFilterOpen && (
            <div className="filter-popup">
              <div className="filter-popup-header">
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <button className="filter-clear-btn" onClick={clearAllFilters}>Clear all</button>
                )}
              </div>

              <div className="filter-popup-scrollable-body">
                {/* ── Debit / Credit ── */}
                <div className="filter-group">
                  <div className="filter-group-label">Transaction Type</div>
                  {['ALL', 'DEBIT', 'CREDIT'].map(type => (
                    <label key={type} className="filter-option">
                      <input
                        type="radio"
                        name="txn-type-filter"
                        value={type}
                        checked={txnTypeFilter === type}
                        onChange={() => setTxnTypeFilter(type)}
                      />
                      <span>
                        {type === 'ALL' ? 'All' : type === 'DEBIT' ? '− Debit' : '+ Credit'}
                      </span>
                    </label>
                  ))}
                </div>

                {filterAccounts.length > 0 && (
                  <div className="filter-group">
                    <div className="filter-group-label">Bank Account / Credit Card</div>
                    {filterAccounts.map(acc => (
                      <label key={acc.account_id} className="filter-option">
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.has(acc.account_id)}
                          onChange={() => toggleAccountFilter(acc.account_id)}
                        />
                        <span>{acc.account_name}</span>
                      </label>
                    ))}
                  </div>
                )}

                {filterDocuments.length > 0 && (
                  <div className="filter-group">
                    <div className="filter-group-label">Uploaded Document</div>
                    {filterDocuments.map(doc => (
                      <label key={doc.document_id} className="filter-option">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(doc.document_id)}
                          onChange={() => toggleDocFilter(doc.document_id)}
                        />
                        <span title={doc.file_name}>
                          {doc.file_name.length > 30 ? doc.file_name.slice(0, 28) + '…' : doc.file_name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {/* ── Destination (Offset) Account ── */}
                {cachedAccounts.length > 0 && (
                  <div className="filter-group">
                    <div className="filter-group-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Destination Account</span>
                      {selectedOffsetAccountIds.size > 0 && (
                        <button
                          className="filter-clear-btn"
                          style={{ fontSize: '10px', padding: '1px 6px' }}
                          onClick={() => setSelectedOffsetAccountIds(new Set())}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {/* Inline search for the account tree */}
                    <div style={{ padding: '0 12px 6px' }}>
                      <input
                        type="text"
                        placeholder="Search accounts…"
                        value={offsetAccountSearch}
                        onChange={e => setOffsetAccountSearch(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: '100%',
                          padding: '5px 9px',
                          fontSize: '12px',
                          borderRadius: '6px',
                          border: '1px solid var(--glass-border)',
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <OffsetAccountTree
                      accounts={cachedAccounts}
                      selectedIds={selectedOffsetAccountIds}
                      onToggle={toggleOffsetAccountFilter}
                      searchQuery={offsetAccountSearch}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="transactions-content">
        <div className="placeholder-table">
          {activeFilter === 'PENDING_APP' ? (
            <>
              {loading ? (
                <div className="empty-state" style={{ padding: '40px' }}>
                  <span className="spinner"></span>
                  <p>Loading transactions...</p>
                </div>
              ) : getGroupedTransactions() && getGroupedTransactions().length > 0 ? (
                <>
                  <div className="table-header uniform-layout">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <input
                        type="checkbox"
                        className="row-checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAllFiltered}
                      />
                    </div>
                    <div
                      style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                      onClick={() => setDateSortOrder(p => p === 'desc' ? 'asc' : 'desc')}
                    >
                      Date {dateSortOrder === 'desc' ? '↓' : '↑'}
                    </div>
                    <div>Details</div>
                    <div style={{ textAlign: 'right', display: 'block', width: '100%' }}>Amount</div>
                    <div>Account (Src → Dest)</div>
                    <div>Categorised By</div>
                    <div>Status</div>
                  </div>
                  <div className="placeholder-rows">
                    {getGroupedTransactions().map((group) => (
                      <div key={group.level}>
                        <div className="attention-group-header">
                          <button
                            className={`select-all-btn ${isGroupSelected(group.level) ? 'active' : ''}`}
                            onClick={() => toggleSelectAll(group.level)}
                          >
                            {isGroupSelected(group.level) ? '✓ Deselect' : '☐ Select'}
                          </button>
                          <span className={`attention-label ${group.level.toLowerCase()}`}>
                            {group.level} ATTENTION
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            ({group.transactions.length})
                          </span>
                        </div>
                        {group.transactions.map((txn) => {
                          const isChecked = selectedIds.has(txn.uncategorized_transaction_id);
                          const accountName = txn.transactions[0].accounts
                            ? txn.transactions[0].accounts.account_name
                            : '-';
                          const isUncategorised = txn.transactions[0].is_uncategorised;
                          const categorisedBy = txn.transactions[0].categorised_by || '-';

                          return (
                            <div
                              key={txn.uncategorized_transaction_id}
                              className={`table-row uniform-layout ${txn.debit != null ? 'row-debit' : 'row-credit'} ${isApprovingBulk && selectedIds.has(txn.uncategorized_transaction_id) ? 'row-approving' : ''}`}
                            >
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                                <input
                                  type="checkbox"
                                  className="row-checkbox"
                                  checked={isChecked}
                                  disabled={txn.transactions?.[0]?.review_status === 'APPROVED'}
                                  onChange={() => {
                                    const newSelected = new Set(selectedIds);
                                    if (isChecked) {
                                      newSelected.delete(txn.uncategorized_transaction_id);
                                    } else {
                                      newSelected.add(txn.uncategorized_transaction_id);
                                    }
                                    setSelectedIds(newSelected);
                                  }}
                                />
                              </div>
                              <div>{formatDate(txn.txn_date)}</div>
                              <div className="details-cell raw-details" title={txn.details}>{txn.details}</div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                                {renderAmountCell(txn)}
                              </div>
                              <div className="account-directional-cell">
                                <span className="account-src" onClick={() => setSrcAccTarget(txn)} title="Click to change the source bank or card account for this transaction">
                                  {txn.source_account?.account_name || '-'}
                                </span>
                                <span className="account-arrow">→</span>
                                <span 
                                  className={`account-dest ${txn.transactions[0].accounts ? 'account-cell-clickable' : ''}`}
                                  onClick={() => { if (txn.transactions[0].accounts) setRecatTarget(txn); }}
                                  title="Click to assign a category to this transaction"
                                >
                                  {accountName}
                                </span>
                              </div>
                              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                {categorisedBy}
                              </div>
                              <div>
                                <span className="status-badge warning" style={{ display: 'inline-flex' }}>Pending Approval</span>
                              </div>
                              
                              <div className="slide-approve-wrapper">
                                <button className="slide-approve-btn" onClick={() => handleApprove(txn.transactions[0].transaction_id, isUncategorised, txn.uncategorized_transaction_id)} title="Mark as approved and move to your ledger">
                                  <ICONS.Check />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state" style={{ padding: '40px' }}>
                  <span className="empty-icon" style={{ opacity: 0.15 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  </span>
                  <p>No pending approvals</p>
                </div>
              )}
            </>
          ) : (
            <>
              <div 
                className="table-header uniform-layout"
                style={{
                  gridTemplateColumns: activeFilter === 'PENDING_CAT' || activeFilter === 'APPROVED' 
                    ? '30px 90px 1fr 110px 220px 130px'
                    : undefined
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input
                    type="checkbox"
                    className="row-checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAllFiltered}
                  />
                </div>
                <div
                  style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => setDateSortOrder(p => p === 'desc' ? 'asc' : 'desc')}
                >
                  Date {dateSortOrder === 'desc' ? '↓' : '↑'}
                </div>
                <div>Details</div>
                <div style={{ textAlign: 'right', display: 'block', width: '100%' }}>Amount</div>
                <div>Account (Src → Dest)</div>
                <div>Categorised By</div>
                {activeFilter !== 'PENDING_CAT' && activeFilter !== 'APPROVED' && <div>Status</div>}
              </div>
              <div id="transactions-table" className="placeholder-rows">
                {loading ? (
                  <div className="empty-state">
                    <span className="spinner"></span>
                    <p>Loading transactions...</p>
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon" style={{ opacity: 0.15 }}>
                      {activeFilter === 'ALL' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                      )}
                    </span>
                    <p>
                      {activeFilter === 'ALL' && 'No transactions'}
                      {activeFilter === 'PENDING_CAT' && 'All transactions categorised'}
                    </p>
                  </div>
                ) : (
                  filteredTransactions.map((txn) => {
                    const isCategorised = txn.transactions && txn.transactions.length > 0;
                    const transactionId = isCategorised ? txn.transactions[0].transaction_id : null;
                    const status = isCategorised
                      ? txn.transactions[0].review_status
                      : 'Pending Categorisation';
                    const isApproving = approvingIds.has(transactionId);
                    const accountName = isCategorised && txn.transactions[0].accounts
                      ? txn.transactions[0].accounts.account_name
                      : '-';
                    const categorisedBy = isCategorised ? txn.transactions[0].categorised_by : '-';
                    const isUncategorised = isCategorised ? txn.transactions[0].is_uncategorised : false;

                    return (
                      <div
                        key={txn.uncategorized_transaction_id}
                        className={`table-row uniform-layout ${txn.debit != null ? 'row-debit' : 'row-credit'} ${isApprovingBulk && selectedIds.has(transactionId) ? 'row-approving' : ''}`}
                        onClick={(e) => {
                          if (e.target.closest('button') || e.target.closest('.account-cell-clickable') || e.target.closest('.account-src') || e.target.closest('.account-dest') || e.target.closest('.amount-editor') || e.target.closest('input[type="checkbox"]')) {
                            return;
                          }
                          openReview(txn.uncategorized_transaction_id);
                        }}
                        style={{ 
                          cursor: 'pointer',
                          gridTemplateColumns: activeFilter === 'PENDING_CAT' || activeFilter === 'APPROVED' 
                            ? '30px 90px 1fr 110px 220px 130px'
                            : undefined
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                          <input
                            type="checkbox"
                            className="row-checkbox"
                            checked={selectedIds.has(txn.uncategorized_transaction_id)}
                            disabled={status === 'APPROVED'}
                            onChange={() => {
                              const newSelected = new Set(selectedIds);
                              if (selectedIds.has(txn.uncategorized_transaction_id)) {
                                newSelected.delete(txn.uncategorized_transaction_id);
                              } else {
                                newSelected.add(txn.uncategorized_transaction_id);
                              }
                              setSelectedIds(newSelected);
                            }}
                          />
                        </div>
                        <div>{formatDate(txn.txn_date)}</div>
                        <div className="details-cell raw-details" title={txn.details ? `Full description: ${txn.details}` : ''}>{txn.details}</div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                          {renderAmountCell(txn)}
                        </div>
                        <div className="account-directional-cell">
                          <span className="account-src" onClick={() => setSrcAccTarget(txn)} title="Click to change the source bank or card account for this transaction">
                            {txn.source_account?.account_name || '-'}
                          </span>
                          <span className="account-arrow">→</span>
                          <span
                            className={
                              `account-dest ${
                                isCategorised && txn.transactions[0].accounts
                                  ? 'account-cell-clickable'
                                  : isCategorised === false
                                  ? 'account-cell-clickable uncategorised'
                                  : ''
                              }${isRowProcessing(txn) ? ' is-processing' : ''}${isRowFailed(txn) ? ' is-pipeline-failed' : ''}`
                            }
                            onClick={() => {
                              if (isRowProcessing(txn) || isRowFailed(txn)) return;
                              if (isCategorised && txn.transactions[0].accounts) {
                                setRecatTarget(txn);
                              } else if (!isCategorised) {
                                setManualTarget(txn);
                              }
                            }}
                            style={{
                              cursor:
                                isRowProcessing(txn) || isRowFailed(txn)
                                  ? 'default'
                                  : (isCategorised && txn.transactions[0].accounts) || !isCategorised
                                  ? 'pointer'
                                  : 'default'
                            }}
                            title={isRowProcessing(txn) ? 'AI is categorising this transaction — it will update shortly' : isRowFailed(txn) ? 'Categorisation failed — use the Retry button above to try again' : 'Click to assign or change the category for this transaction'}
                          >
                            {isRowProcessing(txn)
                              ? '🔒 Processing…'
                              : isRowFailed(txn)
                              ? '⚠ Failed'
                              : isCategorised ? accountName : '+ Assign'
                            }
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {categorisedBy}
                        </div>
                        {activeFilter !== 'PENDING_CAT' && activeFilter !== 'APPROVED' && (
                          <div>
                            <span className={`status-badge ${status.toLowerCase().replace(' ', '-')}`}>
                              {status === 'PENDING' ? 'Pending Approval' : status}
                            </span>
                          </div>
                        )}
                        
                        {status === 'PENDING' && isCategorised && !isRowProcessing(txn) && !isRowFailed(txn) && (
                          <div className="slide-approve-wrapper">
                            <button
                              className="slide-approve-btn"
                              onClick={() => handleApprove(transactionId, isUncategorised, txn.uncategorized_transaction_id)}
                              disabled={isApproving}
                              title="Mark as approved and move to your ledger"
                            >
                              {isApproving ? <span className="spinner-small" style={{ borderColor: 'white', borderTopColor: 'transparent' }}></span> : <ICONS.Check />} 
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {similarTxns.length > 0 && (
        <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={() => setSimilarTxns([])}>
          <div className="similar-txns-modal" onClick={e => e.stopPropagation()}>

            <div className="modal-header">
              <div>
                <h2>Similar Transactions Found</h2>
                <p className="similar-subtitle">
                  {similarTxns.length} similar pending transaction{similarTxns.length > 1 ? 's' : ''} —
                  suggested account: <strong>{similarSuggestedAccount?.account_name}</strong>
                </p>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setSimilarTxns([])}
                style={{ background: 'none', border: 'none', fontSize: '20px',
                         cursor: 'pointer', color: 'var(--text-secondary)' }}
              >✕</button>
            </div>

            <div className="similar-txns-list">
              {similarTxns.map(txn => {
                // Use uncategorized_transaction_id as fallback for pre-pipeline txns
                // where transaction_id is null (avoids duplicate-key React warning)
                const rowKey = txn.transaction_id ?? txn.uncategorized_transaction_id;
                const assignedAccount = similarAccountOverrides[rowKey] || similarSuggestedAccount;
                return (
                  <div key={rowKey} className="similar-txn-row">
                    <div className="similar-txn-date">
                      {formatDate(txn.transaction_date)}
                    </div>
                    <div className="similar-txn-details" title={txn.details}>
                      {txn.details}
                    </div>
                    <div className="similar-txn-amount">
                      {txn.transaction_type === 'DEBIT' ? '−' : '+'}
                      ₹{Number(txn.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="similar-txn-from">
                      <span className="similar-from-label" title={txn.current_account?.account_name}>
                        {txn.current_account?.account_name || '—'}
                      </span>
                      <span className="similar-arrow">→</span>
                      <button
                        className="similar-account-btn"
                        onClick={() => setSimilarPickerTarget(rowKey)}
                      >
                        {assignedAccount?.account_name}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2.5">
                          <path d="M6 9l6 6 6-6"/>
                        </svg>
                      </button>
                    </div>
                    <button
                      className="action-icon-btn approve"
                      title="Approve this transaction individually"
                      onClick={() => handleSimilarIndividualApprove(txn)}
                    >
                      <ICONS.Check />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="similar-txns-footer">
              <button className="action-btn" onClick={() => setSimilarTxns([])}>
                Dismiss
              </button>
              <button
                className="action-btn approve-selected has-selection"
                onClick={handleSimilarBulkConfirm}
                disabled={isApprovingSimilar}
              >
                {isApprovingSimilar
                  ? <><span className="spinner-small"></span> Confirming...</>
                  : <><ICONS.Check /> Confirm All ({similarTxns.length})</>
                }
              </button>
            </div>

          </div>

          {similarPickerTarget && (
            <AccountPickerModal
              onClose={() => setSimilarPickerTarget(null)}
              currentAccountId={
                (similarAccountOverrides[similarPickerTarget] || similarSuggestedAccount)?.account_id
              }
              preloadedAccounts={cachedAccounts}
              onAccountCreated={handleAccountCreated}
              onSelect={(account) => {
                setSimilarAccountOverrides(prev => ({
                  ...prev,
                  [similarPickerTarget]: account
                }));
                setSimilarPickerTarget(null);
              }}
            />
          )}
        </div>
      )}


      {recatTarget && (
        <AccountPickerModal
          onClose={() => setRecatTarget(null)}
          onSelect={handleRecategorize}
          currentAccountId={recatTarget.transactions[0].offset_account_id}
          transactionDirection={recatTarget.debit > 0 ? 'DEBIT' : 'CREDIT'}
          preloadedAccounts={cachedAccounts}
          onAccountCreated={handleAccountCreated}
        />
      )}
      {manualTarget && (
        <AccountPickerModal
          onClose={() => setManualTarget(null)}
          onSelect={handleManualCategorize}
          transactionDirection={manualTarget.debit > 0 ? 'DEBIT' : 'CREDIT'}
          preloadedAccounts={cachedAccounts}
          onAccountCreated={handleAccountCreated}
        />
      )}
      {srcAccTarget && (
        <AccountPickerModal
          onClose={() => setSrcAccTarget(null)}
          onSelect={handleChangeSourceAccount}
          currentAccountId={srcAccTarget.account_id}
          preloadedAccounts={cachedAccounts}
          allowedParentAccountNames={['Bank Accounts', 'Credit Cards']}
          onAccountCreated={handleAccountCreated}
        />
      )}
      <Toast toasts={toasts} />

      {/* ── Manual Review Popup ── */}
      {isReviewOpen && (
        <div className="review-overlay" onClick={closeReview}>
          <div className="review-card" onClick={e => e.stopPropagation()}>

            {reviewDone ? (
              <div className="review-done-screen">
                <div className="review-done-icon">✓</div>
                <h2>All done</h2>
                <p>All transactions reviewed</p>
              </div>
            ) : (() => {
              const current = reviewQueue[reviewIndex];
              if (!current) return null;
              const uncatId = current.uncategorized_transaction_id;
              const edits = reviewEditState[uncatId] || {};
              const txnRow = current.transactions?.[0];
              const isCategorised = !!txnRow;
              const isUncategorisedAccount = txnRow?.is_uncategorised !== false;

              // Resolved display values
              const displayDate  = edits.txn_date    ?? current.txn_date?.split('T')[0] ?? '';
              const displayDetails = edits.details   ?? current.details ?? '';
              // Use != null so debit=0 is treated as DEBIT, not credit
              const isDebit = edits.transaction_type
                ? edits.transaction_type === 'DEBIT'
                : current.debit != null;
              let displayAmount = edits.amount ?? (current.debit != null ? current.debit : (current.credit ?? 0));
              if (typeof displayAmount === 'number') {
                displayAmount = displayAmount.toFixed(2);
              }
              const displaySrcAcc = edits._src_account_name ?? current.source_account?.account_name ?? '-';
              const displayDestAcc = edits._offset_account_name ?? (isCategorised ? txnRow?.accounts?.account_name : null);
              const displayNote = edits.user_note    ?? txnRow?.user_note ?? '';
              const siblingPrefill = current._siblingPrefill;
              const isSuggested = edits._sibling_suggested;

              // Status badge
              const statusLabel = isCategorised
                ? (txnRow.review_status === 'PENDING' ? 'Pending Approval' : txnRow.review_status)
                : 'Pending Categorisation';
              const statusClass = isCategorised
                ? txnRow.review_status.toLowerCase()
                : 'pending-categorisation';

              return (
                <>
                  {/* Header */}
                  <div className="review-header" style={{ alignItems: 'center' }}>
                    <div>
                      <h2 className="review-title">Manual Review</h2>
                      <span className="review-progress">{reviewIndex + 1} of {reviewQueue.length}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        <input
                          type="date"
                          className="review-input"
                          value={displayDate}
                          onChange={e => patchReviewEdit(uncatId, { txn_date: e.target.value })}
                          style={{ padding: '6px 10px', fontSize: '13px', width: 'auto', margin: 0 }}
                        />
                        <span className={`status-badge ${statusClass}`} style={{ margin: 0 }}>{statusLabel}</span>
                      </div>
                      <button className="review-close-btn" onClick={closeReview} title="Close review panel (Esc)">✕</button>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="review-body">

                    {/* Details */}
                    <div className="review-field">
                      <label className="review-field-label">Details</label>
                      <textarea
                        className="review-input"
                        value={displayDetails}
                        onChange={e => patchReviewEdit(uncatId, { details: e.target.value })}
                        placeholder="Transaction description"
                        rows={3}
                        style={{ resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
                      />
                    </div>

                    {/* Amount & Accounts Row */}
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch' }}>
                      {/* Left Side: Amount */}
                      <div style={{ flex: '0 0 140px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div className="review-field" style={{ flex: 1 }}>
                          <label className="review-field-label">Amount</label>
                          <input
                            type="number"
                            className="review-input review-amount-input"
                            step="0.01"
                            min="0.01"
                            value={displayAmount}
                            onChange={e => patchReviewEdit(uncatId, { amount: e.target.value })}
                            onBlur={(e) => {
                              if (e.target.value) {
                                patchReviewEdit(uncatId, { amount: Number(e.target.value).toFixed(2) });
                              }
                            }}
                            style={{ flex: 1, fontSize: '18px', fontWeight: 'bold' }}
                          />
                        </div>
                        <div className="review-field" style={{ flex: 1, justifyContent: 'flex-end' }}>
                          <label className="review-field-label" style={{ visibility: 'hidden' }}>Type</label>
                          <div className="review-type-toggle" style={{ flex: 1 }}>
                            <button
                              className={`type-btn ${isDebit ? 'active debit' : ''}`}
                              onClick={() => patchReviewEdit(uncatId, { transaction_type: 'DEBIT' })}
                            >− Dr</button>
                            <button
                              className={`type-btn ${!isDebit ? 'active credit' : ''}`}
                              onClick={() => patchReviewEdit(uncatId, { transaction_type: 'CREDIT' })}
                            >+ Cr</button>
                          </div>
                        </div>
                      </div>

                      {/* Right Side: Accounts */}
                      <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {/* Source Account */}
                        <div className="review-field" style={{ flex: 1 }}>
                          <label className="review-field-label">Source Account</label>
                          <button
                            className="review-account-btn"
                            onClick={() => setReviewPickerField('src')}
                            style={{ flex: 1 }}
                          >
                            {displaySrcAcc}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                          </button>
                        </div>

                        {/* Dest Account */}
                        <div className="review-field" style={{ flex: 1 }}>
                          <label className="review-field-label">Category / Dest Account</label>
                          <button
                            className={`review-account-btn ${!displayDestAcc ? 'review-assign' : ''}`}
                            onClick={() => setReviewPickerField('dest')}
                            style={{ flex: 1 }}
                          >
                            {displayDestAcc
                              ? (<span>{displayDestAcc} {isSuggested && <span className="review-suggested-badge">suggested</span>}</span>)
                              : (siblingPrefill ? (<span>{siblingPrefill.account_name} <span className="review-suggested-badge">suggested</span></span>) : '+ Assign')
                            }
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Note */}
                    <div className="review-field">
                      <label className="review-field-label">Note</label>
                      <textarea
                        className="review-textarea"
                        maxLength={500}
                        rows={3}
                        value={displayNote}
                        onChange={e => patchReviewEdit(uncatId, { user_note: e.target.value })}
                        placeholder="Optional note…"
                      />
                      <span className="review-char-count">{displayNote.length}/500</span>
                    </div>

                  </div>

                  {/* Validation message */}
                  {reviewValidationMsg && (
                    <div className="review-validation-msg">{reviewValidationMsg}</div>
                  )}

                  {/* Footer */}
                  <div className="review-footer">
                    <button
                      className="action-btn review-skip-btn"
                      onClick={handleReviewSkip}
                      disabled={reviewApproving}
                      title="Skip this transaction and move to the next one (Space)"
                    >
                      Skip
                    </button>
                    <button
                      className="action-btn review-save-skip-btn"
                      onClick={handleReviewSaveAndSkip}
                      disabled={reviewApproving}
                      title="Save your changes to this transaction and come back to it later"
                    >
                      {reviewApproving
                        ? <><span className="spinner-small"></span> Saving…</>
                        : 'Save & Skip'
                      }
                    </button>
                    <button
                      className="action-btn approve-selected has-selection review-approve-btn"
                      onClick={handleReviewApprove}
                      disabled={reviewApproving}
                      title="Approve this transaction and move to the next one (Enter)"
                    >
                      {reviewApproving
                        ? <><span className="spinner-small"></span> Approving…</>
                        : <><ICONS.Check /> Approve &amp; Next</>
                      }
                    </button>
                  </div>
                </>
              );
            })()}

          </div>

          {/* Account pickers — rendered inside the overlay so they stack above the card */}
          {reviewPickerField === 'src' && reviewQueue[reviewIndex] && (
            <AccountPickerModal
              onClose={() => setReviewPickerField(null)}
              currentAccountId={
                reviewEditState[reviewQueue[reviewIndex].uncategorized_transaction_id]?.base_account_id
                ?? reviewQueue[reviewIndex].account_id
              }
              preloadedAccounts={cachedAccounts}
              allowedParentAccountNames={['Bank Accounts', 'Credit Cards']}
              onAccountCreated={handleAccountCreated}
              onSelect={(account) => {
                const uncatId = reviewQueue[reviewIndex].uncategorized_transaction_id;
                patchReviewEdit(uncatId, {
                  base_account_id: account.account_id,
                  _src_account_name: account.account_name
                });
                setReviewPickerField(null);
              }}
            />
          )}
          {reviewPickerField === 'dest' && reviewQueue[reviewIndex] && (() => {
            const cur = reviewQueue[reviewIndex];
            const uncatId = cur.uncategorized_transaction_id;
            const edits = reviewEditState[uncatId] || {};
            const txnRow = cur.transactions?.[0];
            return (
              <AccountPickerModal
                onClose={() => setReviewPickerField(null)}
                currentAccountId={edits.offset_account_id ?? txnRow?.offset_account_id}
                transactionDirection={
                  (edits.transaction_type ?? (cur.debit > 0 ? 'DEBIT' : 'CREDIT'))
                }
                preloadedAccounts={cachedAccounts}
                onAccountCreated={handleAccountCreated}
                onSelect={(account) => {
                  patchReviewEdit(uncatId, {
                    offset_account_id: account.account_id,
                    _offset_account_name: account.account_name,
                    _sibling_suggested: false
                  });
                  setReviewPickerField(null);
                }}
              />
            );
          })()}
        </div>
      )}
      {/* ── Manual Add Transaction Popup ── */}
      {isManualAddOpen && (
        <div className="review-overlay" style={{ zIndex: 1100 }} onClick={() => setIsManualAddOpen(false)}>
          <div className="review-card" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="review-header" style={{ alignItems: 'center' }}>
              <div>
                <h2 className="review-title">Add Transaction</h2>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Saved directly as approved</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="date"
                  className="review-input"
                  value={manualAddForm.txn_date}
                  onChange={e => setManualAddForm(f => ({ ...f, txn_date: e.target.value }))}
                  style={{ padding: '6px 10px', fontSize: '13px', width: 'auto', margin: 0 }}
                />
                <button className="review-close-btn" onClick={() => setIsManualAddOpen(false)} title="Cancel and close">✕</button>
              </div>
            </div>

            {/* Body */}
            <div className="review-body">

              {/* Details */}
              <div className="review-field">
                <label className="review-field-label">Details</label>
                <textarea
                  className="review-input"
                  value={manualAddForm.details}
                  onChange={e => setManualAddForm(f => ({ ...f, details: e.target.value }))}
                  placeholder="Transaction description"
                  rows={3}
                  style={{ resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
                />
              </div>

              {/* Amount & Accounts Row */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch' }}>
                {/* Left Side: Amount */}
                <div style={{ flex: '0 0 140px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="review-field" style={{ flex: 1 }}>
                    <label className="review-field-label">Amount</label>
                    <input
                      type="number"
                      className="review-input review-amount-input"
                      step="0.01"
                      min="0.01"
                      value={manualAddForm.amount}
                      onChange={e => setManualAddForm(f => ({ ...f, amount: e.target.value }))}
                      onBlur={(e) => {
                        if (e.target.value) {
                          setManualAddForm(f => ({ ...f, amount: Number(e.target.value).toFixed(2) }));
                        }
                      }}
                      placeholder="0.00"
                      style={{ flex: 1, fontSize: '18px', fontWeight: 'bold' }}
                    />
                  </div>
                  <div className="review-field" style={{ flex: 1, justifyContent: 'flex-end' }}>
                    <label className="review-field-label" style={{ visibility: 'hidden' }}>Type</label>
                    <div className="review-type-toggle" style={{ flex: 1 }}>
                      <button
                        className={`type-btn ${manualAddForm.transaction_type === 'DEBIT' ? 'active debit' : ''}`}
                        onClick={() => setManualAddForm(f => ({ ...f, transaction_type: 'DEBIT' }))}
                      >− Dr</button>
                      <button
                        className={`type-btn ${manualAddForm.transaction_type === 'CREDIT' ? 'active credit' : ''}`}
                        onClick={() => setManualAddForm(f => ({ ...f, transaction_type: 'CREDIT' }))}
                      >+ Cr</button>
                    </div>
                  </div>
                </div>

                {/* Right Side: Accounts */}
                <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Source Account */}
                  <div className="review-field" style={{ flex: 1 }}>
                    <label className="review-field-label">Source Account</label>
                    <button
                      className={`review-account-btn ${!manualAddForm._src_account_name ? 'review-assign' : ''}`}
                      onClick={() => setManualAddPicker('src')}
                      style={{ flex: 1 }}
                    >
                      {manualAddForm._src_account_name || '+ Select bank / CC account'}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                  </div>

                  {/* Dest Account */}
                  <div className="review-field" style={{ flex: 1 }}>
                    <label className="review-field-label">Category / Dest Account</label>
                    <button
                      className={`review-account-btn ${!manualAddForm._offset_account_name ? 'review-assign' : ''}`}
                      onClick={() => setManualAddPicker('dest')}
                      style={{ flex: 1 }}
                    >
                      {manualAddForm._offset_account_name || '+ Assign category'}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Note */}
              <div className="review-field">
                <label className="review-field-label">Note <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></label>
                <textarea
                  className="review-textarea"
                  maxLength={500}
                  rows={2}
                  value={manualAddForm.user_note}
                  onChange={e => setManualAddForm(f => ({ ...f, user_note: e.target.value }))}
                  placeholder="Optional note…"
                />
                <span className="review-char-count">{manualAddForm.user_note.length}/500</span>
              </div>

            </div>

            {/* Validation */}
            {manualAddError && (
              <div className="review-validation-msg">{manualAddError}</div>
            )}

            {/* Footer — no Skip / Save & Skip */}
            <div className="review-footer">
              <button
                className="action-btn"
                onClick={() => setIsManualAddOpen(false)}
                disabled={manualAddSaving}
              >
                Cancel
              </button>
              <button
                className="action-btn approve-selected has-selection review-approve-btn"
                onClick={handleManualAddSave}
                disabled={manualAddSaving}
              >
                {manualAddSaving
                  ? <><span className="spinner-small"></span> Saving…</>
                  : <><ICONS.Check /> Save Transaction</>
                }
              </button>
            </div>

          </div>

          {/* Account pickers — inside overlay so they stack above the card */}
          {manualAddPicker === 'src' && (
            <AccountPickerModal
              onClose={() => setManualAddPicker(null)}
              currentAccountId={manualAddForm.base_account_id}
              preloadedAccounts={cachedAccounts}
              allowedParentAccountNames={['Bank Accounts', 'Credit Cards']}
              allowedAccountNames={['Cash in Hand']}
              onAccountCreated={handleAccountCreated}
              onSelect={account => {
                setManualAddForm(f => ({ ...f, base_account_id: account.account_id, _src_account_name: account.account_name }));
                setManualAddPicker(null);
              }}
            />
          )}
          {manualAddPicker === 'dest' && (
            <AccountPickerModal
              onClose={() => setManualAddPicker(null)}
              currentAccountId={manualAddForm.offset_account_id}
              transactionDirection={manualAddForm.transaction_type}
              preloadedAccounts={cachedAccounts}
              onAccountCreated={handleAccountCreated}
              onSelect={account => {
                setManualAddForm(f => ({ ...f, offset_account_id: account.account_id, _offset_account_name: account.account_name }));
                setManualAddPicker(null);
              }}
            />
          )}
        </div>
      )}

      {isBulkAssignOpen && (
        <div style={{ position: 'fixed', zIndex: 1300 }}>
          <AccountPickerModal
            onClose={() => setIsBulkAssignOpen(false)}
            preloadedAccounts={cachedAccounts}
            onAccountCreated={handleAccountCreated}
            onSelect={handleBulkAssignAccountSelect}
          />
        </div>
      )}
    </div>
  );
};

export default Transactions;