import { Link } from 'react-router'

const statuses = [
  ['受付', '依頼を受け付け、内容や日程の確認を待っている状態です。'],
  ['確定', '予約内容と日程が確定した状態です。配車対象の予約は、この後に配車を登録します。'],
  ['未配車', '予約は確定していますが、車両と主担当ドライバーが未登録です。'],
  ['配車済み', '予定日時、車両、主担当ドライバーが登録されています。'],
  ['回収中', '任意の回収開始が記録されています。'],
  ['要再確認', '配車を登録した後に予約内容が変わり、現在の配車のままでよいか管理者が確認する状態です。'],
  ['要再配車・要対応', '一部回収または回収不可の結果を受け、次の判断が必要です。'],
] as const

export function GuidePage() {
  return (
    <div className="page guide-page">
      <header className="page-intro"><span className="eyebrow">Demo Guide</span><h1>使い方ガイド</h1><p>予約申込みからドライバー・車両登録、配車、回収結果までを確認するための短い案内です。</p></header>
      <section className="guide-overview" aria-labelledby="guide-overview-title"><div><span>おすすめ</span><h2 id="guide-overview-title">デモの確認順序</h2></div><ol><li><Link to="/reserve">利用者画面</Link>で予約を申し込む</li><li><Link to="/admin">予約・配車管理</Link>で予約を確定する</li><li>必要に応じて架空の車両と主担当ドライバーを登録する</li><li>確定した予約へ車両と主担当ドライバーを配車する</li><li><Link to="/driver">ドライバー画面</Link>で担当予定と現場情報を確認する</li><li>作業結果を登録し、予約の完了または次の対応を確認する</li></ol></section>
      <div className="guide-sections">
        <section id="reserve"><span className="guide-number">01</span><h2>利用者画面</h2><ol><li>回収カテゴリーを選びます。</li><li>希望日と依頼内容を入力します。</li><li>確認画面から申し込みます。</li></ol><p>実在する会社名、氏名、住所、電話番号は入力しないでください。</p><Link to="/reserve">利用者画面を開く</Link></section>
        <section id="admin"><span className="guide-number">02</span><h2>予約・配車管理</h2><ol><li>予約一覧から対象予約を開きます。</li><li>受付状態の予約を確定します。</li><li>「配車を登録する」から予定、車両、主担当ドライバーを登録します。</li><li>予約の数量を変えるときは、「おおよその本数」「品目と数量」「種類とおおよその数量」の該当欄を書き換えます。</li><li>登録後は「配車を変更する」から配車内容を修正できます。</li></ol><p>車両や担当者を選んでいない場合や、同じ時間帯の別案件ですでに使用されている場合は、赤い文章で登録できない理由が表示されます。使用中の選択肢には対象の受付番号と時間も表示されます。</p><p>配車を登録する前の予約変更は、これから組む配車に使う最新内容として保存されるため、橙色の注意書きは出ません。</p><p>配車を登録した後に希望日、回収先、依頼内容、連絡事項を変更すると、現在の配車のままでよいか確認するため、橙色の注意書きと「要再確認」が表示されます。</p><p>数量変更を「連絡事項」に書いても数量欄は変わりません。数量は上記の専用欄へ、依頼者からの補足だけを「連絡事項」へ入力します。</p><Link to="/admin">予約・配車管理を開く</Link></section>
        <section id="driver-master"><span className="guide-number">03</span><h2>ドライバー管理</h2><ol><li>管理者デモを開始します。</li><li>予約・配車管理の「ドライバー管理」を開きます。</li><li>氏名と必要な備考を入力します。コードは自動採番されます。</li><li>編集、または有効・無効を切り替えます。</li></ol><p>未完了の配車がある担当者は、先に配車変更または取消が必要です。</p><Link to="/admin/drivers">ドライバー管理を開く</Link></section>
        <section id="vehicle-master"><span className="guide-number">04</span><h2>車両管理</h2><ol><li>管理者デモを開始します。</li><li>予約・配車管理の「車両管理」を開きます。</li><li>架空の車両ナンバーと車種を入力します。コードは自動採番されます。</li><li>編集、または有効・無効を切り替えます。</li></ol><p>未完了の配車や車両保留がある車両は、先に配車変更・取消または保留解除が必要です。</p><Link to="/admin/vehicles">車両管理を開く</Link></section>
        <section id="driver"><span className="guide-number">05</span><h2>ドライバー画面</h2><ol><li>架空ドライバーを選びます。</li><li>今日、明日、今後7日、または任意期間を選びます。</li><li>日付別の担当案件から詳細を開きます。</li><li>「担当変更のお知らせ」がある場合は、現在自分が担当か、担当から外れたかを確認します。</li><li>必要に応じて回収開始または作業結果を登録します。</li></ol><p>担当から外れた案件は通常予定には残りません。「担当変更を確認しました」を押した後も、担当変更履歴から確認できます。担当へ戻った案件には「再担当」「要確認」を表示し、誰から担当が移ったかを最新の復帰履歴で確認できます。何度変更されても、確認が必要な通知は案件ごとの最新状態だけです。</p><p>回収開始の記録は任意です。将来の予定は配車変更により更新される場合があります。</p><Link to="/driver">ドライバー画面を開く</Link></section>
      </div>
      <section className="guide-statuses"><h2>主な状態表示</h2><dl>{statuses.map(([label, description]) => <div key={label}><dt>{label}</dt><dd>{description}</dd></div>)}</dl></section>
      <section className="guide-note" role="note"><strong>公開デモについて</strong><p>入力内容はこのブラウザ内だけに保存され、本番の認証や社内共有を再現するものではありません。管理画面から初期状態へ戻せます。</p></section>
    </div>
  )
}
