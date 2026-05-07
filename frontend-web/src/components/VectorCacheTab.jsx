import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { supabase } from '../shared/supabase';
import { 
  Database, Search, Plus, X, 
  Loader2, CheckCircle, AlertCircle, Trash2, Cpu, ChevronLeft, ChevronRight, Upload, FileText
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const PAGE_SIZE = 50;

/**
 * VectorCacheTab Component
 * Supports manual entry and CSV bulk upload with automated embedding generation.
 * Implements 50-row pagination with grey/white curved styling.
 */
const VectorCacheTab = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await axios.get(`${API_BASE_URL}/api/qc/vector-cache`, {
                headers: { Authorization: `Bearer ${session?.access_token}` }
            });
            setData(res.data || []);
            setError(null);
        } catch (e) {
            console.error('Failed to load cache:', e);
            setError('Failed to fetch vector cache. Ensure ML service is running.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const handleDelete = async (id) => {
        if (!window.confirm('Remove from global vector cache?')) return;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            await axios.delete(`${API_BASE_URL}/api/qc/vector-cache/${id}`, {
                headers: { Authorization: `Bearer ${session?.access_token}` }
            });
            fetchData();
        } catch (e) {
            alert('Deletion failed: ' + (e.response?.data?.error || e.message));
        }
    };

    const filtered = data.filter(row => 
        row.clean_name.toUpperCase().includes(search.toUpperCase()) ||
        String(row.target_template_id || '').includes(search)
    );
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageData = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const renderPagination = () => {
        const pages = [];
        let start = Math.max(1, currentPage - 2);
        let end = Math.min(totalPages, start + 4);
        if (end - start < 4) start = Math.max(1, end - 4);

        for (let i = start; i <= end; i++) {
            pages.push(
                <button 
                  key={i} 
                  onClick={() => setCurrentPage(i)}
                  style={i === currentPage ? styles.pageBtnActive : styles.pageBtn}
                >
                    {i}
                </button>
            );
        }
        return (
            <div style={styles.pagination}>
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={styles.navBtn}><ChevronLeft size={16}/></button>
                {pages}
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} style={styles.navBtn}><ChevronRight size={16}/></button>
            </div>
        );
    };

    return (
        <div style={styles.container}>
            {showModal && <AddVectorModal onClose={() => setShowModal(false)} onSuccess={fetchData} />}
            
            <header style={styles.header}>
                <div style={styles.headerTitleGroup}>
                   <div style={styles.iconBox}><Database size={18} color="#fff"/></div>
                   <div>
                      <h2 style={styles.title}>Global Vector Cache</h2>
                      <p style={styles.subtitle}>Semantic similarity embeddings for fuzzy string matching</p>
                   </div>
                </div>
                <div style={styles.headerActions}>
                   <div style={styles.searchBox}>
                      <Search size={14} style={styles.searchIcon}/>
                      <input 
                        type="text" 
                        placeholder="Search cache..." 
                        style={styles.searchInput} 
                        value={search} 
                        onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} 
                      />
                   </div>
                   <button style={styles.btnPrimary} onClick={() => setShowModal(true)}>
                      <Plus size={16}/> New Entry / CSV
                   </button>
                </div>
            </header>

            <div style={styles.tableCard}>
                <div style={styles.tableHeader}>
                    <div style={{ flex: 2 }}>CLEAN NAME</div>
                    <div style={{ flex: 1 }}>TEMPLATE ID</div>
                    <div style={{ flex: 1 }}>VERIFIED</div>
                    <div style={{ flex: 1 }}>APPROVALS</div>
                    <div style={{ flex: 1 }}>CREATED</div>
                    <div style={{ width: '60px', textAlign: 'center' }}>ACTIONS</div>
                </div>
                <div style={styles.tableBody}>
                    {loading ? (
                        <div style={styles.loaderArea}>
                            <Loader2 size={32} style={{ animation: 'spin 2s linear infinite', color: '#6366f1' }}/>
                            <p>Querying vector database...</p>
                        </div>
                    ) : error ? (
                        <div style={styles.errorArea}><AlertCircle size={24}/> {error}</div>
                    ) : pageData.length === 0 ? (
                        <div style={styles.emptyArea}>No cache entries found.</div>
                    ) : (
                        pageData.map((row, i) => (
                            <div key={row.cache_id} style={styles.tableRow}>
                                <div style={{ flex: 2, fontWeight: 700, color: '#fff' }}>{row.clean_name}</div>
                                <div style={{ flex: 1 }}><span style={styles.idBadge}>{row.target_template_id}</span></div>
                                <div style={{ flex: 1 }}>
                                    {row.is_verified ? 
                                        <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 800 }}><CheckCircle size={12}/> YES</span> : 
                                        <span style={{ color: '#64748b', fontSize: '10px' }}>PENDING</span>
                                    }
                                </div>
                                <div style={{ flex: 1 }}>
                                    <span style={styles.approvalBadge}>{row.approval_count}</span>
                                </div>
                                <div style={{ flex: 1, fontSize: '10px', opacity: 0.5 }}>{formatDate(row.created_at)}</div>
                                <div style={{ width: '60px', display: 'flex', justifyContent: 'center' }}>
                                    <button style={styles.iconBtn} onClick={() => handleDelete(row.cache_id)}><Trash2 size={14}/></button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                {totalPages > 1 && renderPagination()}
            </div>
        </div>
    );
};

