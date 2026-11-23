# Analytics Integration Examples

This document shows how to integrate the analytics system into existing StellarFox components.

## 1. Bet Placement Tracking

### Current Code (markets.routes.ts)
```typescript
router.post('/api/bets', requireAuth, async (req: Request, res: Response) => {
  const { marketId, amount, side } = req.body;
  // ... place bet logic
  res.json({ betId });
});
```

### With Analytics Tracking
```typescript
import { analyticsService } from '../services/analytics.service';

router.post('/api/bets', requireAuth, async (req: Request, res: Response) => {
  const { marketId, amount, side } = req.body;
  const userId = req.userId;
  const sessionId = req.query.sessionId as string;

  try {
    // ... place bet logic
    const betId = result.id;

    // Track the conversion
    if (sessionId) {
      await analyticsService.trackCustomEvent({
        userId,
        eventCategory: 'conversion',
        eventLabel: 'bet_placed',
        eventValue: parseInt(amount),
        eventMetadata: {
          marketId,
          side,
          betId,
        },
        sessionId,
      });
    }

    res.json({ betId });
  } catch (error) {
    // Track error
    if (sessionId) {
      await analyticsService.trackCustomEvent({
        userId,
        eventCategory: 'error',
        eventLabel: 'bet_placement_failed',
        eventMetadata: {
          error: error.message,
          marketId,
        },
        sessionId,
      });
    }
    throw error;
  }
});
```

## 2. Form Submission Tracking

### Example: Login Form
```tsx
// frontend/src/components/LoginForm.tsx
import { useAnalytics } from '@/hooks/useAnalytics';
import { useState } from 'react';

export function LoginForm() {
  const { trackFormSubmission, trackError, trackConversion } = useAnalytics();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Track form submission
      trackFormSubmission('login_form', { email });

      // Send login request
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      // Track successful login (conversion)
      trackConversion('user_login', 0);

      // Redirect to dashboard
      window.location.href = '/dashboard';
    } catch (error) {
      trackError(
        'Login failed',
        error.stack,
        { email, component: 'LoginForm' }
      );
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <button type="submit">Login</button>
    </form>
  );
}
```

## 3. Account Creation Tracking

### Example: Signup Page
```tsx
// frontend/src/pages/signup.tsx
import { useAnalytics, useTrackPageView } from '@/hooks/useAnalytics';
import { useState } from 'react';

export default function SignupPage() {
  const { trackConversion, trackError, trackFormSubmission } = useAnalytics();
  
  useTrackPageView('signup_page');

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
  });

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      trackFormSubmission('signup_form', { email: formData.email });

      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Signup failed');
      }

      // Track account creation (conversion)
      trackConversion('account_created', 0);

      // Track referral if applicable
      const referralCode = new URLSearchParams(window.location.search).get('ref');
      if (referralCode) {
        trackConversion('referral_signup', 0);
      }
    } catch (error) {
      trackError(
        'Signup failed',
        error.stack,
        { email: formData.email }
      );
    }
  };

  return (
    <form onSubmit={handleSignup}>
      {/* Form fields */}
      <button type="submit">Create Account</button>
    </form>
  );
}
```

## 4. Page Engagement Tracking

### Example: Market Details Page
```tsx
// frontend/src/pages/markets/[id].tsx
import {
  useAnalytics,
  useTrackPageView,
  useTrackScrollDepth,
  useTrackTimeSpent,
} from '@/hooks/useAnalytics';
import { useRef } from 'react';
import { useTrackElementVisibility } from '@/hooks/useAnalytics';

export default function MarketDetailsPage() {
  const { trackEvent } = useAnalytics();
  
  // Track page view
  useTrackPageView('market-details');
  
  // Track scroll depth (automatically tracks 25%, 50%, 75%, 100%)
  useTrackScrollDepth();
  
  // Track time spent on page
  useTrackTimeSpent('market-details-time');

  const premiumRef = useRef<HTMLDivElement>(null);
  
  // Track when premium section comes into view
  useTrackElementVisibility(premiumRef, 'premium_section_viewed');

  const handleOutcomeClick = (outcome: string) => {
    trackEvent('interaction', 'outcome_clicked', {
      outcome,
      marketId: 123,
    });
  };

  return (
    <div>
      {/* Market details */}
      <div>Outcome A</div>
      <div>Outcome B</div>
      
      {/* Premium section - tracked when visible */}
      <div ref={premiumRef} className="premium-section">
        Premium features...
      </div>
    </div>
  );
}
```

## 5. Bet Claim Tracking

