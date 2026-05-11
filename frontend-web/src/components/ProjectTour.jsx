import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react';

const TOUR_STEPS = [
  // --- OVERVIEW PAGE ---
  {
    path: '/',
    title: 'Financial Dashboard',
    content: '👋 Welcome to LedgerAI! This is your central hub for all financial data.',
    selector: '#overview-title',
    position: 'bottom'
  },
  {
    path: '/',
    title: 'Global Filters',
    content: 'Narrow down your view by selecting specific accounts or change the time period here.',
    selector: '#overview-account-filter',
    position: 'bottom'
  },
  {
    path: '/',
    title: 'Pulse of your Business',
    content: 'Track Income, Expenses, and your current Journal Balance at a glance.',
    selector: '#overview-summary-cards',
    position: 'bottom'
  },
  {
    path: '/',
    title: 'Growth Trends',
    content: 'Monitor your monthly income vs. expense flow over time with this interactive chart.',
    selector: '#overview-trend-chart',
    position: 'top'
  },

  // --- ACCOUNTS PAGE ---
  {
    path: '/accounts',
    title: 'Chart of Accounts',
    content: 'This page defines your ledger structure—where money comes from and where it goes.',
    selector: '#accounts-title',
    position: 'bottom'
  },
  {
    path: '/accounts',
    title: 'Link New Source',
    content: 'Click here to add a new Bank, Credit Card, or Wallet account to your system.',
    selector: '#accounts-add-btn',
    position: 'bottom'
  },
  {
    path: '/accounts',
    title: 'Account Hierarchy',
    content: 'Accounts are grouped into Assets, Liabilities, and Equity to follow standard accounting practices.',
    selector: '#accounts-grid',
    position: 'top'
  },

  // --- PARSING PAGE ---
  {
    path: '/parsing',
    title: 'Data Extraction',
    content: 'Bring your data into the system by uploading bank statements.',
    selector: '#parsing-title',
    position: 'bottom'
  },
  {
    path: '/parsing',
    title: 'Interactive Upload',
    content: 'Drop your bank statement PDF here. The system will automatically identify the format and prepare the transactions for your review.',
    selector: '#parsing-dropzone',
    position: 'bottom'
  },
  {
    path: '/parsing',
    title: 'Document History',
    content: 'Track the status of every upload. You can review and delete processed documents here.',
    selector: '#parsing-history',
    position: 'top'
  },

  {
    path: '/review',
    title: 'Review Transactions',
    content: 'This is your verification hub. Once a statement is processed, transaction data will appear here for you to verify, edit, and categorize before it hits your official ledger.',
    selector: '#review-title',
    position: 'bottom'
  },
  {
    path: '/review',
    title: 'Account Binding',
    content: 'Link these specific extracted rows to one of your pre-defined chart of accounts to ensure proper books.',
    selector: '#review-link-account',
    position: 'bottom'
  },
  {
    path: '/review',
    title: 'Human-in-the-loop',
    content: 'You have full control. Edit amounts, dates, or details directly in these tables to fix any extraction errors.',
    selector: '#review-table',
    position: 'top'
  },
  {
    path: '/review',
    title: 'Post to Journal',
    content: 'Once you are satisfied with the data, hit Approve to officially post these transactions into your accounts.',
    selector: '#review-header-actions',
    position: 'bottom'
  },

  // --- TRANSACTIONS PAGE ---
  {
    path: '/transactions',
    title: 'The Journal',
    content: 'This master ledger consolidates every transaction into a single, searchable view.',
    selector: '#transactions-title',
    position: 'bottom'
  },
  {
    path: '/transactions',
    title: 'Comprehensive View',
    content: 'The "All" tab provides a complete view of your entire financial history across all linked sources.',
    selector: '#transactions-tab-all',
    position: 'bottom'
  },
  {
    path: '/transactions',
    title: 'Needs Categorization',
    content: 'These entries haven\'t been assigned to an account yet. You can manually assign them or let the AI help.',
    selector: '#transactions-tab-pending-cat',
    position: 'bottom'
  },
  {
    path: '/transactions',
    title: 'Awaiting Sign-off',
    content: 'Transactions here are ready to be finalized. Review them one last time before approving them for the books.',
    selector: '#transactions-tab-pending-app',
    position: 'bottom'
  },
  {
    path: '/transactions',
    title: 'Direct Entry',
    content: 'Click Upload to manually add a transaction or import an existing ledger record directly.',
    selector: '#transactions-upload-btn',
    position: 'bottom'
  },
  {
    path: '/transactions',
    title: 'Smart Categorization',
    content: 'Automatically categorize your pending entries using our pattern-recognition engine to save time.',
    selector: '#transactions-categorize-btn',
    position: 'bottom'
  },

  // --- ANALYTICS PAGE ---
  {
    path: '/analytics',
    title: 'Visual Insights',
    content: 'Track growth and profit trends with auto-generated charts based on your linked ledger.',
    selector: '#analytics-view-tabs',
    position: 'bottom'
  },
  {
    path: '/',
    title: 'You\'re All Set!',
    content: 'You’ve reached the end of the tour. Need help? Re-start this guide anytime from the footer.',
    selector: '#nav-overview', 
    position: 'right'
  }
];

