import React, { useEffect, useState, useMemo } from 'react';
import './IndexingPage.css';

function Sparkline({ values = [], width = 400, height = 80 }) {
  const path = useMemo(() => {
    if (!values || values.length === 0) return '';
    const mx = Math.max(...values);
    const mn = Math.min(...values);
    const range = mx === mn ? 1 : mx - mn;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1 || 1)) * width;
        const y = height - ((v - mn) / range) * height;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }, [values, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function CostDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [cost, setCost] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [mRes, cRes, hRes] = await Promise.all([
        fetch('/api/debug/embeddings-metrics'),
        fetch('/api/debug/embeddings-cost'),
        fetch('/api/debug/embeddings-metrics/history?limit=200'),
      ]);
      const mJson = await mRes.json();
      const cJson = await cRes.json();
      const hJson = await hRes.json();
      setMetrics(mJson.metrics || null);
      setCost(cJson || null);
      setHistory((hJson.rows || []).map(r => ({ ts: r.ts, requests: Number(r.requests || 0) })));
    } catch (e) {
      console.error('Failed to fetch cost metrics', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return <div className="page-container">Loading cost dashboard...</div>;

  const sparkValues = history.slice().reverse().map(h => h.requests || 0);

  return (
    <div className="page-container">
      <h2>Embedding Cost Dashboard</h2>
      {!cost || cost.costPer1kUSD === null ? (
        <div style={{background: '#fff7ed', border: '1px solid #ffd7a3', padding: 12, borderRadius: 6, marginBottom: 12}}>
          <strong>Note:</strong> Embedding cost per 1k is not configured. To enable estimated USD, set <code>EMBEDDING_COST_PER_1K_USD</code> in the server environment and restart the server.
        </div>
      ) : null}
      <div style={{display: 'flex', gap: 24}}>
        <div style={{flex: 1}}>
          <h3>Request Trend</h3>
          {sparkValues.length > 1 ? (
            <Sparkline values={sparkValues} width={500} height={100} />
          ) : (
            <div>No historical data (try taking snapshots or enable snapshotter)</div>
          )}
          <div style={{marginTop: 12}}>
            <button onClick={fetchData}>Refresh</button>
          </div>
        </div>

        <div style={{flex: 1}}>
          <h3>Current Metrics</h3>
          {metrics ? (
            <ul>
              <li><strong>requests:</strong> {metrics.requests}</li>
              <li><strong>cache_hits:</strong> {metrics.cache_hits}</li>
              <li><strong>cache_misses:</strong> {metrics.cache_misses}</li>
              <li><strong>errors:</strong> {metrics.errors}</li>
              <li><strong>batch_calls:</strong> {metrics.batch_calls}</li>
            </ul>
          ) : <div>No metrics available</div>}

          <h3>Estimated Cost</h3>
          {cost ? (
            <div>
              <div><strong>Cost per 1k USD:</strong> {cost.costPer1kUSD ?? 'not configured'}</div>
              <div><strong>Estimated USD:</strong> {cost.estimatedCostUsd ?? 'N/A'}</div>
            </div>
          ) : <div>No cost data</div>}
        </div>
      </div>
    </div>
  );
}
