import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AppLayout } from './components/layout/AppLayout.js';
import { OverviewPage } from './pages/Overview.js';
import { UploadCenterPage } from './pages/UploadCenter.js';
import { RulesFormPage } from './pages/RulesForm.js';
import { HolidaysPage } from './pages/Holidays.js';
import { ValidationPage } from './pages/ValidationPage.js';
import { GeneratePage } from './pages/GeneratePage.js';
import { ForecastPage } from './pages/ForecastPage.js';
import { ChangesPage } from './pages/ChangesPage.js';
import { AssistantPage } from './pages/AssistantPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { AllocationPage } from './pages/AllocationPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="uploads" element={<UploadCenterPage />} />
            <Route path="rules" element={<RulesFormPage />} />
            <Route path="holidays" element={<HolidaysPage />} />
            <Route path="validation" element={<ValidationPage />} />
            <Route path="forecast" element={<ForecastPage />} />
            <Route path="generate" element={<GeneratePage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            {/* Phase 3 routes */}
            <Route path="changes" element={<ChangesPage />} />
            <Route path="allocation" element={<AllocationPage />} />
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
            borderRadius: '8px',
            border: '1px solid #E3E8EF',
          },
        }}
      />
    </QueryClientProvider>
  );
};

export default App;
