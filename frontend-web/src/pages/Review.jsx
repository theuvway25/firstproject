import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Code, FileSearch, Building2, Cpu, Loader2, ChevronLeft, CheckCircle, Download, Link, ScrollText, Trash2, Plus, Minus, RotateCcw, AlertCircle, Info, X, Building, CreditCard, ChevronDown } from "lucide-react";
// import API from "../api/api";
import API from "../api/api";
import { useParsing } from "../context/ParsingContext";

// Generic field editor for Date, Details, Balance
const FieldEditor = ({ value, type, onSave, onCancel }) => {
    const [val, setVal] = useState(value || '');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => { 
        inputRef.current?.focus(); 
        if (type !== 'textarea' && type !== 'date') inputRef.current?.select(); 
    }, [type]);

    const handleSave = async () => {
        setSaving(true);
        await onSave(type === 'number' ? parseFloat(val) || 0 : val);
        setSaving(false);
    };

    const handleKey = (e) => {
        if (e.key === 'Enter' && type !== 'textarea') handleSave();
        if (e.key === 'Escape') onCancel();
    };

    return (
        <div className="amount-editor" onClick={(e) => e.stopPropagation()}>
            {type === 'textarea' ? (
                <textarea
                    ref={inputRef}
                    className="amount-editor-input"
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    onKeyDown={handleKey}
                    style={{ minHeight: '80px', resize: 'vertical', width: '220px' }}
                />
            ) : (
                <input
                    ref={inputRef}
                    className="amount-editor-input"
                    type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                    step={type === 'number' ? '0.01' : undefined}
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    onKeyDown={handleKey}
                    style={{ width: type === 'date' ? '150px' : '100%' }}
                />
            )}
            <div className="amount-editor-actions">
                <button className="amount-editor-save" onClick={handleSave} disabled={saving}>
                    {saving ? '...' : '✓'}
                </button>
                <button className="amount-editor-cancel" onClick={onCancel}>✕</button>
            </div>
        </div>
    );
};

