import { Link, NavLink, Route, Routes } from 'react-router'
import './App.css'
import { ReservePage } from './reserve/ReservePage'
import { AdminPage } from './admin/AdminPage'
import { DriverPage } from './driver/DriverPage'

const navItems = [
  { to: '/', label: 'デモ入口', end: true },
  { to: '/reserve', label: '利用者画面' },
  { to: '/admin', label: '予約・配車管理' },
  { to: '/driver', label: 'ドライバー画面' },
]

function AppShell() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="予約管理デモ ホーム">
          <span className="brand-mark" aria-hidden="true">予</span>
          <span><strong>予約管理デモ</strong><small>公開デモ版</small></span>
        </Link>
        <nav aria-label="メインメニュー">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main>
        <Routes>
          <Route index element={<EntryPage />} />
          <Route path="reserve" element={<ReservePage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="driver" element={<DriverPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer>
        <p>架空データだけを使用するポートフォリオ用デモです。</p>
        <p>デモデータはこのブラウザ内に保存されます。最後にデモ画面を開いてから7日を超えると、次回の利用時に初期状態へ戻ります。</p>
        <p>本番の認証機能はなく、異なるブラウザや端末とはデータを共有しません。</p>
      </footer>
    </div>
  )
}

function EntryPage() {
  return (
    <div className="page entry-page">
      <section className="hero-panel">
        <span className="eyebrow">Reservation Management Demo</span>
        <h1>予約から回収までを、<br />ひとつのデモで。</h1>
        <p className="lead">申込み、予約・配車管理、ドライバーの流れを、同じブラウザ内の架空データで確認できる業務ツールです。</p>
        <div className="notice" role="note">
          <strong>公開デモ版</strong>
          <span>実在する会社名・氏名・住所・電話番号は入力しないでください。</span>
        </div>
        <p className="storage-note">入力・操作したデータは、このブラウザの中だけに保存されます。</p>
      </section>

      <section className="route-grid" aria-label="デモ画面を選択">
        <RouteCard index="01 / Ver1" title="予約を申し込む" description="カテゴリーと希望日を選び、利用者として予約の申込みを試します。" to="/reserve" action="利用者画面へ" tone="green" />
        <RouteCard index="02 / Ver2" title="予約・配車を管理する" description="予約一覧から配車状況と回収状況を確認する管理画面です。" to="/admin" action="予約・配車管理へ" tone="blue" />
        <RouteCard index="03 / Ver2" title="本日の担当を確認する" description="架空ドライバーを選び、担当案件と現場向け情報を確認します。" to="/driver" action="ドライバー画面へ" tone="orange" />
      </section>
    </div>
  )
}

type RouteCardProps = {
  index: string
  title: string
  description: string
  to: string
  action: string
  tone: 'green' | 'blue' | 'orange'
}

function RouteCard({ index, title, description, to, action, tone }: RouteCardProps) {
  return (
    <article className={`route-card ${tone}`}>
      <span className="card-index">{index}</span>
      <div><h2>{title}</h2><p>{description}</p></div>
      <Link className="primary-link" to={to}>{action}<span aria-hidden="true">→</span></Link>
    </article>
  )
}

type PageIntroProps = { eyebrow: string; title: string; description: string }

function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return <header className="page-intro"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>
}

function NotFoundPage() {
  return (
    <div className="page placeholder-page">
      <PageIntro eyebrow="404" title="ページが見つかりません" description="URLを確認するか、デモ入口へ戻ってください。" />
      <Link className="primary-link compact" to="/">デモ入口へ</Link>
    </div>
  )
}

export default AppShell