export default function ProjectTour({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [tipPos, setTipPos] = useState('bottom');
  const navigate = useNavigate();
  const location = useLocation();

  const updatePosition = useCallback(() => {
    const step = TOUR_STEPS[currentStep];
    const element = document.querySelector(step.selector);

    if (element) {
      // Auto-scroll to the element if it's not visible
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      const rect = element.getBoundingClientRect();
      setTargetRect(rect);

      const vH = window.innerHeight;
      const vW = window.innerWidth;
      const W = 340; // Tooltip width
      const H = 200; // Estimated height

      let top = 0, left = 0, pos = step.position;

      // Position logic
      if (pos === 'bottom') {
        top = rect.bottom + 12;
        left = rect.left + rect.width / 2 - W / 2;
        if (top + H > vH) { pos = 'top'; top = rect.top - H - 12; }
      } else if (pos === 'top') {
        top = rect.top - H - 12;
        left = rect.left + rect.width / 2 - W / 2;
        if (top < 0) { pos = 'bottom'; top = rect.bottom + 12; }
      } else if (pos === 'right') {
        top = rect.top + rect.height / 2 - H / 2;
        left = rect.left + rect.width + 12;
        if (left + W > vW) { pos = 'left'; left = rect.left - W - 12; }
      } else if (pos === 'left') {
        top = rect.top + rect.height / 2 - H / 2;
        left = rect.left - W - 12;
        if (left < 0) { pos = 'right'; left = rect.left + rect.width + 12; }
      }

      // Viewport Clamping
      top = Math.max(20, Math.min(top, vH - H - 20));
      left = Math.max(20, Math.min(left, vW - W - 20));

      setCoords({ top, left });
      setTipPos(pos);
    } else {
      // Fallback: Center of screen
      setTargetRect(null);
      setCoords({ top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - 170 });
      setTipPos('center');
    }
  }, [currentStep]);

  useEffect(() => {
    if (!isOpen) return;
    
    const step = TOUR_STEPS[currentStep];
    if (step.path !== location.pathname) {
      if (step.path === '/review' && location.pathname !== '/review') {
          // If we navigate to review without an ID, it shows empty state, which is fine
          navigate(step.path);
      } else {
          navigate(step.path);
      }
      // Wait for navigation and potential data loading
      const timer = setTimeout(updatePosition, 1000);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(updatePosition, 300);
      return () => clearTimeout(timer);
    }
  }, [currentStep, isOpen, location.pathname, navigate, updatePosition]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [isOpen, updatePosition]);

  const handleNext = () => {
    let nextIdx = currentStep + 1;
    
    // Scan ahead for the next valid step.
    // We skip steps where the selector is missing on the CURRENT page.
    // But we DON'T skip steps that require a page change (different path).
    while (nextIdx < TOUR_STEPS.length - 1) {
      const nextStep = TOUR_STEPS[nextIdx];
      if (nextStep.path === location.pathname) {
        if (!document.querySelector(nextStep.selector)) {
          nextIdx++;
          continue;
        }
      }
      break;
    }

    if (nextIdx < TOUR_STEPS.length) setCurrentStep(nextIdx);
    else finishTour();
  };

  const handlePrev = () => {
    let prevIdx = currentStep - 1;
    
    while (prevIdx > 0) {
      const prevStep = TOUR_STEPS[prevIdx];
      if (prevStep.path === location.pathname) {
        if (!document.querySelector(prevStep.selector)) {
          prevIdx--;
          continue;
        }
      }
      break;
    }
    
    if (prevIdx >= 0) setCurrentStep(prevIdx);
  };


  const finishTour = () => {
    localStorage.setItem('ledgerai_tour_completed', 'true');
    onClose();
  };

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];
  const progressPercent = ((currentStep + 1) / TOUR_STEPS.length) * 100;

  // Render navigation logic in our buttons


  return (
    <AnimatePresence>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999999, pointerEvents: 'none' }}>
        {/* Semi-transparent Dimming Effect - Using a very subtle overlay */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)', pointerEvents: 'auto' }} 
          onClick={onClose}
        />
        
        {/* Spotlight Effect - Subtle highlights */}
        {targetRect && (
          <motion.div
            initial={false}
            animate={{ 
              top: targetRect.top - 4, 
              left: targetRect.left - 4, 
              width: targetRect.width + 8, 
              height: targetRect.height + 8 
            }}
            style={{ 
              position: 'absolute', 
              borderRadius: '8px', 
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)', 
              border: '2px solid rgba(107, 114, 128, 0.4)',
              zIndex: 1000000, 
              pointerEvents: 'none'
            }}
          />
        )}

        {/* The Clean White Tooltip (GitHub Style) */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, scale: 0.95, y: 5 }}
          animate={{ opacity: 1, scale: 1, y: 0, top: coords.top, left: coords.left }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={{
            position: 'absolute', 
            width: '340px', 
            background: '#FFFFFF',
            border: '1px solid #d1d5da',
            color: '#24292e',
            padding: '20px 24px', 
            borderRadius: '6px', 
            boxShadow: '0 8px 24px rgba(149,157,165,0.2)',
            zIndex: 1000001, 
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {/* Tooltip Arrow */}
          {targetRect && tipPos !== 'center' && (
            <div style={{
              position: 'absolute', width: '12px', height: '12px', background: '#FFFFFF',
              borderLeft: '1px solid #d1d5da', borderTop: '1px solid #d1d5da',
              top: tipPos === 'bottom' ? '-7px' : tipPos === 'top' ? 'auto' : 'calc(50% - 6px)',
              bottom: tipPos === 'top' ? '-7px' : 'auto',
              left: tipPos === 'right' ? '-7px' : tipPos === 'left' ? 'auto' : 'calc(50% - 6px)',
              right: tipPos === 'left' ? '-7px' : 'auto',
              transform: tipPos === 'bottom' ? 'rotate(45deg)' : 
                         tipPos === 'top' ? 'rotate(225deg)' : 
                         tipPos === 'right' ? 'rotate(315deg)' : 'rotate(135deg)',
              zIndex: 1
            }} />
          )}

          {/* Close Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={14} style={{ color: '#6a737d' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#6a737d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Guided Onboarding</span>
            </div>
            <button 
              onClick={onClose} 
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6a737d', opacity: 0.6, padding: 0 }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ marginTop: '0' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 6px 0', color: '#24292e' }}>{step.title}</h3>
            <p style={{ fontSize: '14px', lineHeight: 1.5, margin: 0, color: '#586069' }}>{step.content}</p>
          </div>

          {/* Navigation Controls */}
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#6a737d' }}>{currentStep + 1} of {TOUR_STEPS.length}</span>
                <div style={{ width: '60px', height: '4px', background: '#eaecef', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${progressPercent}%`, height: '100%', background: '#0366d6', borderRadius: '2px' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                {currentStep > 0 && (
                  <button 
                    onClick={handlePrev}
                    style={{ 
                      background: '#fafbfc', border: '1px solid #d1d5da', color: '#24292e', 
                      padding: '5px 12px', borderRadius: '6px', cursor: 'pointer',
                      fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px'
                    }}
                  >
                    Back
                  </button>
                )}
                
                <button 
                  onClick={handleNext}
                  style={{ 
                    background: '#fafbfc', border: '1px solid #d1d5da', color: '#0366d6', 
                    padding: '5px 16px', borderRadius: '6px', cursor: 'pointer',
                    fontSize: '12px', fontWeight: 600,
                    boxShadow: '0 1px 0 rgba(27,31,35,.04)'
                  }}
                >
                  {currentStep === TOUR_STEPS.length - 1 ? 'Got it' : 'Next'}
                </button>
              </div>
            </div>
            
            {currentStep < TOUR_STEPS.length - 1 && (
               <button 
                onClick={finishTour}
                style={{ 
                  background: 'none', border: 'none', color: '#6a737d', 
                  fontSize: '12px', cursor: 'pointer', padding: 0, textAlign: 'left',
                  textDecoration: 'underline', width: 'fit-content', opacity: 0.8
                }}
              >
                Skip tour
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
