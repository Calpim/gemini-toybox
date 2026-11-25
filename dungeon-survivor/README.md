# Dungeon Survivor（開発メモ）

## 前提環境
- Node.js 24（`package.json` の `engines` と `.nvmrc` で宣言。CI も Node 24）
- npm 11.19.1（`packageManager` で固定。Node 24.22.x 同梱版）

## セットアップ
```bash
npm ci
```

## PR 前の確認
```bash
npm run verify
```
（`check` → `typecheck` → `test` → `build` を一括で実行します）
