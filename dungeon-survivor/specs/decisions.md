# 決定ログ（Decision Log）

プレイテストと技術判断に基づく仕様の確定・保留経緯の記録です。

| ID | 日付 | 決定者 | 決定事項 | 理由・背景 | 状態 | 状態遷移 | 関連ID | 再検討トリガー |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEC-01 | 2026-11-14 | 先輩 | 設置型オートタレット（`auto_turret`）を不採用とし、追従型の5系統装備へ統一 | 移動し続けるゲーム性では敵殲滅後に足元へタレットが置かれて放置されるため | Confirmed | Inferred → Confirmed | BIZ-CMB-04, APP-CMB-04, GLS-03, INV-03 | 拠点防衛など静止型ルールを導入する場合 |
| DEC-02 | 2026-11-14 | 先輩 | 移動速度スキルを廃止し、標準移動速度を引き上げた `baseSpeed = 210 px/s` を標準採用 | スキルで速度を補う前提をなくし、最初から快適な回避テンポを保証するため | Confirmed | Unknown → Confirmed | APP-MAP-02, PRM-01 | 回避ダッシュ専用アクションを別途実装する場合 |
| DEC-03 | 2026-11-14 | 先輩 | 初期ノーアイテム開始（自機ショットあり）＋SP消費総量連動強化＋Lv1-3=1SP / Lv4=2SP / Lv5=3SP を採用 | レベル数値だけの自動強化を避け、横展開か一点突破かのビルド選択を際立たせるため | Confirmed | Inferred → Confirmed | BIZ-CMB-06, BIZ-GRW-05, BIZ-GRW-06, PRM-09 | 1F序盤の突破率が著しく低い場合 |
| DEC-04 | 2026-11-14 | 先輩 | ドロップ装備レベルは所持最低Lv基準、敵装備ドロップ率は基礎1.5%に抑制 | 平均基準だと装備更新メリットが薄れ、ドロップ過多だと宝箱探索の旨味が落ちるため | Confirmed | Inferred → Confirmed | BIZ-GRW-07, APP-GRW-07, PRM-07, PRM-08 | 5F到達時点で装備Lvが極端に不足する場合 |
| DEC-05 | 2026-11-14 | 先輩 | トレーサー追撃ランナーの発光視認化＆ドロップ廃止・部屋入口2タイル接続・階段守護中ボス封印を採用 | 暗がりでの視認確保、警告稼ぎ対策、1マス入口解消、階段部屋の緊張感演出のため | Confirmed | Inferred → Confirmed | BIZ-EXP-01, BIZ-EXP-07, APP-MAP-01, APP-MAP-07, GLS-05, GLS-06, GLS-07 | 階段守護部屋の難度が強すぎて進行詰まりが多発する場合 |
| DEC-06 | 2026-11-14 | 未決 | 節目ボス階層（暫定10F毎）と回復の泉安全前室・エンドレス継続の仕様再計画 | 旧5F想定から暫定10階層毎へ方針変更。大部屋＋泉スタート＋雑魚リポップやエンドレス継続仕様は別途計画（`APP-BOS-01/02`） | Disputed | Inferred → Disputed | BIZ-BOS-01, BIZ-BOS-02, APP-BOS-01, APP-BOS-02, GLS-10, GLS-11, PRM-16, ST-09, ST-10, OQ-01, OQ-02 | 10F節目ボス・回復の泉・エンドレス継続を再計画・実装する時 |
| DEC-07 | 2026-11-14 | 先輩 | 初期3枠上限＋満杯時「スクラップ＆ビルド」（所持装備1個強化 or 拡張蓄積5回で枠+1・実質上限5枠）を確定 | 単なる全装備強化ではなく、装備強化と枠拡張（5回蓄積で+1枠、現行装備が5種のため実質上限5枠）を選べるようにするため | Confirmed | Inferred → Confirmed | BIZ-GRW-03, APP-GRW-03, GLS-09, PRM-05, ST-03, ST-04, ST-11, INV-03 | 装備アイテムの種類が6種以上に増えた時 |
| DEC-08 | 2026-11-14 | 先輩 | AI暫定パラメータ14件を確定（`PRM-14` は中ボス撃破のみで階段ロック解除へ変更、`PRM-17` 初期射程は索敵上限 `180px` と同値へ変更。残り12件は `Confirmed (AI提案)` として承認） | 増援・リポップ雑魚で階段が再ロックされる不自然さをなくし、視認できている敵に自機攻撃が届かない不自然さを解消するため | Confirmed | Inferred → Confirmed / Confirmed (AI提案) | PRM-01, PRM-02, PRM-04, PRM-06, PRM-08, PRM-12, PRM-14, PRM-15, PRM-17, PRM-19, PRM-21, PRM-23, PRM-25, PRM-27, INV-04, GLS-07, ST-05 | 今後のプレイテスト（`improvement-memo.md`）で数値再調整を行う時 |
| DEC-09 | 2026-11-14 | 先輩 | 部屋サイズ現状確定、`APP-MAP-01..07` / `APP-CMB-01..06` / `APP-GRW-01..07` を確定（AI提案ベースは `@Confirmed @AIProposed`）、`APP-BOS-01/02` は再計画へ変更 | 探索・自動迎撃・成長の現行方針を確定し、節目ボス（暫定10F毎）とエンドレス継続を別途計画へ切り出すため | Confirmed | Inferred → Confirmed / Disputed | APP-MAP-01, APP-MAP-02, APP-MAP-04, APP-MAP-05, APP-MAP-06, APP-MAP-07, APP-CMB-02, APP-CMB-03, APP-CMB-05, APP-CMB-06, APP-GRW-01, APP-GRW-02, APP-GRW-03, APP-GRW-04, APP-GRW-05, APP-GRW-06, APP-GRW-07, APP-BOS-01, APP-BOS-02 | バランス調整（`improvement-memo.md`）または節目ボス再計画の着手時 |
