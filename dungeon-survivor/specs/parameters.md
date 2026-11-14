# パラメータ表（Parameters）

ゲームバランス・マップ生成・戦闘・成長に関する主要数値パラメータの一覧です。

| ID | カテゴリ | パラメータ名 | 現行値 | 単位・形式 | 状態 | 関連ID | 元コード参照 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PRM-01 | プレイヤー | 標準移動速度 (`baseSpeed`) | `210` | `px/s` | Inferred | APP-MAP-02, DEC-02 | `src/game/engine.ts#L453` |
| PRM-02 | プレイヤー | 初期HP / 最大HP (`hp` / `maxHp`) | `100` | `HP` | Inferred | APP-MAP-03 | `src/game/engine.ts#L454-L455` |
| PRM-03 | プレイヤー | 自然回復レート (`autoRegenPerSec`) | `0` | `HP/s` | Confirmed | BIZ-EXP-03, APP-MAP-03, INV-02 | `src/game/engine.ts#L456` |
| PRM-04 | プレイヤー | 初期必要経験値・成長係数 (`expToNext`) | `25`（Lv毎に `×1.22`） | `EXP` | Inferred | BIZ-GRW-01, APP-GRW-01 | `src/game/engine.ts#L459` |
| PRM-05 | 装備 | 最大装備スロット数 (`MAX_EQUIP_SLOTS`) | `3` | `スロット` | Confirmed | BIZ-GRW-03, APP-GRW-03, INV-03, GLS-02 | `src/game/equipment.ts#L27` |
| PRM-06 | 戦闘 | 索敵上限距離 (`MAX_TARGET_RANGE`) | `180` | `px` | Inferred | BIZ-CMB-03, APP-CMB-03, INV-06, GLS-13 | `src/game/equipment.ts#L28` |
| PRM-07 | 戦闘 | ドロップ装備レベル抽選基準 | `所持最低Lv基準（-1〜+2 ランダム）` | `Lv` | Confirmed | BIZ-GRW-07, APP-GRW-07, DEC-04 | `src/game/engine.ts#L691-L702` |
| PRM-08 | 戦闘 | 敵からの基礎装備ドロップ率 | `1.5%` | `確率` | Inferred | BIZ-GRW-07, APP-GRW-07, DEC-04 | `src/game/engine.ts#L1321` |
| PRM-09 | スキル | スキル強化SPコスト (`getSkillUpgradeCost`) | `Lv1-3: 1 / Lv4: 2 / Lv5: 3` | `SP` | Confirmed | BIZ-GRW-05, APP-GRW-05, DEC-03, GLS-04 | `src/game/skillTree.ts#L32-L37` |
| PRM-10 | スキル | 上位解放前提レベル / 最大レベル | `前提 Lv3 / 最大 Lv5` | `Lv` | Confirmed | BIZ-GRW-02, APP-GRW-02, GLS-04 | `src/game/skillTree.ts#L14-L15` |
| PRM-11 | マップ生成 | 部屋サイズ・部屋間隔・通路幅 | `8〜13 x 7〜11 / 間隔>=4 / 通路幅2(80px)` | `タイル` | Confirmed | BIZ-EXP-06, APP-MAP-01, INV-01 | `src/core/dungeon.ts#L344-L360` |
| PRM-12 | 視界・カメラ | 目標表示幅 / 通路視界半径 | `840px (minZoom 0.72) / 半径210px` | `px` | Inferred | BIZ-EXP-06, APP-MAP-06, GLS-08 | `src/render/canvasRenderer.ts#L45-L53` |
| PRM-13 | 装備 | 装備強化レベル上限 (`item.level`) | `上限なし（ビット数のみ上限6）` | `Lv` | Unknown | BIZ-CMB-05, APP-CMB-05, GLS-12 | `src/game/equipment.ts#L108-L110` |
| PRM-14 | 敵・階段 | 階段守護中ボス補正 (`GUARDIAN`) | `階段部屋+3体 / 中ボス HP×1.45・攻撃×1.15` | `体・倍率` | Inferred | BIZ-EXP-01, APP-MAP-01, GLS-07, INV-04 | `src/game/engine.ts#L371-L396` |
| PRM-15 | 敵・時間 | 滞在リポップ遅延 / 砲台初撃チャージ | `初回24s (以降9〜14s) / 0.95s` | `秒` | Inferred | BIZ-EXP-04, APP-MAP-04, APP-MAP-07 | `src/game/engine.ts#L52,L1369` |
| PRM-16 | 階層進行 | 節目ボス階層指定 (`5F`) | `仕様上5F定義 / 実装上未分岐` | `階層` | Disputed | BIZ-BOS-01, APP-BOS-01, GLS-10, GLS-11, DEC-06 | `specs/app/04-fountain-and-boss.feature` |
