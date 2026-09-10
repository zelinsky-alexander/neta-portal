import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import BaselineReview from './BaselineReview';
import './styles.css';
import './auth.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false
    }
  }
});

const baselineReview = window.location.pathname === '/baselines';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {baselineReview ? <BaselineReview /> : <BrowserRouter><App /></BrowserRouter>}
    </QueryClientProvider>
  </React.StrictMode>
);
