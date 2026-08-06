import './SuggestedQuestions.css';

const QUESTIONS = [
  'Where is authentication implemented?',
  'How are routes defined?',
  'Explain the database connection',
  'Where is JWT used?',
  'How is middleware structured?',
  'Explain the main entry point',
  'What APIs are exposed?',
  'Find all exported functions',
];

export default function SuggestedQuestions({ onSelect }) {
  return (
    <div className="suggested-wrap">
      <p className="suggested-label">Try asking:</p>
      <div className="suggested-grid">
        {QUESTIONS.map((q, i) => (
          <button
            key={q}
            className={`suggested-item animate-fade-up delay-${Math.min(i + 1, 5)}`}
            onClick={() => onSelect(q)}
            aria-label={`Ask: ${q}`}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