// Specialized amount editor with Dr/Cr toggle
const AmountEditor = ({ tx, onSave, onCancel }) => {
    const isDebit = (tx.debit || 0) > 0;
    const [editAmount, setEditAmount] = useState(isDebit ? tx.debit : tx.credit);
    const [editType, setEditType] = useState(isDebit ? 'DEBIT' : 'CREDIT');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    const handleSave = async () => {
        const parsed = parseFloat(editAmount);
        if (isNaN(parsed) || parsed < 0) return;
        setSaving(true);
        await onSave(parsed, editType);
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
                min="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
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

export default function ReviewPage() {
    const [searchParams] = useSearchParams();
    const documentId = searchParams.get("id");
    const navigate = useNavigate();
    const { retryExtraction } = useParsing();

    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [isApproved, setIsApproved] = useState(false);
    const [isApproving, setIsApproving] = useState(false);
    const [userAccounts, setUserAccounts] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState(null);
    const [isLinkingAccount, setIsLinkingAccount] = useState(false);
    const [accountLinked, setAccountLinked] = useState(false);

    // Editing and Selection state
    const [editableCodeTxns, setEditableCodeTxns] = useState([]);
    const [editableLlmTxns, setEditableLlmTxns] = useState([]);
    const [selectedIndices, setSelectedIndices] = useState({ CODE: [], LLM: [] });
    const [activeParser, setActiveParser] = useState("CODE"); 
    const [editingCell, setEditingCell] = useState(null); // { parser, index, field }
    const [isRetryModalOpen, setIsRetryModalOpen] = useState(false);
    const [retryMethod, setRetryMethod] = useState("CODE"); // CODE, VISION, MANUAL
    const [retryNote, setRetryNote] = useState("");
    const [isRetrying, setIsRetrying] = useState(false);

    // Add Account Modal State
    const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
    const [isAddingAccount, setIsAddingAccount] = useState(false);
    const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
    const accountDropdownRef = useRef(null);
    const [newAccountForm, setNewAccountForm] = useState({
        type: 'BANK',
        institution_name: '',
        account_name: '',
        last4: '',
        ifsc_code: '',
        card_network: 'VISA'
    });

    const fetchReviewData = async () => {
        if (!documentId) return;
        setIsLoading(true);
        try {
            const res = await API.get(`/documents/${documentId}/review`);
            setData(res.data);
            const codeTxns = res.data.code_transactions || [];
            const llmTxns = res.data.llm_transactions || [];
            
            setEditableCodeTxns(codeTxns);
            setEditableLlmTxns(llmTxns);
            
            const preferred = res.data.transaction_parsed_type || "CODE";
            setActiveParser(preferred);
            
            // Auto-deselect rows marked as duplicates by the backend
            setSelectedIndices({
                CODE: codeTxns.map((tx, i) => tx.is_duplicate ? null : i).filter(v => v !== null),
                LLM: llmTxns.map((tx, i) => tx.is_duplicate ? null : i).filter(v => v !== null)
            });
            if (res.data.user_accounts) setUserAccounts(res.data.user_accounts);
            if (res.data.selected_account_id) {
                setSelectedAccountId(res.data.selected_account_id);
                setAccountLinked(true);
            }
            if (res.data.status === "APPROVE") {
                setIsApproved(true);
                setAccountLinked(true);
            }
        } catch (err) {
            console.error(err);
            setError("Failed to fetch review data.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchReviewData();
    }, [documentId]);

    const handleApprove = async () => {
        if (!accountLinked) { alert("Please link an account before approving."); return; }
        const txnsToUse = activeParser === "CODE" ? editableCodeTxns : editableLlmTxns;
        const currentIndices = selectedIndices[activeParser];
        if (currentIndices.length === 0) { alert("Please select at least one transaction to approve."); return; }
        const selectedTxns = currentIndices.map(i => txnsToUse[i]);
        setIsApproving(true);
        try {
            await API.post(`/documents/${documentId}/approve`, { transactions: selectedTxns, parser_type: activeParser });
            setIsApproved(true);
        } catch (err) {
            console.error(err);
            alert("Approval failed: " + (err.response?.data?.detail || err.message));
        } finally {
            setIsApproving(false);
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target)) {
                setIsAccountDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLinkAccount = async () => {
        if (!selectedAccountId) return;
        if (selectedAccountId === "ADD_NEW") {
            setIsAddAccountModalOpen(true);
            return;
        }
        setIsLinkingAccount(true);
        try {
            await API.post(`/documents/${documentId}/select-account`, { account_id: selectedAccountId });
            setAccountLinked(true);
            // Re-fetch data to trigger backend deduplication now that account is linked
            await fetchReviewData();
        } catch (err) {
            console.error(err);
            alert("Failed to link account: " + (err.response?.data?.detail || err.message));
        } finally {
            setIsLinkingAccount(false);
        }
    };

    const handleCreateAccount = async () => {
        if (!newAccountForm.institution_name || !newAccountForm.last4) {
            alert("Please fill in Institution Name and Last 4 digits.");
            return;
        }
        if (newAccountForm.last4.length !== 4) {
            alert("Last 4 digits must be exactly 4 numbers.");
            return;
        }

        setIsAddingAccount(true);
        try {
            const res = await API.post("/documents/accounts", newAccountForm);
            const createdAcc = res.data;
            
            // Add to the list and select it
            setUserAccounts(prev => [...prev, createdAcc].sort((a,b) => a.institution_name.localeCompare(b.institution_name)));
            setSelectedAccountId(createdAcc.account_id);
            setAccountLinked(false); // Make user click "Link" or auto-link? 
            
            // Close modal
            setIsAddAccountModalOpen(false);
            setNewAccountForm({ type: 'BANK', institution_name: '', account_name: '', last4: '', ifsc_code: '', card_network: 'VISA' });
            
            // Auto-link newly created account
            await API.post(`/documents/${documentId}/select-account`, { account_id: createdAcc.account_id });
            setAccountLinked(true);
            
        } catch (err) {
            console.error(err);
            alert("Failed to create account: " + (err.response?.data?.detail || err.message));
        } finally {
            setIsAddingAccount(false);
        }
    };

    const handleRetryExtraction = async () => {
        setIsRetrying(true);
        try {
            await API.post(`/documents/${documentId}/retry`, {
                method: retryMethod,
                note: retryNote
            });
            
            // Trigger progress overlay in context
            retryExtraction(documentId, data?.file_name || "Document");

            // Redirect to dashboard where the progress indicator is
            navigate("/parsing");
        } catch (err) {
            console.error(err);
            alert("Retry failed: " + (err.response?.data?.detail || err.message));
        } finally {
            setIsRetrying(false);
            setIsRetryModalOpen(false);
        }
    };

    const handleUpdateTxn = (parserType, index, field, value) => {
        const updater = parserType === "CODE" ? setEditableCodeTxns : setEditableLlmTxns;
        updater(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const handleAmountSave = (parserType, index, amount, type) => {
        const updater = parserType === "CODE" ? setEditableCodeTxns : setEditableLlmTxns;
        updater(prev => {
            const next = [...prev];
            next[index] = {
                ...next[index],
                debit: type === 'DEBIT' ? amount : 0,
                credit: type === 'CREDIT' ? amount : 0
            };
            return next;
        });
        setEditingCell(null);
    };

    const toggleSelection = (parserType, index) => {
        setSelectedIndices(prev => {
            const current = [...prev[parserType]];
            const foundIdx = current.indexOf(index);
            if (foundIdx > -1) current.splice(foundIdx, 1);
            else current.push(index);
            return { ...prev, [parserType]: current };
        });
    };

    const handleAddTxn = (parserType) => {
        const updater = parserType === "CODE" ? setEditableCodeTxns : setEditableLlmTxns;
        const newTxn = { date: new Date().toISOString().split('T')[0], details: "Manual Entry", debit: 0, credit: 0, balance: 0, confidence: 1.0 };
        updater(prev => {
            const next = [...prev, newTxn];
            setSelectedIndices(prevIndices => ({ ...prevIndices, [parserType]: [...prevIndices[parserType], next.length - 1] }));
            return next;
        });
    };

    const toggleSelectAll = (parserType) => {
        const txns = parserType === "CODE" ? editableCodeTxns : editableLlmTxns;
        setSelectedIndices(prev => {
            const nonDuplicates = txns.map((t, i) => t.is_duplicate ? null : i).filter(v => v !== null);
            const isAllSelected = nonDuplicates.length > 0 && nonDuplicates.every(idx => prev[parserType].includes(idx));
            return { ...prev, [parserType]: isAllSelected ? [] : nonDuplicates };
        });
    };

    const handleDownloadJson = async () => {
        try {
            const txnsToUse = activeParser === "CODE" ? editableCodeTxns : editableLlmTxns;
            const currentIndices = selectedIndices[activeParser];
            const selectedTxns = currentIndices.map(i => txnsToUse[i]);
            const linkedAccount = userAccounts.find(a => a.account_id === selectedAccountId);
            const accountNumber = linkedAccount?.account_number || linkedAccount?.account_number_last4 || linkedAccount?.card_last4 || String(documentId);
            const normalizedTransactions = selectedTxns.map(tx => ({
                txn_date:   tx.txn_date  ?? tx.date        ?? null,
                debit:      tx.debit     != null ? tx.debit  : 0,
                credit:     tx.credit    != null ? tx.credit : 0,
                balance:    tx.balance   != null ? tx.balance : 0,
                details:    tx.details   || tx.description  || "",
                confidence: tx.confidence ?? null,
            }));
            const output = {
                file_name: data?.file_name || `${(data?.bank_name || "bank").replace(/\s+/g, "_").toLowerCase()}_primary_ml.pdf`,
                identifiers: [String(accountNumber)],
                transactions: normalizedTransactions,
            };
            const jsonStr = JSON.stringify(output, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(data?.bank_name || "transactions").replace(/\s+/g, "_")}_transactions.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            alert("Download failed.");
        }
    };

    if (isLoading) return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <Loader2 className="spin-icon" size={48} color="var(--primary-action)" />
            </div>
        );

    if (error || !data || !documentId) return (
            <div id="review-empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', textAlign: 'center', padding: '2rem' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'rgba(72, 62, 168, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', color: 'var(--primary-action)' }}>
                    <FileSearch size={40} />
                </div>
                <h2 id="review-title" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Document Selected</h2>
                <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', maxWidth: '400px', lineHeight: 1.6, marginBottom: '2rem' }}>Transaction data will appear here once you've started processing a statement.</p>
                <button onClick={() => navigate("/parsing")} style={{ padding: '0.8rem 2.5rem', background: 'var(--primary-action)', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>Return to Dashboard</button>
            </div>
        );

    const renderTransactionTable = (transactions, title, icon, parserType) => {
        const isActive = activeParser === parserType;
        const currentSelected = selectedIndices[parserType] || [];
        const isAllSelected = transactions.length > 0 && currentSelected.length === transactions.length;

        return (
            <div style={{
                background: isActive ? 'var(--bg-primary)' : 'var(--card-bg)',
                borderRadius: '16px',
                border: isActive ? '2px solid var(--primary-action)' : '1px solid var(--border-color)',
                overflow: 'hidden',
                marginBottom: '1.5rem',
                opacity: isActive ? 1 : 0.7,
                transition: 'all 0.3s ease',
                position: 'relative'
            }}>
                <div 
                    onClick={() => !isApproved && setActiveParser(parserType)}
                    style={{
                        padding: '1.25rem 1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: isApproved ? 'default' : 'pointer',
                        borderBottom: '1px solid var(--border-color)',
                        background: isActive ? 'rgba(72, 62, 168, 0.05)' : 'transparent'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            border: `2px solid ${isActive ? 'var(--primary-action)' : 'var(--border-color)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: isActive ? 'var(--primary-action)' : 'transparent'
                        }}>
                            {isActive && <Check size={12} color="white" />}
                        </div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {icon} {title}
                        </h3>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.05)', padding: '2px 8px', borderRadius: '10px' }}>
                            {transactions.length} rows
                        </span>
                    </div>
                </div>

                <div id="review-table" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)' }}>
                                <th style={{ width: '40px', padding: '1rem', textAlign: 'center' }}>
                                    <input type="checkbox" checked={isAllSelected} onChange={() => !isApproved && toggleSelectAll(parserType)} disabled={isApproved} />
                                </th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', width: '130px' }}>Date</th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Details</th>
                                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', width: '120px' }}>Debit</th>
                                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', width: '120px' }}>Credit</th>
                                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', width: '130px' }}>Balance</th>
                                <th style={{ padding: '1rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', width: '100px' }}>Confidence</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions && transactions.length > 0 ? transactions.map((tx, i) => {
                                const isSelected = currentSelected.includes(i);
                                const isDebit = (tx.debit || 0) > 0;
                                const amount = isDebit ? tx.debit : tx.credit;

                                return (
                                    <tr 
                                        key={i} 
                                        style={{ 
                                            borderTop: '1px solid var(--border-color)', 
                                            background: tx.is_duplicate ? 'rgba(43, 67, 102, 0.12)' : (isSelected ? 'rgba(72, 62, 168, 0.02)' : 'transparent'),
                                            borderLeft: tx.is_duplicate ? '4px solid #2B4366' : '4px solid transparent',
                                            position: 'relative',
                                            transition: 'background 0.2s ease'
                                        }}
                                    >
                                        <td style={{ textAlign: 'center', padding: '0.5rem' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={isSelected} 
                                                onChange={() => !isApproved && !tx.is_duplicate && toggleSelection(parserType, i)} 
                                                disabled={isApproved || tx.is_duplicate} 
                                            />
                                        </td>
                                        
                                        {/* Date Field */}
                                        <td style={{ padding: '0.5rem', position: 'relative' }}>
                                            {editingCell?.parser === parserType && editingCell?.index === i && editingCell?.field === 'date' ? (
                                                <FieldEditor 
                                                    value={tx.date || tx.txn_date || ''}
                                                    type="date"
                                                    onSave={(val) => { handleUpdateTxn(parserType, i, 'date', val); setEditingCell(null); }}
                                                    onCancel={() => setEditingCell(null)}
                                                />
                                            ) : (
                                                <div 
                                                    className="amount-cell-review"
                                                    onClick={() => !isApproved && !tx.is_duplicate && setEditingCell({ parser: parserType, index: i, field: 'date' })}
                                                    style={{ cursor: (isApproved || tx.is_duplicate) ? 'default' : 'pointer', width: '120px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {tx.date || tx.txn_date || ''}
                                                        {!isApproved && !tx.is_duplicate && <span className="amount-edit-hint">✎</span>}
                                                    </div>
                                                    {tx.is_duplicate && (
                                                        <span style={{ 
                                                            fontSize: '10px', 
                                                            fontWeight: 800, 
                                                            background: '#2B4366', 
                                                            color: 'white', 
                                                            padding: '2px 6px', 
                                                            borderRadius: '4px',
                                                            letterSpacing: '0.5px'
                                                        }}>
                                                            DUPLICATE
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>

                                        {/* Details Field */}
                                        <td style={{ padding: '0.5rem', position: 'relative' }}>
                                            {editingCell?.parser === parserType && editingCell?.index === i && editingCell?.field === 'details' ? (
                                                <FieldEditor 
                                                    value={tx.details || tx.description || ''}
                                                    type="textarea"
                                                    onSave={(val) => { handleUpdateTxn(parserType, i, 'details', val); setEditingCell(null); }}
                                                    onCancel={() => setEditingCell(null)}
                                                />
                                            ) : (
                                                <div 
                                                    className="amount-cell-review"
                                                    onClick={() => !isApproved && !tx.is_duplicate && setEditingCell({ parser: parserType, index: i, field: 'details' })}
                                                    style={{ cursor: (isApproved || tx.is_duplicate) ? 'default' : 'pointer', minWidth: '200px' }}
                                                >
                                                    {tx.details || tx.description || ''}
                                                    {!isApproved && <span className="amount-edit-hint">✎</span>}
                                                </div>
                                            )}
                                        </td>

                                        {/* Separate Debit and Credit Cells for perfect alignment */}
                                        {editingCell?.parser === parserType && editingCell?.index === i && editingCell?.field === 'amount' ? (
                                            <td colSpan="2" style={{ padding: '0.5rem 1rem', position: 'relative' }}>
                                                <AmountEditor 
                                                    tx={tx} 
                                                    onSave={(amt, type) => handleAmountSave(parserType, i, amt, type)} 
                                                    onCancel={() => setEditingCell(null)} 
                                                />
                                            </td>
                                        ) : (
                                            <>
                                                {/* Debit Cell */}
                                                <td 
                                                    style={{ padding: '0.5rem 1rem', textAlign: 'right', width: '120px', position: 'relative' }}
                                                    onClick={() => !isApproved && !tx.is_duplicate && setEditingCell({ parser: parserType, index: i, field: 'amount' })}
                                                >
                                                    <div className="amount-cell-review" style={{ cursor: (isApproved || tx.is_duplicate) ? 'default' : 'pointer', justifyContent: 'flex-end', width: '100%', gap: '4px' }}>
                                                        {isDebit && <Minus size={12} style={{ color: '#F87171' }} />}
                                                        <span style={{ color: isDebit ? '#F87171' : '#e2e8f0', fontWeight: 600 }}>{isDebit ? `₹${amount}` : '--'}</span>
                                                        {!isApproved && <span className="amount-edit-hint">✎</span>}
                                                    </div>
                                                </td>
                                                {/* Credit Cell */}
                                                <td 
                                                    style={{ padding: '0.5rem 1rem', textAlign: 'right', width: '120px', position: 'relative' }}
                                                    onClick={() => !isApproved && !tx.is_duplicate && setEditingCell({ parser: parserType, index: i, field: 'amount' })}
                                                >
                                                    <div className="amount-cell-review" style={{ cursor: (isApproved || tx.is_duplicate) ? 'default' : 'pointer', justifyContent: 'flex-end', width: '100%', gap: '4px' }}>
                                                        {!isDebit && amount > 0 && <Plus size={12} style={{ color: '#34D399' }} />}
                                                        <span style={{ color: !isDebit && amount > 0 ? '#34D399' : '#e2e8f0', fontWeight: 600 }}>{!isDebit && amount > 0 ? `₹${amount}` : '--'}</span>
                                                        {!isApproved && <span className="amount-edit-hint">✎</span>}
                                                    </div>
                                                </td>
                                            </>
                                        )}

                                        {/* Balance Field */}
                                        <td style={{ padding: '0.5rem', position: 'relative', textAlign: 'right' }}>
                                            {editingCell?.parser === parserType && editingCell?.index === i && editingCell?.field === 'balance' ? (
                                                <FieldEditor 
                                                    value={tx.balance || ''}
                                                    type="number"
                                                    onSave={(val) => { handleUpdateTxn(parserType, i, 'balance', val); setEditingCell(null); }}
                                                    onCancel={() => setEditingCell(null)}
                                                />
                                            ) : (
                                                <div 
                                                    className="amount-cell-review"
                                                    onClick={() => !isApproved && !tx.is_duplicate && setEditingCell({ parser: parserType, index: i, field: 'balance' })}
                                                    style={{ cursor: (isApproved || tx.is_duplicate) ? 'default' : 'pointer', fontWeight: 600, width: '90px', marginLeft: 'auto' }}
                                                >
                                                    ₹{tx.balance || '0'}
                                                    {!isApproved && <span className="amount-edit-hint">✎</span>}
                                                </div>
                                            )}
                                        </td>

                                        <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                                            <span style={{ 
                                                background: tx.confidence >= 0.9 ? '#def7ec' : tx.confidence >= 0.7 ? '#fef3c7' : '#fde8e8',
                                                color: tx.confidence >= 0.9 ? '#03543f' : tx.confidence >= 0.7 ? '#92400e' : '#9b1c1c',
                                                padding: '2px 6px', borderRadius: '50px', fontSize: '0.65rem', fontWeight: 700 
                                            }}>
                                                {tx.confidence != null ? (tx.confidence * 100).toFixed(0) + '%' : 'N/A'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>No transactions extracted.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {!isApproved && (
                    <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'center', background: isActive ? 'rgba(72, 62, 168, 0.02)' : 'transparent' }}>
                        <button id={`review-add-txn-${parserType}`} onClick={() => handleAddTxn(parserType)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.5rem 1.25rem', background: 'none', border: '1.5px dashed var(--primary-action)', borderRadius: '8px', color: 'var(--primary-action)', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>
                            <Plus size={16} /> Add Missing Transaction
                        </button>
                    </div>
                )}
                
                <style dangerouslySetInnerHTML={{ __html: `
                    .table-input { background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 4px 8px; font-family: inherit; font-size: 0.85rem; color: var(--text-primary); transition: all 0.2s; }
                    .table-input:hover:not(:disabled) { border-color: var(--border-color); background: var(--bg-secondary); }
                    .table-input:focus:not(:disabled) { border-color: var(--primary-action); background: var(--bg-primary); outline: none; box-shadow: 0 0 0 2px rgba(72, 62, 168, 0.1); }
                    
                    .amount-cell-review { position: relative; border-radius: 6px; padding: 4px 8px; transition: background 0.15s; user-select: none; min-height: 32px; display: flex; align-items: center; }
                    .amount-cell-review:hover:not(:disabled) { background: rgba(255, 255, 255, 0.04); }
                    
                    .amount-edit-hint { position: absolute; top: -2px; right: -2px; font-size: 11px; opacity: 0; color: var(--text-secondary); transition: opacity 0.15s; }
                    .amount-cell-review:hover .amount-edit-hint { opacity: 1; }
                    
                    .amount-editor { display: flex; flex-direction: column; gap: 6px; background: var(--bg-primary, #1a1a2e); border: 1px solid var(--glass-border); border-radius: 10px; padding: 8px 10px; min-width: 140px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); text-align: left; z-index: 100; position: absolute; top: 100%; right: 0; }
                    .amount-editor-type-toggle { display: flex; border-radius: 6px; overflow: hidden; border: 1px solid var(--glass-border); margin-bottom: 4px; }
                    .type-btn { flex: 1; padding: 4px 8px; font-size: 11px; font-weight: 700; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
                    .type-btn.active.debit { background: rgba(248, 113, 113, 0.15); color: #F87171; }
                    .type-btn.active.credit { background: rgba(52, 211, 153, 0.15); color: #34D399; }
                    .amount-editor-input { width: 100%; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--glass-border); border-radius: 6px; padding: 6px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; outline: none; }
                    .amount-editor-input:focus { border-color: var(--accent-color); }
                    .amount-editor-actions { display: flex; gap: 6px; }
                    .amount-editor-save, .amount-editor-cancel { flex: 1; padding: 5px 0; border-radius: 6px; font-size: 13px; font-weight: 700; border: 1px solid var(--glass-border); cursor: pointer; transition: all 0.15s; }
                    .amount-editor-save { background: rgba(52, 211, 153, 0.15); color: #34D399; border-color: rgba(52, 211, 153, 0.3); }
                    .amount-editor-save:hover:not(:disabled) { background: rgba(52, 211, 153, 0.25); }
                    .amount-editor-cancel { background: transparent; color: var(--text-secondary); }
                    .amount-editor-cancel:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
                `}} />
            </div>
        );
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ maxWidth: '1400px', margin: '0 auto' }}
        >
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: 'none',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.875rem',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontWeight: 600,
                            marginBottom: '0.75rem',
                            padding: 0,
                        }}
                    >
                        <ChevronLeft size={16} /> Back to Dashboard
                    </button>
                    <h2 id="review-title" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Review & Approve</h2>
                </div>
                
                <div id="review-header-actions" style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                        onClick={handleDownloadJson}
                        style={{
                            padding: '0.6rem 1.5rem',
                            background: 'none',
                            color: 'var(--primary-action)',
                            border: '2px solid var(--primary-action)',
                            borderRadius: '10px',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Download size={15} /> Export Selected
                    </button>

                    {isApproved ? (
                        <div style={{
                            padding: '0.6rem 2rem',
                            background: 'var(--accent-color)',
                            color: 'white',
                            borderRadius: '10px',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 12px rgba(127, 175, 138, 0.2)'
                        }}>
                            <CheckCircle size={16} /> APPROVED
                        </div>
                    ) : (
                        <button
                            id="review-approve-btn"
                            onClick={handleApprove}
                            disabled={isApproving || !accountLinked}
                            style={{
                                padding: '0.6rem 2.5rem',
                                background: (!accountLinked || isApproving) ? '#e5e7eb' : 'var(--primary-action)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '10px',
                                fontWeight: 800,
                                fontSize: '0.9rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: (isApproving || !accountLinked) ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: (!accountLinked || isApproving) ? 'none' : '0 4px 12px rgba(72, 62, 168, 0.3)'
                            }}
                        >
                            {isApproving ? (
                                <><Loader2 size={16} className="spin-icon" /> PROCESSING...</>
                            ) : (
                                <><Check size={18} /> APPROVE SELECTED ({selectedIndices[activeParser]?.length || 0})</>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Deduplication Info Callout */}
            {!isApproved && data?.duplicates_count > 0 && (
                <div style={{
                    background: 'rgba(72, 62, 168, 0.05)',
                    border: '1px solid rgba(72, 62, 168, 0.2)',
                    borderRadius: '12px',
                    padding: '0.75rem 1.25rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    color: 'var(--primary-action)',
                    fontSize: '0.875rem',
                    fontWeight: 600
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Link size={20} />
                        <span>Deduplication: We found <b>{data.duplicates_count} transactions</b> that were already imported in previous uploads. They've been auto-deselected for your review.</span>
                    </div>
                </div>
            )}

            {/* Quick Stats Summary Section */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '1.25rem',
                marginBottom: '2rem'
            }}>
                {/* Card 1: Total */}
                <div className="stats-card">
                    <div className="stats-icon" style={{ background: 'rgba(72, 62, 168, 0.1)', color: 'var(--primary-action)' }}>
                        <ScrollText size={24} />
                    </div>
                    <div>
                        <div className="stats-label">Total Transactions</div>
                        <div className="stats-value">{(activeParser === "CODE" ? editableCodeTxns : editableLlmTxns).length}</div>
                    </div>
                </div>

                {/* Card 2: Credits */}
                <div className="stats-card">
                    <div className="stats-icon" style={{ background: '#def7ec', color: '#03543f' }}>
                        <Plus size={24} />
                    </div>
                    <div>
                        <div className="stats-label">Number of Credits (+)</div>
                        <div className="stats-value" style={{ color: '#03543f' }}>
                            {(activeParser === "CODE" ? editableCodeTxns : editableLlmTxns).filter(t => t.credit > 0).length}
                        </div>
                    </div>
                </div>

                {/* Card 3: Debits */}
                <div className="stats-card">
                    <div className="stats-icon" style={{ background: '#fdf2f2', color: '#9b1c1c' }}>
                        <Minus size={24} /> 
                    </div>
                    <div>
                        <div className="stats-label">Number of Debits (-)</div>
                        <div className="stats-value" style={{ color: '#9b1c1c' }}>
                            {(activeParser === "CODE" ? editableCodeTxns : editableLlmTxns).filter(t => t.debit > 0).length}
                        </div>
                    </div>
                </div>

                <style dangerouslySetInnerHTML={{ __html: `
                    .stats-card {
                        background: white;
                        border: 1px solid var(--border-color);
                        border-radius: 16px;
                        padding: 1.25rem 1.5rem;
                        display: flex;
                        align-items: center;
                        gap: 1.25rem;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.03);
                        transition: transform 0.2s, box-shadow 0.2s;
                    }
                    .stats-card:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 8px 20px rgba(0,0,0,0.06);
                    }
                    .stats-icon {
                        width: 56px;
                        height: 56px;
                        border-radius: 14px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                    }
                    .stats-label {
                        font-size: 0.75rem;
                        font-weight: 700;
                        color: var(--text-secondary);
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 4px;
                    }
                    .stats-value {
                        font-size: 1.5rem;
                        font-weight: 800;
                        color: var(--text-primary);
                    }
                `}} />
            </div>

            {/* Metadata bar */}
            <div style={{
                background: 'var(--card-bg)',
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '2.5rem',
                marginBottom: '1.5rem',
                padding: '1.5rem 2rem'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', textTransform: 'uppercase' }}>
                        <Building2 size={12} /> Institution
                    </label>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>{data.bank_name}</span>
                </div>

                <div id="review-link-account" style={{ flex: 1, minWidth: '300px' }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px', textTransform: 'uppercase' }}>
                        <Link size={12} /> Target Account for Transactions
                    </label>
                    <div style={{ display: 'flex', gap: '0.75rem', position: 'relative' }} ref={accountDropdownRef}>
                        <div 
                            onClick={() => !isApproved && setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                            style={{
                                flex: 1,
                                padding: '0.6rem 1rem',
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                color: selectedAccountId ? 'var(--text-primary)' : 'var(--text-secondary)',
                                border: '1.5px solid var(--border-color)',
                                borderRadius: '10px',
                                background: 'var(--input-bg)',
                                cursor: isApproved ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '10px',
                                minWidth: '220px'
                            }}
                        >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedAccountId 
                                    ? userAccounts.find(a => a.account_id === selectedAccountId)?.institution_name + " \u2022\u2022\u2022\u2022" + (userAccounts.find(a => a.account_id === selectedAccountId)?.account_number_last4 || userAccounts.find(a => a.account_id === selectedAccountId)?.card_last4)
                                    : "\u2014 Select destination account \u2014"}
                            </span>
                            <ChevronDown size={16} />
                        </div>

                        {isAccountDropdownOpen && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                transform: 'translateY(10px)',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--glass-border)',
                                borderRadius: '16px',
                                boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                                zIndex: 1000,
                                overflow: 'hidden',
                                padding: '8px'
                            }}>
                                <div style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '8px' }}>
                                    {userAccounts.length === 0 && (
                                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                            No accounts found.
                                        </div>
                                    )}
                                    {userAccounts.map(acct => (
                                        <div 
                                            key={acct.account_id}
                                            onClick={() => {
                                                setSelectedAccountId(acct.account_id);
                                                setAccountLinked(false);
                                                setIsAccountDropdownOpen(false);
                                            }}
                                            style={{
                                                padding: '10px 14px',
                                                borderRadius: '10px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: 600,
                                                background: selectedAccountId === acct.account_id ? 'rgba(72, 62, 168, 0.08)' : 'transparent',
                                                color: selectedAccountId === acct.account_id ? 'var(--primary-action)' : 'var(--text-primary)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                                transition: 'all 0.15s'
                                            }}
                                            onMouseOver={e => e.currentTarget.style.background = 'rgba(72, 62, 168, 0.05)'}
                                            onMouseOut={e => e.currentTarget.style.background = selectedAccountId === acct.account_id ? 'rgba(72, 62, 168, 0.08)' : 'transparent'}
                                        >
                                            {acct.card_last4 ? <CreditCard size={14} /> : <Building size={14} />}
                                            <span>{acct.institution_name} <span style={{ opacity: 0.6, fontSize: '0.75rem', fontWeight: 500 }}>&bull;&bull;&bull;&bull;{acct.account_number_last4 || acct.card_last4}</span></span>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ padding: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                                    <button 
                                        onClick={() => {
                                            setIsAddAccountModalOpen(true);
                                            setIsAccountDropdownOpen(false);
                                        }}
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '8px', 
                                            padding: '0.6rem', 
                                            background: 'none', 
                                            border: '1.5px dashed var(--primary-action)', 
                                            borderRadius: '10px', 
                                            color: 'var(--primary-action)', 
                                            fontSize: '0.8rem', 
                                            fontWeight: 700, 
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            width: '100%',
                                            justifyContent: 'center'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = 'rgba(72, 62, 168, 0.05)'}
                                        onMouseOut={e => e.currentTarget.style.background = 'none'}
                                    >
                                        <Plus size={16} /> Add New Bank Account
                                    </button>
                                </div>
                            </div>
                        )}

                        {!accountLinked && (
                            <button
                                id="review-link-btn"
                                onClick={handleLinkAccount}
                                disabled={!selectedAccountId || isLinkingAccount || isApproved}
                                style={{
                                    padding: '0 1.5rem',
                                    background: selectedAccountId ? 'var(--primary-action)' : '#e5e7eb',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontWeight: 700,
                                    fontSize: '0.8rem',
                                    cursor: selectedAccountId && !isApproved ? 'pointer' : 'not-allowed',
                                }}
                            >
                                Link
                            </button>
                        )}
                        {accountLinked && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-color)', fontWeight: 700, fontSize: '0.85rem', padding: '0 1rem' }}>
                                <CheckCircle size={16} /> Linked
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                <div id="review-tables" style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Step 1: Choose extraction source & Edit if needed</div>
                    </div>
                    
                    {renderTransactionTable(
                        editableCodeTxns,
                        "Code-Based Extraction",
                        <Code size={20} style={{ color: 'var(--accent-color)' }} />,
                        "CODE"
                    )}
                    
                    {renderTransactionTable(
                        editableLlmTxns,
                        "AI-Powered Extraction",
                        <Cpu size={20} style={{ color: 'var(--primary-action)' }} />,
                        "LLM"
                    )}
                </div>

                <div style={{ flex: 1, position: 'sticky', top: '2rem', minWidth: 0 }}>
                    <div style={{
                        background: 'var(--card-bg)',
                        borderRadius: '20px',
                        border: '1px solid var(--border-color)',
                        padding: '1.5rem',
                        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)'
                    }}>
                        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ScrollText size={18} style={{ color: 'var(--primary-action)' }} /> Analysis Meta
                        </h3>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px' }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Active Selection</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {activeParser === "CODE" ? <Code size={16} color="var(--accent-color)" /> : <Cpu size={16} color="var(--primary-action)" />}
                                    <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{activeParser} Results</span>
                                </div>
                                <div style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-secondary)' }}>
                                    Selected {selectedIndices[activeParser].length} of {activeParser === "CODE" ? editableCodeTxns.length : editableLlmTxns.length} transactions.
                                </div>
                            </div>

                            <div>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Format Identifiers</div>
                                <pre style={{
                                    background: 'var(--bg-secondary)',
                                    padding: '1rem',
                                    borderRadius: '12px',
                                    fontSize: '0.7rem',
                                    color: 'var(--text-primary)',
                                    overflow: 'auto',
                                    maxHeight: '300px',
                                    border: '1px solid var(--border-color)',
                                    margin: 0
                                }}>
                                    {JSON.stringify(data.identifier_json, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Retry Extraction Modal */}
            {isRetryModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000 }}>
                    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ background: 'var(--bg-secondary)', padding: '2.5rem', borderRadius: '24px', border: '1px solid var(--glass-border)', maxWidth: '500px', width: '90%', boxShadow: '0 25px 60px -12px rgba(0,0,0,0.4)', color: 'var(--text-primary)' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.75rem' }}>Retry extraction</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>
                            Choose a different extraction method or add a note to help the parser.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '4px' }}>Extraction method</label>
                            
                            {[
                                { id: 'CODE', label: 'Code-based (current)', sub: 'Fastest extraction method' },
                                { id: 'VISION', label: 'AI vision extraction', sub: 'Better for scanned or image-based PDFs', recommended: true },
                                { id: 'MANUAL', label: 'Manual entry', sub: 'Set status to review and add manually' }
                            ].map(method => (
                                <div 
                                    key={method.id}
                                    onClick={() => setRetryMethod(method.id)}
                                    style={{ 
                                        padding: '1rem', 
                                        borderRadius: '12px', 
                                        border: `2px solid ${retryMethod === method.id ? 'var(--primary-action)' : 'var(--border-color)'}`,
                                        background: retryMethod === method.id ? 'rgba(72, 62, 168, 0.05)' : 'var(--bg-primary)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{ 
                                        width: '20px', height: '20px', borderRadius: '50%', 
                                        border: `2px solid ${retryMethod === method.id ? 'var(--primary-action)' : 'var(--border-color)'}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        {retryMethod === method.id && <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--primary-action)' }} />}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {method.label}
                                            {method.recommended && <span style={{ background: 'rgba(72, 62, 168, 0.1)', color: 'var(--primary-action)', fontSize: '0.65rem', padding: '2px 8px', borderRadius: '20px' }}>Recommended</span>}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{method.sub}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {data?.logic_version >= 3 && (
                            <div style={{ 
                                padding: '1rem', 
                                background: 'rgba(231, 76, 60, 0.08)', 
                                border: '1px solid rgba(231, 76, 60, 0.2)', 
                                borderRadius: '12px', 
                                marginBottom: '2rem', 
                                display: 'flex', 
                                gap: '12px' 
                            }}>
                                <AlertCircle size={20} color="#e74c3c" style={{ flexShrink: 0 }} />
                                <div style={{ fontSize: '0.8rem', color: '#e74c3c', lineHeight: 1.5, fontWeight: 500 }}>
                                    <b>AI reaches its limit:</b> This format has been refined {data.logic_version} times. Artificial Intelligence is struggling to fix this structure. We recommend using <b>AI Vision</b> or manually editing the transactions.
                                </div>
                            </div>
                        )}

                        <div style={{ marginBottom: '2rem' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: '8px' }}>Reason / note <span style={{ fontWeight: 500, opacity: 0.6 }}>(optional)</span></label>
                            <textarea 
                                value={retryNote}
                                onChange={(e) => setRetryNote(e.target.value)}
                                placeholder="e.g. Transactions are missing from page 3 onwards..."
                                style={{ 
                                    width: '100%', minHeight: '100px', padding: '0.875rem', 
                                    borderRadius: '12px', background: 'var(--bg-primary)', 
                                    border: '1px solid var(--border-color)', color: 'var(--text-primary)',
                                    resize: 'vertical', fontSize: '0.9rem', outline: 'none'
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button 
                                onClick={() => setIsRetryModalOpen(false)} 
                                disabled={isRetrying}
                                style={{ flex: 1, padding: '0.875rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontWeight: 700, cursor: isRetrying ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)' }}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleRetryExtraction} 
                                disabled={isRetrying}
                                style={{ 
                                    flex: 1.5, 
                                    padding: '0.875rem', 
                                    borderRadius: '12px', 
                                    border: 'none', 
                                    background: 'var(--primary-action)', 
                                    color: 'white', 
                                    fontWeight: 700, 
                                    cursor: isRetrying ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px'
                                }}
                            >
                                {isRetrying ? <Loader2 size={18} className="spin-icon" /> : <RotateCcw size={18} />}
                                START RETRY
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
            {/* Add Account Modal */}
            {isAddAccountModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000 }}>
                    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ background: 'var(--bg-secondary)', padding: '2.5rem', borderRadius: '24px', border: '1px solid var(--glass-border)', maxWidth: '500px', width: '90%', boxShadow: '0 25px 60px -12px rgba(0,0,0,0.4)', color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>Add Account</h3>
                            <button onClick={() => setIsAddAccountModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={20} /></button>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem' }}>
                            <button 
                                onClick={() => setNewAccountForm(p => ({ ...p, type: 'BANK' }))}
                                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: `2px solid ${newAccountForm.type === 'BANK' ? 'var(--primary-action)' : 'var(--border-color)'}`, background: newAccountForm.type === 'BANK' ? 'rgba(72,62,168,0.05)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, fontSize: '0.85rem' }}
                            >
                                <Building size={16} /> Bank
                            </button>
                            <button 
                                onClick={() => setNewAccountForm(p => ({ ...p, type: 'CREDIT_CARD' }))}
                                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: `2px solid ${newAccountForm.type === 'CREDIT_CARD' ? 'var(--primary-action)' : 'var(--border-color)'}`, background: newAccountForm.type === 'CREDIT_CARD' ? 'rgba(72,62,168,0.05)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, fontSize: '0.85rem' }}
                            >
                                <CreditCard size={16} /> Credit Card
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2rem' }}>
                            <div style={{ padding: '12px', background: 'rgba(72, 62, 168, 0.05)', border: '1px solid rgba(72, 62, 168, 0.1)', borderRadius: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <Info size={16} color="var(--primary-action)" />
                                    <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>Account Identifier</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Add details to help match uploaded statements.</p>
                            </div>

                            <div className="form-group">
                                <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>Institution / Bank Name *</label>
                                <input 
                                    type="text" 
                                    className="form-input" 
                                    placeholder="e.g. HDFC, SBI"
                                    value={newAccountForm.institution_name}
                                    onChange={e => setNewAccountForm(p => ({ ...p, institution_name: e.target.value }))}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>Last 4 Digits *</label>
                                    <input 
                                        type="text" 
                                        maxLength={4}
                                        placeholder="e.g. 1234"
                                        value={newAccountForm.last4}
                                        onChange={e => setNewAccountForm(p => ({ ...p, last4: e.target.value.replace(/\D/g, '') }))}
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                                    />
                                </div>
                                {newAccountForm.type === 'BANK' ? (
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>IFSC Code</label>
                                        <input 
                                            type="text" 
                                            placeholder="e.g. HDFC0001234"
                                            value={newAccountForm.ifsc_code}
                                            onChange={e => setNewAccountForm(p => ({ ...p, ifsc_code: e.target.value.toUpperCase() }))}
                                            style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                                        />
                                    </div>
                                ) : (
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>Network</label>
                                        <select 
                                            value={newAccountForm.card_network}
                                            onChange={e => setNewAccountForm(p => ({ ...p, card_network: e.target.value }))}
                                            style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                                        >
                                            <option value="VISA">Visa</option>
                                            <option value="MASTERCARD">Mastercard</option>
                                            <option value="AMEX">Amex</option>
                                            <option value="OTHER">Other</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button 
                                onClick={() => setIsAddAccountModalOpen(false)}
                                style={{ flex: 1, padding: '0.875rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-secondary)', fontWeight: 700, cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleCreateAccount}
                                disabled={isAddingAccount || !newAccountForm.institution_name || newAccountForm.last4.length !== 4}
                                style={{ flex: 1.5, padding: '0.875rem', borderRadius: '12px', border: 'none', background: 'var(--primary-action)', color: 'white', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (isAddingAccount || !newAccountForm.institution_name || newAccountForm.last4.length !== 4) ? 0.6 : 1 }}
                            >
                                {isAddingAccount ? <Loader2 size={18} className="spin-icon" /> : 'Add Account'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </motion.div>
    );
}