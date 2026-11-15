# 用語集（Glossary）

Dungeon Survivor のドメイン用語・コード表記・仕様ステータス（`Confirmed` / `Inferred` / `Disputed` / `Unknown`）を定義します。

| ID | 用語 | 別名・コード表記 | 定義 | 状態 | 関連ID | 出典・備考 |
| --- | --- | --- | --- | --- | --- | --- |
| GLS-01 | 基本攻撃（Core Shot） | `baseAttack` | 装備ゼロ時でも自機から自動発射される固有の遠距離ショット。プレイヤーLv単体では強化されず、スキルへ投資した使用SP総量に連動して強化される。 | Confirmed | BIZ-CMB-01, BIZ-CMB-06, APP-CMB-01 | `src/game/engine.ts` |
| GLS-02 | 迎撃装備（Gear） | `EquippedItem` / `EquipmentId` | 初期2スロット（スクラップ＆ビルドで最大5スロット）に装着し、敵の接近に応じて自動で攻撃・防御を行う5系統（`pulse_blade`・`orbit_shield`・`seeker_drone`・`reactive_coil`・`ricochet_disc`）の武装。 | Confirmed | BIZ-CMB-02, BIZ-GRW-03, APP-CMB-02 | `src/game/equipment.ts` |
| GLS-03 | 設置型オートタレット（不採用） | `auto_turret` | プレイヤー足元に固定タレットを設置する旧案。敵殲滅後に置かれてしまい探索主体のゲーム性と合わないため正式に不採用。 | Confirmed | BIZ-CMB-04, APP-CMB-04, DEC-01 | `specs/business/02-combat-and-loadout.feature` |
| GLS-04 | ハイブリッドスキルツリー | `SkillNodeId` / `skillPoints` | 攻撃（arms）・防御（defense）・機動（mobility）の3系統×3段階（計9ノード、各Lv0〜5）の成長システム。下位Lv3で上位を解放。 | Confirmed | BIZ-GRW-02, BIZ-GRW-05, APP-GRW-02 | `src/game/skillTree.ts` |
| GLS-05 | トレーサー（偵察型） | `caller` | 通路や部屋を自由巡回し、プレイヤー発見時に警告アラート通知・周辺敵の覚醒・追撃ランナー召喚を行う敵種別。 | Confirmed | BIZ-EXP-07, APP-MAP-07, DEC-05 | `src/game/engine.ts` |
| GLS-06 | 追撃発光ランナー | `isAmbush` (`runner`) | トレーサー発見時に2〜3体ポップする高速敵。暗い通路でも視認できるよう周囲を照らす光輪（64px）を持つが、稼ぎ防止のためドロップは一切なし。 | Confirmed | BIZ-EXP-07, APP-MAP-07, INV-05 | `src/game/engine.ts`, `src/render/canvasRenderer.ts` |
| GLS-07 | 階段守護中ボス（GUARDIAN） | `isRoomBoss` / `isStairsGuard` | 各階層の階段部屋に初期配置される強化タンク型の中ボス。この中ボス（`isRoomBoss`）を倒すまで階段が封印（LOCKED）される（増援・リポップ雑魚ではロックされない）。 | Confirmed | BIZ-EXP-01, APP-MAP-01, INV-04, DEC-08 | `src/game/engine.ts` |
| GLS-08 | Fog of War（部屋・通路視界） | `CORRIDOR_VISION_RADIUS` / `explored` | 通路滞在時は自機周囲の円形ライトのみ明るく、部屋入室時は該当部屋全体が点灯する段階的視界制御。 | Confirmed | BIZ-EXP-06, APP-MAP-06, PRM-12 | `src/render/canvasRenderer.ts` |
| GLS-09 | スクラップ＆ビルド | `resolveEquipChoice` (`scrap_upgrade` / `scrap_expand`) | 装備枠満杯時に未所持装備を入手した際の処理。所持装備1個の強化、または枠拡張への蓄積（3回で枠+1・最大5枠、装備追加時再検討）を選択する。 | Confirmed | BIZ-GRW-03, APP-GRW-03, DEC-07, PRM-05 | `src/game/engine.ts` |
| GLS-10 | 回復の泉（安全前室） | `（未実装）` | 節目階（暫定10F毎）のボス戦手前に配置され、HPを100%回復するとされる部屋。現行コードでは未実装であり、再計画対象。 | Disputed | BIZ-BOS-01, APP-BOS-01, PRM-16, ST-09, DEC-06, OQ-01 | `specs/app/04-fountain-and-boss.feature` vs `src/game/engine.ts` |
| GLS-11 | 節目フロアボス戦（暫定10F毎守護者） | `（未実装）` | 暫定10F毎の大部屋で周囲・追尾・壁反射攻撃＋雑魚リポップで戦う節目ボス。エンドレス継続や具体仕様は別途計画。 | Disputed | BIZ-BOS-02, APP-BOS-02, PRM-16, ST-10, DEC-06, OQ-02 | `specs/app/04-fountain-and-boss.feature` vs `src/game/engine.ts` |
| GLS-12 | 装備強化レベル上限 | `EquippedItem.level` | 同種装備取得やスクラップ変換で装備レベルをどこまで上げられるかの仕様（公転ビット数のみ最大6で頭打ち、他装備は上限未定義）。 | Unknown | BIZ-CMB-05, APP-CMB-05, PRM-13, OQ-03 | `src/game/equipment.ts` |
| GLS-13 | 実効索敵上限レンジ | `MAX_TARGET_RANGE` | 広域索敵スキルを含めても超えない自動迎撃・自機攻撃の最大射程（180px）。2つ隣の部屋への壁越し・長通路スナイプを防止する。 | Inferred | BIZ-CMB-03, APP-CMB-03, PRM-06, INV-06 | `src/game/equipment.ts` |
