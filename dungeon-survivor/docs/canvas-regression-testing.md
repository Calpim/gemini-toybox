# Canvas 描画回帰テスト（Canvas Rendering Regression Tests）

`src/render/canvasRenderer.regression.test.ts` は、`renderGame` の描画順序・座標・色・透明度・ブレンドモード・`save()`/`restore()` バランスに対する意図しない視覚的回帰を自動検出するためのテストです。

## 仕組み

- **記録型 2D コンテキスト（Recording Canvas2D Context）**: Canvas 2D API へのすべての描画呼び出しと、描画時点のアクティブスタイル（`fillStyle`, `strokeStyle`, `globalAlpha`, `globalCompositeOperation`, `lineWidth`, `font`, `shadowColor`, `shadowBlur`）を順序通りに記録し、Vitest スナップショット（`src/render/__snapshots__/canvasRenderer.regression.test.ts.snap`）と比較します。
- **CI 安定性と許容誤差**: 浮動小数点値は小数第 2 位（許容誤差 ±0.01）に丸め、`-0` は `0` に正規化しているため、OS・フォント・アンチエイリアス差によるフレークが発生しません。また、`NaN` / `Infinity` 座標や `save()`/`restore()` の不整合も同時に検出します。
- **対象ビューポート**:
  - PC 相当（`1280 x 720`）
  - モバイル相当（`390 x 844`、仮想スティック表示あり）

## 実行方法

```bash
npm test
# または描画回帰テストのみ実行
npx vitest run src/render/canvasRenderer.regression.test.ts
```

## 意図した描画変更時のスナップショット更新手順

描画仕様を意図的に変更してテストが失敗した場合は、差分内容を確認した上で以下のコマンドでスナップショットを更新してください：

```bash
npx vitest run -u src/render/canvasRenderer.regression.test.ts
```

更新後は `git diff src/render/__snapshots__/` で変更箇所が意図通りであることを確認し、`npm run verify` がすべてパスすることを確認してからコミットします。
