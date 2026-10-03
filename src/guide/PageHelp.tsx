import { Link } from 'react-router'

export function PageHelp({ title, steps, anchor }: { title: string; steps: string[]; anchor: 'reserve' | 'admin' | 'driver-master' | 'vehicle-master' | 'driver' }) {
  return (
    <details className="page-help">
      <summary>{title}</summary>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <Link to={`/guide#${anchor}`}>詳しい使い方を見る</Link>
    </details>
  )
}
