import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import BaselineReview from './BaselineReview';
import PlatformProfiles from './PlatformProfiles';
import YaraXRuntime from './YaraXRuntime';
import YaraContent from './YaraContent';
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

const standalone = window.location.pathname;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {standalone === '/baselines' ? <BaselineReview /> : standalone === '/platform-profiles' ? <PlatformProfiles /> : standalone === '/yarax-runtime' ? <YaraXRuntime /> : standalone === '/yarax-content' ? <YaraContent /> : <BrowserRouter><App /></BrowserRouter>}
    </QueryClientProvider>
  </React.StrictMode>
);
