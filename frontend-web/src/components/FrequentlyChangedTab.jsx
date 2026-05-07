import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { supabase } from '../shared/supabase';
import { 
  History, Loader2, FileText, CheckCircle2, 
  AlertTriangle, Search, ChevronRight, Activity, Percent, Zap
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const FrequentlyChangedTab = () => {
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchDocs = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const res = await axios.get(`${API_BASE_URL}/api/qc/frequently-changed-docs`, {
                    headers: { Authorization: `Bearer ${session?.access_token}` }
                });
                setDocs(res.data || []);
            } catch (err) {
                setError('Failed to load frequently changed documents');
            } finally {
                setLoading(false);
            }
        };
        fetchDocs();
    }, []);

    if (loading) return (
        <div style={styles.center}><Loader2 className="spin" size={32} color="#6366f1"/></div>
    );

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <div style={styles.iconBox}><Zap size={18} color="#fff"/></div>
                    <div>
                        <h2 style={styles.title}>Frequently Changed</h2>
                        <p style={styles.subtitle}>Documents with low accuracy or high manual intervention</p>
                    </div>
                </div>
            </header>

            <div style={styles.tableCard}>
                <div style={styles.tableHeader}>
                    <div style={{ flex: 2 }}>FILE NAME</div>
                    <div style={{ flex: 1.5 }}>INSTITUTION</div>
                    <div style={{ flex: 1 }}>MATCH RATE</div>
                    <div style={{ flex: 1 }}>STATUS</div>
                    <div style={{ flex: 1 }}>LAST UPDATED</div>
                </div>
                <div style={styles.tableBody}>
                    {docs.length === 0 ? (
                        <div style={styles.empty}>No unstable formats detected.</div>
                    ) : (
                        docs.map(row => (
                            <div key={row.qc_id} style={styles.tableRow}>
                                <div style={{ flex: 2, fontWeight: 700, color: '#fff' }}>{row.file_name}</div>
                                <div style={{ flex: 1.5 }}>{row.institution_name}</div>
                                <div style={{ flex: 1 }}>{row.accuracy}%</div>
                                <div style={{ flex: 1 }}>
                                    <span style={styles.statusBadge}>{row.qc_status}</span>
                                </div>
                                <div style={{ flex: 1, fontSize: '11px', opacity: 0.5 }}>
                                    {formatDate(row.created_at)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

const styles = {
    container: { height: '100%', display: 'flex', flexDirection: 'column' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
    headerLeft: { display: 'flex', alignItems: 'center', gap: '1rem' },
    iconBox: { width: '40px', height: '40px', background: 'linear-gradient(135deg, #ef4444, #f59e0b)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 },
    subtitle: { fontSize: '11px', opacity: 0.5, margin: 0 },
    
    tableCard: { background: 'rgba(15, 23, 42, 0.4)', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
    tableHeader: { display: 'flex', padding: '1.25rem 1.5rem', background: 'rgba(0,0,0,0.3)', color: '#64748b', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase' },
    tableBody: { overflowY: 'auto' },
    tableRow: { display: 'flex', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '13px', color: '#94a3b8', alignItems: 'center' },
    
    statusBadge: { color: '#ef4444', fontWeight: 900, fontSize: '10px', textTransform: 'uppercase' },

    center: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    empty: { padding: '4rem', textAlign: 'center', opacity: 0.3 }
};

export default FrequentlyChangedTab;
