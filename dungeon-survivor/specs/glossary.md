# 用語集（Glossary）

Dungeon Survivor のドメイン用語・コード表記・仕様ステータス（`Confirmed` / `Inferred` / `Disputed` / `Unknown`）を定義します。

| ID | 用語 | 別名・コード表記 | 定義 | 状態 | 関連ID | 出典・備考 |
| --- | --- | --- | --- | --- | --- | --- |
| GLS-01 | 基本攻撃（Core Shot） | `baseAttack` | 装備ゼロ時でも自機から自動発射される固有の遠距離ショット。プレイヤーLv単体では強化されず、スキルへ投資した使用SP総量に連動して強化される。 | Confirmed | BIZ-CMB-01, BIZ-CMB-06, APP-CMB-01 | `src/game/engine.ts` |
| GLS-02 | 迎撃装備（Gear） | `EquippedItem` / `EquipmentId` | 初期2スロット（スクラップ＆ビルドで最大5スロット）に装着し、敵の接近に応じて自動で攻撃・防御を行う5系統（`pulse_blade`・`orbit_shield`・`seeker_drone`・`reactive_coil`・`ricochet_disc`）の武装。 | Confirmed | BIZ-CMB-02, BIZ-GRW-03, APP-CMB-02 | `src/game/equipment.ts` |
| GLS-03 | 設置型オートタレット（不採用） | `auto_turret` | プレイヤー足元に固定タレットを設置する旧案。敵殲滅後に置かれてしまい探索主体のゲーム性と合わないため正式に不採用。 | Confirmed | BIZ-CMB-04, APP-CMB-04, DEC-01 | `specs/business/02-combat-and-loadout.feature` |
| GLS-04 | ハイブリッドスキルツリー | `SkillNodeId` / `skillPoints` | 攻撃（arms）・防御（defense）・機動（mobility）の3系統×3段階（計9ノード、各Lv0〜5）の成長システム。下位Lv3で上位を解放。 | Confirmed | BIZ-GRW-02, BIZ-GRW-05, APP-GRW-02 | `src/game/skillTree.ts` |
| GLS-05 | スカウト（偵察型） | `scout` | 通路や部屋を自由巡回し、プレイヤー発見時に警告アラート通知・周辺敵（300px内）の覚醒・追撃ランナー召喚を行う敵種別（旧名 `caller` / トレーサーから改名）。 | Confirmed | BIZ-EXP-07, APP-MAP-07, DEC-05, DEC-10 | `src/game/engine.ts` |
| GLS-06 | 追撃発光ランナー | `isAmbush` (`runner`) | スカウト発見時に2〜3体ポップする高速敵（プレイヤー標準速度 210px/s を上回る 228〜265px/s、`spawnDelay` 0.45秒猶予付き）。暗い通路でも視認できるよう周囲を照らす光輪（64px）を持つが、稼ぎ防止のためドロップは一切なし。 | Confirmed | BIZ-EXP-07, APP-MAP-07, INV-05, DEC-10 | `src/game/engine.ts`, `src/render/canvasRenderer.ts` |
| GLS-07 | 階段守護中ボス（GUARDIAN） | `isRoomBoss` / `isStairsGuard` | `3/6/9F`（`floor % 10 ∈ {3,6,9}`）の広めの階段部屋（`11×9`以上）に初期配置される強化中ボス。プレイヤーLv連動HPと3種弾幕を持ち、撃破で階段封印を解除して高Lv装備を確定ドロップする（通常階は守護中ボスなし）。 | Confirmed | BIZ-EXP-01, APP-MAP-01, INV-04, DEC-08, DEC-10 | `src/game/engine.ts`, `src/core/dungeon.ts` |
| GLS-08 | Fog of War（部屋・通路視界） | `CORRIDOR_VISION_RADIUS` / `explored` | 通路滞在時は自機周囲の円形ライトのみ明るく、部屋入室時は該当部屋全体が点灯する段階的視界制御。 | Confirmed | BIZ-EXP-06, APP-MAP-06, PRM-12 | `src/render/canvasRenderer.ts` |
| GLS-09 | スクラップ＆ビルド | `resolveEquipChoice` (`scrap_upgrade` / `scrap_expand`) | 装備枠満杯時に未所持装備を入手した際の処理。所持装備1個の強化（Lv10到達済み装備は選択不可）、または枠拡張への蓄積（3回で枠+1・最大5枠、装備追加時再検討）を選択する。 | Confirmed | BIZ-GRW-03, APP-GRW-03, DEC-07, DEC-10, PRM-05 | `src/game/engine.ts` |
| GLS-10 | 回復の泉（安全前室） | `fountain` / `fountainTile` | 節目階（10F毎: 10F, 20F...）のボス戦手前に配置される `10×10` の安全前室と回復の泉。進入・接触で1度だけ HP を 100% 回復し、ビルドを確認して大部屋ボス戦へ備えられる。 | Confirmed | BIZ-BOS-01, APP-BOS-01, PRM-16, ST-09, DEC-10 | `src/core/dungeon.ts`, `src/game/engine.ts` |
| GLS-11 | 節目クリア正式演出（10F節目UI） | `（再計画・未実装）` | 10F毎大ボス撃破後の正式なクリア祝勝モーダル・報酬確定・エンドレス続行選択UI。暫定版の10F大ボス本体＋11Fへの自動エンドレス継続は実装済みだが、正式クリア演出仕様は未確定。 | Disputed | BIZ-BOS-02, APP-BOS-02, ST-10, DEC-06, DEC-10, OQ-02 | `specs/app/04-fountain-and-boss.feature` |
| GLS-12 | 装備強化レベル上限 | `MAX_EQUIPMENT_LEVEL` (`10`) | 同種装備取得やスクラップ強化による装備レベル上限（暫定 `Lv10`）。`Lv1〜6` でビット数・連鎖数・跳弾数・扇角等の展開進化が最大化され、`Lv7〜10` は威力・CD短縮・射程延長へ特化。Lv10重複取得は HP/EXP ボーナスへ変換される。 | Confirmed | BIZ-CMB-05, APP-CMB-05, PRM-13, INV-09, DEC-10 | `src/game/equipment.ts`, `src/game/engine.ts` |
| GLS-13 | 実効索敵上限レンジ | `MAX_TARGET_RANGE` | 広域索敵スキルを含めても超えない自動迎撃・自機攻撃の最大射程（180px）。2つ隣の部屋への壁越し・長通路スナイプを防止する。 | Inferred | BIZ-CMB-03, APP-CMB-03, PRM-06, INV-06 | `src/game/equipment.ts` |
| GLS-14 | 任意ポーズ＆装備詳細画面 | `toggleSkillTree` (`ESC` / `K` / `⏸`) | 探索中いつでも `ESC` キー・`K` キー・HUDの `⏸` ボタンで時間を完全停止して開閉でき、スキルツリー配分に加えて自機コアショット・全装備スロットの詳細スペックを落ち着いて確認できる画面。 | Confirmed | BIZ-EXP-02, APP-MAP-02, ST-01, ST-02, ST-08, DEC-10 | `src/main.ts`, `src/ui/modals.ts` |
| GLS-15 | 節目大ボス（GRAND BOSS） | `isGrandBoss` | 10F毎（10F, 20F...）の `22×22` ボスアリーナに出現する節目ボス。プレイヤーLv連動HPと3種弾幕（12方向環状・追尾3弾・壁2回反射6弾）を切り替え、覚醒中はアリーナ内へ雑魚を増援し、撃破で階段解放＋高Lv装備確定＋11F以降へ続く。 | Confirmed | BIZ-BOS-02, APP-BOS-02, PRM-16, PRM-30, ST-09, DEC-10 | `src/game/engine.ts`, `src/core/dungeon.ts` |
