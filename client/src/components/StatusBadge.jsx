import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';
import './StatusBadge.css';

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  icon: Clock,       color: 'yellow' },
  cloning:  { label: 'Cloning',  icon: Loader2,     color: 'blue',  spin: true },
  parsing:  { label: 'Parsing',  icon: Loader2,     color: 'blue',  spin: true },
  embedding:{ label: 'Embedding',icon: Loader2,     color: 'blue',  spin: true },
  indexing: { label: 'Indexing', icon: Loader2,     color: 'blue',  spin: true },
  ready:    { label: 'Ready',    icon: CheckCircle, color: 'green' },
  error:    { label: 'Error',    icon: AlertCircle, color: 'red'  },
};

export default function StatusBadge({ status, className = '' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <span className={`status-badge status-${config.color} ${className}`}>
      <Icon
        size={11}
        strokeWidth={2.5}
        className={config.spin ? 'spin-icon' : ''}
      />
      {config.label}
    </span>
  );
}
