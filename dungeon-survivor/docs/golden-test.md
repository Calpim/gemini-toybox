# ゴールデンテスト（挙動スナップショット）運用ガイド

## 目的

`src/game/golden.test.ts` は、固定シードと決定的な入力スクリプトで `stepGame(state, input, 1/60)` を 600 フレーム（ゲーム内 10 秒）実行し、最終状態の要約をスナップショット JSON（`src/game/__golden__/golden-snapshot.json`）と比較するテストです。

ユニットテストがすべて緑のまま、リファクタリングによって意図せずゲーム挙動が変化してしまう事故を CI で検出することを目的としています。

## テストの実行方法

通常実行（`npm test` および `npm run verify` に含まれます）：

```bash
cd dungeon-survivor
npm test
```

ゴールデンテスト単体で実行する場合：

```bash
cd dungeon-survivor
npx vitest run src/game/golden.test.ts
```

通常実行ではスナップショットの読み込みと比較のみを行い、ファイルは書き換えません。

## スナップショットの更新手順

環境変数 `UPDATE_GOLDEN=1` を付けてゴールデンテストを実行すると、`src/game/__golden__/golden-snapshot.json` が再生成されます。

```bash
cd dungeon-survivor
UPDATE_GOLDEN=1 npx vitest run src/game/golden.test.ts
```

更新後は、必ず通常のテストと `npm run verify` を実行し、フォーマットや型チェックを含めてパスすることを確認してください。

```bash
git diff src/game/__golden__/golden-snapshot.json
npm run verify
```

## 更新時の注意事項（重要）

- **意図した挙動変更のときだけ更新する**: バランス調整や仕様変更など、挙動が変わることが期待される変更のときにのみスナップショットを更新してください。
- **落ちたテストを通す目的で安易に更新しない**: リファクタリングなど挙動を変えないはずの変更でゴールデンテストが落ちた場合、スナップショットを更新するのではなく、実装側の意図しない差分を調査・修正してください。
- **更新時はスナップショットの diff を必ずレビューする**: `git diff src/game/__golden__/golden-snapshot.json` を確認し、どのシナリオのどの項目（HP・位置・キル数・敵状態・弾／ピックアップ内訳など）が意図通りに変化したかを説明できる状態にしてからコミットしてください。
