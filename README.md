# 予約管理ツール 公開デモ新版

既存の `calendar-app` と `calendar-app-admin` を変更せず、公開デモ版を新規実装するためのプロジェクトです。

## URL

- 公開サイト：`https://reservation-tool-next-demo.netlify.app/`
- デモ入口：`https://reservation-tool-next-demo.netlify.app/`
- 利用者用予約画面：`https://reservation-tool-next-demo.netlify.app/reserve`
- 管理者用画面：`https://reservation-tool-next-demo.netlify.app/admin`
- GitHub：`https://github.com/skamatakiwriter-rgb/reservation-tool-next`

## デモデータ

- 入力・操作した内容は利用者のブラウザ内（IndexedDB）だけに保存され、外部へ送信されません。
- 利用者画面または管理者画面を最後に開いてから7日を超えると、次回にデモ画面を開いた際に初期予約9件へ戻ります。
- 管理者画面の「初期状態に戻す」から、いつでも初期予約9件へ戻せます。
- 初期予約には、前営業日の取消予約と、そこから当日へ再受付した予約の相互履歴を確認できる例が含まれます。
- 管理者画面の「データを削除して終了」から、予約・設定・履歴を削除できます。

## 公開・更新方法

1. このプロジェクトをGitHubの予約管理専用リポジトリで管理します。
2. NetlifyでGitHubリポジトリを連携し、`netlify.toml`の設定を使って公開します。
3. 更新時は変更内容を検査してGitHubへ反映し、Netlifyの自動デプロイ結果を確認します。
4. 公開後は `/`、`/reserve`、`/admin`の直接表示と再読み込みを確認します。

ビルドコマンドは`npm run build`、公開フォルダーは`dist`です。`netlify.toml`のSPA書き換え設定により、`/reserve`と`/admin`を直接開いた場合も`index.html`を表示します。

2026年9月18日にNetlifyへ初回公開し、3つのURLの直接表示と再読み込みが正常に動作することを確認しました。以後、GitHubの`main`ブランチへ反映した変更はNetlifyで自動デプロイされます。

## コマンド

```powershell
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

## 実装状況

- 工程1：3URL、共通レイアウト、テスト・ビルド・公開設定まで完了
- 工程2：日付、入力検証、電話番号正規化、日別上限、受付停止、状態遷移まで完了
- 工程3：IndexedDB、初期予約9件、履歴、二重送信・版競合防止、初期化・削除・7日経過処理まで完了
- 工程4：カテゴリー選択、予約カレンダー、入力・確認・完了、連続申込み、印刷表示まで完了
- 工程5：管理カレンダー、予約一覧・詳細、電話受付、変更・状態更新、関連日、上限・受付停止まで完了
- 工程6：複数タブ自動反映、再選択時再読込、競合防止、キーボード・拡大・レスポンシブ確認まで完了
- 工程7：P0・P1・P2の受入確認、取消予約からの再受付履歴、初期化・削除・再開始、文書言語・favicon修正まで完了

工程7の型検査・72件の自動テスト・Lint・本番ビルド・主要画面操作は合格しています。4174番ポートの隔離環境で、初期状態への復元、データ削除、再開始時の初期予約8件再生成も確認しました。公開後の改善で再受付済みの初期例を追加し、現在は初期予約9件です。ChromeのA4縦印刷プレビューも合格し、工程7の最終受入確認は完了しました。
