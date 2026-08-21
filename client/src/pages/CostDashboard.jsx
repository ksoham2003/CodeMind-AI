import React, { useEffect, useState } from 'react';
import './IndexingPage.css';

export default function CostDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [cost, setCost] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [mRes, cRes] = await Promise.all([
          fetch('/api/debug/embeddings-metrics'),
          fetch('/api/debug/embeddings-cost'),
        ]);
        const mJson = await mRes.json();
        const cJson = await cRes.json();
        setMetrics(mJson.metrics || null);
        setCost(cJson || null);
      } catch (e) {
        console.error('Failed to fetch cost metrics', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <div className="page-container">Loading cost dashboard...</div>;

  return (
    <div className="page-container">
      <h2>Embedding Cost Dashboard</h2>
      <div style={{display: 'flex', gap: 24}}>
        <div style={{flex: 1}}>
          <h3>Metrics</h3>
          {metrics ? (
            <ul>
              <li><strong>requests:</strong> {metrics.requests}</li>
              <li><strong>cache_hits:</strong> {metrics.cache_hits}</li>
              <li><strong>cache_misses:</strong> {metrics.cache_misses}</li>
              <li><strong>errors:</strong> {metrics.errors}</li>
              <li><strong>batch_calls:</strong> {metrics.batch_calls}</li>
            </ul>
          ) : <div>No metrics available</div>}
        </div>
        <div style={{flex: 1}}>
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
