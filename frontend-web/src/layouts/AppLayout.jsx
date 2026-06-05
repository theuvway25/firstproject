import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { signOut } from '../shared/authService';
import { useParsing } from '../context/ParsingContext';
import { useData } from '../context/DataContext';
import '../styles/Dashboard.css';

const AppLayout = ({ user, toggleTheme, isDarkMode }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const { latestFinishedDocId } = useParsing();
  const { refreshTransactions } = useData();

  // When a document finishes parsing, refresh the shared transaction list so
  // Transactions / Overview pages reflect the new data without a full reload.
  useEffect(() => {
    if (!latestFinishedDocId) return;
    refreshTransactions();
  }, [latestFinishedDocId]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleLogout = async () => {
    try {
      const { error } = await signOut();
      if (error) console.error('Error signing out:', error.message);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // Listen for logout requests dispatched from the Settings page
  useEffect(() => {
    const handler = () => handleLogout();
    window.addEventListener('ledgerai:logout', handler);
    return () => window.removeEventListener('ledgerai:logout', handler);
  }, []);

  return (
    <div className="dashboard-shell">
      <Sidebar
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
        user={user}
        toggleTheme={toggleTheme}
        isDarkMode={isDarkMode}
        onLogout={handleLogout}
      />
      <div className="dashboard-main">
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AppLayout;