### Example: Claim Winnings
```tsx
// frontend/src/components/ClaimWinnings.tsx
import { useAnalytics } from '@/hooks/useAnalytics';
import { useMutation } from '@tanstack/react-query';

export function ClaimWinnings({ betId, amount }: { betId: number; amount: number }) {
  const { trackConversion, trackError } = useAnalytics();

  const claimMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/bets/${betId}/claim`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to claim');
      return response.json();
    },
    onSuccess: () => {
      // Track conversion - winnings claimed
      trackConversion('winnings_claimed', amount);
    },
    onError: (error) => {
      trackError(
        'Failed to claim winnings',
        error.stack,
        { betId, amount }
      );
    },
  });

  return (
    <button
      onClick={() => claimMutation.mutate()}
      disabled={claimMutation.isPending}
    >
      {claimMutation.isPending ? 'Claiming...' : `Claim ${amount} XLM`}
    </button>
  );
}
```

## 6. Error Tracking

### Example: Global Error Boundary
```tsx
// frontend/src/components/ErrorBoundary.tsx
import React from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Track error with analytics
    const analytics = useAnalytics(); // Note: Can't use hooks in class components
    
    // Alternative: Send directly via fetch
    fetch('/api/analytics/custom-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventCategory: 'error',
        eventLabel: 'react_error_boundary',
        eventMetadata: {
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
        },
      }),
    }).catch((e) => console.error('Failed to log error:', e));

    console.error('Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

## 7. Referral Tracking

### Example: Referral Link Click
```tsx
// frontend/src/components/ReferralLink.tsx
import { useAnalytics } from '@/hooks/useAnalytics';
import { useState } from 'react';

export function ReferralLink() {
  const { trackEvent, trackConversion } = useAnalytics();
  const [referralCode] = useState(() => generateReferralCode());

  const handleCopyLink = () => {
    const referralUrl = `${window.location.origin}/signup?ref=${referralCode}`;
    
    trackEvent('interaction', 'referral_link_copied', {
      referralCode,
    });

    navigator.clipboard.writeText(referralUrl);
  };

  const handleShareReferral = () => {
    trackEvent('interaction', 'referral_link_shared', {
      referralCode,
      via: 'share_button',
    });

    // Share logic...
  };

  return (
    <div>
      <button onClick={handleCopyLink}>Copy Referral Link</button>
      <button onClick={handleShareReferral}>Share</button>
    </div>
  );
}

// Track referral conversion (in signup page)
export function TrackReferralSignup() {
  const { trackConversion, trackEvent } = useAnalytics();

  React.useEffect(() => {
    const referralCode = new URLSearchParams(window.location.search).get('ref');
    
    if (referralCode) {
      trackConversion('referral_signup', 0);
      trackEvent('referral', 'new_signup_from_referral', {
        referralCode,
      });
    }
  }, []);

  return null;
}
```

## 8. Leaderboard View Tracking

### Example: Leaderboard Page
```tsx
// frontend/src/pages/leaderboard.tsx
import {
  useAnalytics,
  useTrackPageView,
  useTrackElementVisibility,
} from '@/hooks/useAnalytics';
import { useRef } from 'react';

export default function LeaderboardPage() {
  useTrackPageView('leaderboard');
  
  const { trackEvent } = useAnalytics();
  
  const globalRef = useRef<HTMLDivElement>(null);
  const streaksRef = useRef<HTMLDivElement>(null);

  // Track when sections come into view
  useTrackElementVisibility(globalRef, 'leaderboard_global_viewed');
  useTrackElementVisibility(streaksRef, 'leaderboard_streaks_viewed');

  const handleFilterChange = (filter: string) => {
    trackEvent('interaction', 'leaderboard_filter_changed', {
      filter,
    });
  };

  const handleUserClick = (userId: string) => {
    trackEvent('interaction', 'leaderboard_user_clicked', {
      userId,
    });
  };

  return (
    <div>
      <div ref={globalRef}>
        <h2>Global Rankings</h2>
        {/* Leaderboard content */}
      </div>
      
      <div ref={streaksRef}>
        <h2>Streaks</h2>
        {/* Streaks content */}
      </div>
    </div>
  );
}
```

## 9. Market Search Tracking

### Example: Market Search
```tsx
// frontend/src/components/MarketSearch.tsx
import { useAnalytics } from '@/hooks/useAnalytics';
import { useState, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';

export function MarketSearch() {
  const { trackEvent } = useAnalytics();
  const [searchQuery, setSearchQuery] = useState('');

  const trackSearch = useDebouncedCallback((query: string) => {
    if (query.length >= 2) {
      trackEvent('interaction', 'market_search', {
        query,
        length: query.length,
      });
    }
  }, 500);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    trackSearch(query);
  };

  const handleSearchResult = (marketId: string) => {
    trackEvent('interaction', 'search_result_clicked', {
      marketId,
      query: searchQuery,
    });
  };

  return (
    <div>
      <input
        type="text"
        value={searchQuery}
        onChange={handleSearchChange}
        placeholder="Search markets..."
      />
      {/* Search results */}
    </div>
  );
}
```

## 10. Portfolio View Tracking

### Example: Portfolio Page
```tsx
// frontend/src/pages/portfolio.tsx
import {
  useAnalytics,
  useTrackPageView,
  useTrackTimeSpent,
} from '@/hooks/useAnalytics';

export default function PortfolioPage() {
  useTrackPageView('portfolio');
  useTrackTimeSpent('portfolio-view');

  const { trackEvent } = useAnalytics();

  const handleViewBet = (betId: number) => {
    trackEvent('interaction', 'portfolio_bet_clicked', { betId });
  };

  const handleExportPortfolio = () => {
    trackEvent('interaction', 'portfolio_exported', {
      format: 'csv',
    });
  };

  return (
    <div>
      {/* Portfolio content */}
      <button onClick={handleExportPortfolio}>Export CSV</button>
    </div>
  );
}
```

## 11. Backend Event Logging

### Example: Market Creation Event
```typescript
// backend/src/routes/marketGroup3.routes.ts
import { analyticsService } from '../services/analytics.service';

router.post('/api/markets', requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId;
  const { fighters, eventDate } = req.body;

  try {
    // Create market...
    const marketId = result.market_id;

    // Track market creation
    await analyticsService.trackCustomEvent({
      userId,
      eventCategory: 'market_creation',
      eventLabel: 'market_created',
      eventMetadata: {
        marketId,
        fighters,
        eventDate,
      },
    });

    res.json({ marketId });
  } catch (error) {
    // Track error
    await analyticsService.trackCustomEvent({
      userId,
      eventCategory: 'error',
      eventLabel: 'market_creation_failed',
      eventMetadata: {
        error: error.message,
        fighters,
      },
    });
    throw error;
  }
});
```

## 12. Wallet Transaction Tracking

### Example: Deposit Tracking
```tsx
// frontend/src/components/DepositForm.tsx
import { useAnalytics } from '@/hooks/useAnalytics';
import { useState } from 'react';

export function DepositForm() {
  const { trackConversion, trackError, trackFormSubmission } = useAnalytics();
  const [amount, setAmount] = useState('');

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      trackFormSubmission('deposit_form', { amount: parseFloat(amount) });

      const response = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(amount) }),
      });

      if (!response.ok) throw new Error('Deposit failed');

      // Track deposit conversion
      trackConversion('deposit_completed', parseFloat(amount));
    } catch (error) {
      trackError('Deposit failed', error.stack, {
        amount: parseFloat(amount),
      });
    }
  };

  return (
    <form onSubmit={handleDeposit}>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount"
      />
      <button type="submit">Deposit</button>
    </form>
  );
}
```

## Integration Checklist

- [ ] Register analytics routes in backend `index.ts`
- [ ] Run database migration
- [ ] Wrap app with `AnalyticsProvider`
- [ ] Track page views on main pages
- [ ] Track key conversions (bets, deposits, signups)
- [ ] Track form submissions
- [ ] Track errors
- [ ] Add scroll depth tracking to long pages
- [ ] Track time spent on important pages
- [ ] Monitor analytics dashboard
- [ ] Set up alerts for key metrics

## Testing Analytics

### Test Event Tracking
```bash
curl -X POST http://localhost:3001/api/analytics/event \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-id",
    "eventType": "test",
    "eventName": "test_event",
    "eventData": {"test": true}
  }'
```

### Test Custom Event
```bash
curl -X POST http://localhost:3001/api/analytics/custom-event \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventCategory": "test",
    "eventLabel": "test_event",
    "eventValue": 100
  }'
```

### Query Analytics Data
```bash
# Get page analytics
curl http://localhost:3001/api/analytics/page/markets?startDate=2024-01-01&endDate=2024-01-31

# Get trending pages
curl http://localhost:3001/api/analytics/trending?limit=5

# Get custom events
curl "http://localhost:3001/api/analytics/custom-events?eventCategory=conversion&startDate=2024-01-01&endDate=2024-01-31"
```

## Next Steps

1. Implement tracking in your key pages and features
2. Set up dashboards to visualize analytics
3. Use insights to optimize user experience
4. Monitor conversion funnels
5. Track user cohorts and segments
6. Analyze heatmaps to improve UI/UX
