# 状態遷移図（State Transitions）

`GameState.status` を中心とした画面・進行状態および階層イベントの遷移定義です。

```mermaid
stateDiagram-v2
  [*] --> title : createGameState({ initialStatus: 'title' }) (タイトル待機)
  title --> playing : STARTボタン / Enter / Space (1F開始)
  playing --> skill_tree : ESC / K / SKILL・GEARスイッチ (時間停止・2タブ)
  skill_tree --> playing : ESC / K / 閉じるボタン / 同タブボタン
  playing --> equip_choice : 枠満杯時に未所持装備取得 または 所持中より+2Lv以上の同種装備取得
  equip_choice --> playing : 入れ替え または スクラップ＆ビルド (ESC/K・キャンセル不可)
  playing --> playing : 階段到達 (通常階は無条件 / 3,6,9,10Fはボス撃破後)
  playing --> gameover : player.hp <= 0
  gameover --> playing : リトライ (1F再生成)
```

## 状態遷移一覧

| ID | 遷移元 | トリガー・条件 | 遷移先 | 状態 | 関連ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| ST-01 | `playing` | 上HUDのスキル／ギアピル、下部コックピットの `SKILL` / `GEAR` スイッチ押下、または `ESC` / `K` キー入力 | `skill_tree` | Confirmed | BIZ-EXP-02, BIZ-EXP-11, APP-MAP-02, APP-MAP-10, APP-GRW-02, GLS-04, GLS-14, DEC-10, DEC-23, DEC-24, DEC-30 | シミュレーションを完全停止して2タブ（「スキル」「装備・ギア」）構成のポーズモーダルを表示（`SKILL` 側はスキルタブ、`GEAR` 側は装備・ギアタブを直接開き、`ESC`/`K` は前回タブで開く） |
| ST-02 | `skill_tree` | 閉じるボタン・`ESC` / `K` キー・または開いているのと同じタブ側のスイッチ（`SKILL` / `GEAR`）押下 | `playing` | Confirmed | BIZ-EXP-02, BIZ-EXP-11, APP-MAP-02, APP-MAP-10, APP-GRW-02, GLS-04, GLS-14, DEC-10, DEC-23, DEC-24, DEC-30 | スキル配分・装備確認後に探索再開（別タブ側のスイッチまたはタブバー押下時はモーダル内でタブを切替） |
| ST-03 | `playing` | 装備枠（現在上限）が満杯の状態で未所持装備を拾う、または空き枠の有無にかかわらず所持中と同種かつ+2Lv以上（ドロップLv >= 装備中Lv + 2）の装備を拾う | `equip_choice` | Confirmed | BIZ-GRW-03, BIZ-GRW-04, APP-GRW-03, APP-GRW-04, PRM-05, INV-11, DEC-07, DEC-25 | 入れ替えまたはスクラップ＆ビルド選択（理由バナー表示・同種+2Lv以上時は対象枠強調＆同一装備重複装着不可：`INV-11`）。モーダル中は時間停止し、`ESC` / `K` キー入力およびキャンセル・破棄操作は無効（閉じるボタンなし） |
| ST-04 | `equip_choice` | 入れ替えスロット選択（重複時は同装備枠のみ有効）またはスクラップ＆ビルド（所持装備1個強化／枠拡張蓄積）実行（キャンセル・保留不可） | `playing` | Confirmed | BIZ-GRW-03, BIZ-GRW-04, APP-GRW-03, APP-GRW-04, GLS-09, INV-11, DEC-07, DEC-25 | 選択結果を即時反映して `pendingEquipDrop` を消費し探索再開（`ESC` / `K` による中断やキャンセル・破棄は不可、`resolveEquipChoice` で他枠への重複入れ替えは拒否。全5枠Lv8到達時はそもそも `equip_choice` に遷移せず即時ボーナス付与） |
| ST-05 | `playing` | 階段に接触（通常階は無条件、3/6/9F守護中ボス階・10F毎大ボス階は `getStairsLockCount === 0` 後） | `playing（次階層 N+1F）` | Confirmed | BIZ-EXP-01, BIZ-EXP-09, APP-MAP-01, INV-04, GLS-07, GLS-15, DEC-08, DEC-10 | ボス階は封印解除後に `advanceToNextFloor` 実行 |
| ST-06 | `playing` | 敵接触または敵弾被弾により `player.hp <= 0` | `gameover` | Confirmed | APP-MAP-02 | 到達階層・撃破数サマリーを表示 |
| ST-07 | `gameover` | リトライボタン押下 | `playing（1F新規生成）` | Confirmed | APP-MAP-01 | `createGameState()` でランを初期化 |
| ST-08 | `playing` | 探索中の任意ポーズ操作（`ESC` / `K` / 上HUDピル・下部 `SKILL` / `GEAR` スイッチ） | `skill_tree（2タブポーズ画面）` | Confirmed | BIZ-EXP-02, BIZ-EXP-11, APP-MAP-02, APP-MAP-10, GLS-14, OQ-04, DEC-10, DEC-23, DEC-24, DEC-30 | 時間停止して「スキル」「装備・ギア」2タブでスキル強化・スクラップ進捗・装備詳細スペックを確認可能 |
| ST-09 | `playing（10F毎到達）` | 安全前室の回復の泉接触（100%回復）→ 大ボスアリーナ交戦・撃破 → 階段接触 | `playing（11F等へ暫定エンドレス進行）` | Confirmed | BIZ-BOS-01, BIZ-BOS-02, APP-BOS-01, APP-BOS-02, GLS-10, GLS-15, PRM-16, DEC-10 | 安全前室・回復の泉・大ボス戦・11F以降継続を実装済み |
| ST-10 | `playing（10F毎大ボス撃破）` | 節目大ボス撃破後の正式なクリア祝勝モーダル／エンドレス継続選択UI | 未定義 | Disputed | BIZ-BOS-02, APP-BOS-02, GLS-11, PRM-16, DEC-06, DEC-10, OQ-02 | 暫定版11F自動継続は実装済みだが、正式なクリア達成演出・続行選択UIは未定 |
| ST-11 | `equip_choice` / `playing` | スクラップ＆ビルドまたはLv8同種拾得による枠拡張蓄積が段階コスト（2→3:1回, 3→4:2回, 4→5:3回）に到達（現在枠 < 5） | `playing（装備枠 +1・上限5）` | Confirmed | BIZ-GRW-03, BIZ-GRW-04, APP-GRW-03, APP-GRW-04, GLS-09, DEC-07, DEC-11, DEC-16, PRM-05 | 初期2枠→最大5枠。5枠到達後のLv8重複はHP/EXPボーナスへ還元 |
| ST-12 | `title` | STARTボタン押下、または `Enter` / `Space` キー入力 | `playing（1F開始）` | Confirmed | APP-MAP-01 | `startGame()` で待機状態を解除し、FLOOR 1F バナーを表示 |
