# 不変条件（Invariants）

全フロア・全状態を通じて常に成立していなければならないシステム制約と検証テストの対応表です。

| ID | 分類 | 不変条件 | 検証箇所 | 状態 | 関連ID | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| INV-01 | マップ生成 | スタート地点から上り階段までは必ず通行可能な床経路が存在し、通路同士は `3×3` 塊に重ならず部屋接続口は幅2タイル以上を保つ | `src/core/dungeon.test.ts` (`[APP-MAP-01]`) | Confirmed | BIZ-EXP-01, APP-MAP-01, PRM-11 | `countSingleTileDoorways === 0` かつ BFS 到達確認 |
| INV-02 | HP維持 | `autoRegenPerSec === 0` であり、時間経過のみでHPは回復せず `0 <= hp <= maxHp` を保つ | `src/game/engine.test.ts` (`[APP-MAP-03]`) | Confirmed | BIZ-EXP-03, APP-MAP-03, PRM-03 | 回復オーブ取得時のみ増加 |
| INV-03 | 装備枠・採用方針 | `player.equipment.length <= 5`（初期2枠、スクラップ＆ビルドで最大5枠）を満たし、`auto_turret` は装備候補に含まれない | `src/game/engine.test.ts` (`[APP-CMB-02]`, `[APP-GRW-03 & APP-GRW-04]`) | Confirmed | BIZ-CMB-04, BIZ-GRW-03, PRM-05, GLS-02, GLS-03, DEC-07 | 初期 `MAX_EQUIP_SLOTS = 2`、`MAX_EQUIP_SLOTS_CAP = 5` |
| INV-04 | 階層進行 | `getStairsLockCount(state) > 0`（階段守護中ボス `isRoomBoss` が生存）の間、`advanceToNextFloor` は実行されない | `src/game/engine.test.ts` (`[APP-MAP-01]`) | Confirmed | BIZ-EXP-01, APP-MAP-01, GLS-07, ST-05, DEC-08 | 中ボス撃破時に封印解除通知を出して解禁（増援・リポップ雑魚は無関係） |
| INV-05 | 経済バランス | `enemy.isAmbush === true` のトレーサー追撃ランナーを倒しても、`exp` / `heal` / `equip` のドロップを一切生成しない | `src/game/engine.test.ts` (`[APP-MAP-07]`) | Confirmed | BIZ-EXP-07, APP-MAP-07, GLS-06 | 警報ループによる経験値稼ぎを構造的に防止 |
| INV-06 | 索敵・射線 | 自機攻撃および全装備の索敵距離は `MAX_TARGET_RANGE (180px)` を超えず、壁越し（`hasLineOfSight === false`）の標的を攻撃しない | `src/game/engine.test.ts` (`[APP-CMB-01 & APP-CMB-03]`) | Confirmed | BIZ-CMB-03, APP-CMB-03, PRM-06, GLS-13, DEC-09 | `def_sensor` Lv5でも 180px 上限を厳守 |
| INV-07 | スポーン品質 | 初期配置およびリポップの敵座標は既配置敵・壁と重複せず、リポップは自機から `260px` 以上離れた床タイルのみを使用する | `src/game/engine.test.ts` (`[APP-MAP-04]`, `[APP-MAP-07]`) | Confirmed | BIZ-EXP-04, BIZ-EXP-07, APP-MAP-04 | 同座標への多重ポップを禁止 |
| INV-08 | 物理安定性 | 1フレームの経過時間 `dt` はクランプされ、壁衝突は各軸ごとの押し戻しで壁貫通を起こさない | `src/main.ts#L141`, `src/core/collision.ts` | Inferred | APP-MAP-02 | `main.ts` では `0.05s`、`engine.ts` では `0.1s` 上限 |