const AddVectorModal = ({ onClose, onSuccess }) => {
    const [mode, setMode] = useState('manual');
    const [formData, setFormData] = useState({ name: '', templateId: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (mode === 'manual' && !formData.name) return setError('Clean name is required');
        
        setLoading(true); setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            await axios.post(`${API_BASE_URL}/api/qc/vector-cache`, {
                clean_name: formData.name.trim().toUpperCase(),
                target_template_id: formData.templateId ? Number(formData.templateId) : null
            }, {
                headers: { Authorization: `Bearer ${session?.access_token}` }
            });
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create vector entry');
        } finally {
            setLoading(false);
        }
    };

    const handleCsvUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const lines = text.split('\n').filter(l => l.trim());
            const entries = [];
            
            lines.forEach((line) => {
                const [name, template_id] = line.split(',').map(s => s.trim());
                if (name && name.toLowerCase() !== 'name') {
                    entries.push({ name, target_template_id: Number(template_id) || null });
                }
            });

            if (entries.length === 0) return setError('No valid entries found in CSV');

            setLoading(true);
            try {
                const { data: { session } } = await supabase.auth.getSession();
                await axios.post(`${API_BASE_URL}/api/qc/vector-cache/bulk`, { entries }, {
                    headers: { Authorization: `Bearer ${session?.access_token}` }
                });
                onSuccess();
                onClose();
            } catch (err) {
                setError('CSV Bulk Upload failed. Ensure ML server is responsive.');
            } finally {
                setLoading(false);
            }
        };
        reader.readAsText(file);
    };

    return (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
                <header style={styles.modalHeader}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button onClick={() => setMode('manual')} style={mode === 'manual' ? styles.tabBtnActive : styles.tabBtn}>Manual</button>
                        <button onClick={() => setMode('csv')} style={mode === 'csv' ? styles.tabBtnActive : styles.tabBtn}>CSV Upload</button>
                    </div>
                    <button onClick={onClose} style={styles.closeBtn}><X size={18}/></button>
                </header>

                <div style={styles.modalBody}>
                    {mode === 'manual' ? (
                        <form onSubmit={handleSubmit}>
                            <div style={styles.formGroup}>
                                <label style={styles.label}>Clean Reference Name</label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. AMAZON CLOUD SVCS"
                                  value={formData.name}
                                  onChange={e => setFormData({...formData, name: e.target.value})}
                                  style={styles.formInput}
                                  autoFocus
                                />
                                <span style={styles.inputNote}>Embedding (384-dim) will be generated automatically.</span>
                            </div>
                            <div style={styles.formGroup}>
                                <label style={styles.label}>Target Template ID</label>
                                <input 
                                  type="number" 
                                  placeholder="ID from COA library"
                                  value={formData.templateId}
                                  onChange={e => setFormData({...formData, templateId: e.target.value})}
                                  style={styles.formInput}
                                />
                            </div>
                            {error && <div style={styles.errorMsg}><AlertCircle size={14}/> {error}</div>}
                            <button type="submit" disabled={loading} style={styles.submitBtn}>
                                {loading ? <><Loader2 size={16} className="spin" style={{ marginRight: '8px'}}/> Generating...</> : 'Create Vector'}
                            </button>
                        </form>
                    ) : (
                        <div style={styles.csvArea}>
                            <div style={styles.csvIcon}><FileText size={48} opacity={0.2}/></div>
                            <p style={{ fontSize: '13px', opacity: 0.7, textAlign: 'center' }}>
                                Upload a CSV file with columns: <br/>
                                <code style={{ color: '#8b5cf6' }}>name, template_id</code>
                            </p>
                            <input type="file" accept=".csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleCsvUpload} />
                            <button style={styles.secondaryBtn} onClick={() => fileInputRef.current.click()} disabled={loading}>
                                {loading ? <Loader2 size={16} className="spin" /> : <Upload size={16}/>}
                                Choose CSV File
                            </button>
                            {error && <div style={{ ...styles.errorMsg, marginTop: '1rem' }}><AlertCircle size={14}/> {error}</div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const styles = {
    container: { display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' },
    headerTitleGroup: { display: 'flex', alignItems: 'center', gap: '1rem' },
    iconBox: { width: '40px', height: '40px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 },
    subtitle: { fontSize: '11px', opacity: 0.5, margin: 0 },
    headerActions: { display: 'flex', gap: '0.75rem', alignItems: 'center' },
    searchBox: { display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '0.4rem 0.75rem', width: '220px' },
    searchIcon: { opacity: 0.3 },
    searchInput: { background: 'transparent', border: 'none', color: '#fff', fontSize: '12px', outline: 'none', width: '100%' },
    btnPrimary: { display: 'flex', alignItems: 'center', gap: '8px', background: 'linear-gradient(135deg, #6366f1, #c084fc)', border: 'none', color: '#fff', padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
    
    tableCard: { background: 'rgba(15, 23, 42, 0.4)', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexGrow: 1, border: '1px solid rgba(255,255,255,0.03)' },
    tableHeader: { display: 'flex', padding: '1rem 1.5rem', background: 'rgba(0,0,0,0.3)', color: '#64748b', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase' },
    tableBody: { overflowY: 'auto', flexGrow: 1 },
    tableRow: { display: 'flex', padding: '0.85rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '13px', color: '#94a3b8', alignItems: 'center' },
    
    idBadge: { background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '10px' },
    approvalBadge: { background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '2px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 900 },
    iconBtn: { background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer' },
    
    pagination: { padding: '0.85rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', background: 'rgba(0,0,0,0.2)' },
    pageBtn: { minWidth: '32px', height: '32px', background: '#334155', border: 'none', color: '#94a3b8', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 },
    pageBtnActive: { minWidth: '32px', height: '32px', background: '#fff', border: 'none', color: '#0f172a', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 800 },
    navBtn: { width: '32px', height: '32px', background: 'transparent', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: 0.5 },
    
    loaderArea: { height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#64748b' },
    errorArea: { height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' },
    emptyArea: { padding: '4rem', textAlign: 'center', color: '#475569' },

    modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modalContent: { background: '#1e293b', borderRadius: '24px', width: '420px', overflow: 'hidden' },
    modalHeader: { padding: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    tabBtn: { background: 'transparent', border: 'none', color: '#64748b', padding: '0.5rem 1rem', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
    tabBtnActive: { background: 'rgba(99, 102, 241, 0.1)', border: 'none', color: '#fff', padding: '0.5rem 1rem', fontSize: '13px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' },
    closeBtn: { background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' },
    modalBody: { padding: '1.5rem' },
    formGroup: { marginBottom: '1rem' },
    label: { display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: '#94a3b8' },
    inputNote: { fontSize: '10px', color: '#64748b', marginTop: '4px', display: 'block' },
    formInput: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '0.75rem', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' },
    submitBtn: { width: '100%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', padding: '0.85rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer', marginTop: '1rem' },
    secondaryBtn: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '0.85rem', borderRadius: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
    errorMsg: { color: '#ef4444', fontSize: '12px', marginBottom: '1rem' },
    csvArea: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1rem 0' },
    csvIcon: { width: '80px', height: '80px', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
};

export default VectorCacheTab;
