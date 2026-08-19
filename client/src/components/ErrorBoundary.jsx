import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
    // You could also send this to a logging service
    // console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, info } = this.state;

    return (
      <div style={{ padding: 24, fontFamily: 'Inter, Arial, sans-serif' }}>
        <h2 style={{ color: '#c53030' }}>Something went wrong</h2>
        {error && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-wrap', color: '#333' }}>
            <strong>Error:</strong>
            <div>{String(error && error.message)}</div>
          </div>
        )}
        {info && info.componentStack && (
          <details style={{ marginTop: 12 }}>
            <summary>Component stack</summary>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{info.componentStack}</pre>
          </details>
        )}
        <div style={{ marginTop: 16 }}>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
