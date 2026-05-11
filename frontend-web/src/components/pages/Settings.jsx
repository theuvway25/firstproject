import React from 'react';
import { ICONS } from '../Icons';
import { useAuth } from '../../shared/hooks/useAuth';
import '../../styles/Accounts.css';

const Settings = ({ onClose, toggleTheme, isDarkMode }) => {
  const { user } = useAuth();
  const email = user?.email || '—';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="close-modal-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="modal-body" style={{ gap: '28px' }}>

          {/* ── Profile ── */}
          <section>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '14px', paddingBottom: '10px',
              borderBottom: '1px solid var(--glass-border)'
            }}>
              <span style={{ fontSize: '16px' }}>👤</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                Profile
              </span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="settings-email">Email</label>
              <input
                id="settings-email"
                className="form-input"
                type="email"
                value={email}
                readOnly
                disabled
                style={{ cursor: 'default' }}
              />
            </div>
          </section>

          {/* ── Appearance ── */}
          <section>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '14px', paddingBottom: '10px',
              borderBottom: '1px solid var(--glass-border)'
            }}>
              <span style={{ fontSize: '16px' }}>🎨</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                Appearance
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="form-label" style={{ marginBottom: '2px' }}>Theme</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {isDarkMode ? 'Dark mode is active' : 'Light mode is active'}
                </div>
              </div>
              <button
                id="settings-theme-toggle"
                onClick={toggleTheme}
                aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '9px 16px',
                  borderRadius: '10px',
                  border: '1px solid var(--glass-border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-color)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--glass-border)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {isDarkMode ? <ICONS.Sun width={15} height={15} /> : <ICONS.Moon width={15} height={15} />}
                {isDarkMode ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>
          </section>

          {/* ── Account ── */}
          <section>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '14px', paddingBottom: '10px',
              borderBottom: '1px solid var(--glass-border)'
            }}>
              <span style={{ fontSize: '16px' }}>🔐</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
                Account
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="form-label" style={{ marginBottom: '2px' }}>Sign out</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  You will be returned to the login screen.
                </div>
              </div>
              <button
                id="settings-logout-btn"
                onClick={() => {
                  onClose?.();
                  // Dispatch a custom event for AppLayout to handle the actual signOut
                  window.dispatchEvent(new CustomEvent('ledgerai:logout'));
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '9px 16px',
                  borderRadius: '10px',
                  border: '1px solid rgba(166, 61, 64, 0.35)',
                  background: 'rgba(166, 61, 64, 0.08)',
                  color: '#F87171',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(166, 61, 64, 0.18)';
                  e.currentTarget.style.borderColor = '#F87171';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(166, 61, 64, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(166, 61, 64, 0.35)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <ICONS.Logout width={15} height={15} />
                Log out
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
};

export default Settings;
