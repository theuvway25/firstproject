import React from 'react';
import { ICONS } from '../Icons';
import { useAuth } from '../../shared/hooks/useAuth';
import '../../styles/Settings.css';

const Settings = ({ toggleTheme, isDarkMode }) => {
  const { user } = useAuth();
  const email = user?.email || '—';

  return (
    <div className="settings-container">
      <div className="page-header">
        <div className="header-title">
          <h1>Settings</h1>
          <p>Manage your account and app preferences.</p>
        </div>
      </div>

      <div className="settings-content">
        {/* ── Account Information ── */}
        <div className="settings-card">
          <div className="card-header">
            <h2>Account Informations</h2>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <div className="row-info">
                <h3>Email address</h3>
              </div>
              <div className="static-value-text">{email}</div>
            </div>
          </div>
        </div>

        {/* ── Security Settings ── */}
        <div className="settings-card">
          <div className="card-header">
            <h2>Security Settings</h2>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <div className="row-info">
                <h3>Google Authenticator (2FA)</h3>
                <p>Use the Authenticator to get verification codes for better security.</p>
              </div>
              <label className="switch">
                <input type="checkbox" defaultChecked />
                <span className="slider round"></span>
              </label>
            </div>
            
            <div className="settings-row" style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--glass-border)' }}>
              <div className="row-info">
                <h3>Password</h3>
                <p>Last Changed {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <button className="theme-toggle-btn">Set password</button>
            </div>
          </div>
        </div>

        {/* ── Appearance ── */}
        <div className="settings-card">
          <div className="card-header">
            <h2>Appearance</h2>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <div className="row-info">
                <h3>Theme</h3>
                <p>{isDarkMode ? 'Dark mode is currently active' : 'Light mode is currently active'}</p>
              </div>
              <button 
                className="theme-toggle-btn" 
                onClick={toggleTheme}
              >
                {isDarkMode ? <ICONS.Sun /> : <ICONS.Moon />}
                {isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Account ── */}
        <div className="settings-card">
          <div className="card-header">
            <h2>Account</h2>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <div className="row-info">
                <h3>Sign out</h3>
                <p>You will be returned to the login screen. Your session will be cleared.</p>
              </div>
              <button 
                className="logout-action-btn"
                onClick={() => window.dispatchEvent(new CustomEvent('ledgerai:logout'))}
              >
                <ICONS.Logout />
                Log out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
