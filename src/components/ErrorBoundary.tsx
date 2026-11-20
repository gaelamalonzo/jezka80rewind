import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { firebaseConfig } from '../lib/firebase';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  isQuotaError: boolean;
  isPermissionError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
    isQuotaError: false,
    isPermissionError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    const msg = error.message || 'An unexpected error occurred.';
    const isQuotaError = msg.includes('Quota exceeded');
    const isPermissionError = msg.includes('Missing or insufficient permissions') || msg.includes('operationType');
    return {
      hasError: true,
      errorMessage: msg,
      isQuotaError,
      isPermissionError,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let parsedDetail: string | null = null;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && parsed.operationType) {
          parsedDetail = `${parsed.operationType.toUpperCase()} on ${parsed.path || 'database'} — ${parsed.error}`;
        }
      } catch {
        parsedDetail = this.state.errorMessage;
      }

      const upgradeUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-xl font-semibold text-slate-900">
                {this.state.isQuotaError
                  ? 'Firestore Daily Free Tier Quota Reached'
                  : this.state.isPermissionError
                    ? 'Access Permission Denied'
                    : 'Application Error'}
              </h1>
            </div>

            {this.state.isQuotaError ? (
              <div className="space-y-3 text-sm text-slate-600 mb-6">
                <p>
                  The Firebase Spark free tier daily read/write limit has been reached. Quotas reset automatically
                  the next day.
                </p>
                <a
                  href={upgradeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-sm font-medium text-[#1E40AF] underline"
                >
                  View Firestore Database Usage & Upgrade Options
                </a>
              </div>
            ) : (
              <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                {parsedDetail || this.state.errorMessage}
              </p>
            )}

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1D3A] text-white text-sm font-medium rounded-lg hover:bg-[#132B52] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
