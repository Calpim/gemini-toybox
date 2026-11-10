# 🎁 Gemini's Toybox (`gemini-toybox`)

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](https://opensource.org/licenses/MIT)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Arcade-emerald.svg)](https://calpim.github.io/gemini-toybox/)

AIペアプログラミングで創り出した、実験的Webゲーム・クリエイティブPoC・プレイ可能なプロトタイプを収集・公開するオープンな「おもちゃ箱」リポジトリです。

すべての作品は**「ブラウザを開くだけで、インストール不要・即座に快適に遊べる」**ことを目指して設計されています。

---

## 🎮 収録作品 (Collection)

### 1. 🚀 [Vertical Survivor Rogue (Wing Laser Edition)](./vertical-survivor-rogue/)
> スマホ片手で直感スワイプ操作！迫り来る敵の大軍勢を防衛ライン手前で迎撃する縦スクロール防衛サバイバー。

- **Webで即プレイ**: [ゲームを起動する ▶](https://calpim.github.io/gemini-toybox/vertical-survivor-rogue/)
- **特徴**:
  - 📱 **指隠れゼロの相対スワイプ操作**: 画面最下部の専用パッドエリアでスワイプ操作
  - 🎯 **手前広角スマートオートロック**: 脇をすり抜けようとする高速敵を最優先でロックオン迎撃
  - ⚡ **全7種スキル強化 ＆ 覚醒システム**: 連装ブラスター、ウィングレーザー、絨毯爆撃、誘導ミサイル、電磁シールド、連鎖電撃、マグネット吸引
  - 🎵 **完全プロシージャル・サウンド (Web Audio API)**: 外部音声ファイルゼロ！ステージ専用16-Step Synthwave BGM＆全9種SEをリアルタイム合成
  - 🌌 **パララックス・カメラドリフト**: 自機操作に連動するリアルタイム視差と低周波ブリージングによる継ぎ目ゼロの美麗背景

---

## 🌐 遊び方 (How to Play)

### A. GitHub Pages（オンラインで遊ぶ）
GitHub Pagesが有効化されている場合、下記のポータルURLからスマホ・PC問わず直接遊べます：  
👉 **[https://calpim.github.io/gemini-toybox/](https://calpim.github.io/gemini-toybox/)**

### B. ローカルで遊ぶ
外部依存ゼロ（Zero Dependency）の自己完結HTMLで構築されているため、リポジトリをcloneしてHTMLファイルをブラウザでダブルクリックするだけでオフラインでも遊べます。

```bash
git clone https://github.com/Calpim/gemini-toybox.git
cd gemini-toybox
open index.html  # または各作品フォルダの index.html をブラウザで開く
```

---

## 🛠️ 今後のロードマップ (Refactoring & Architecture)

現在は「動くもの最速重視（PoC）」として単一HTMLに全ロジックを凝縮していますが、今後は以下のモダンアーキテクチャへのリファクタリングを計画しています：

- [ ] **Vite + TypeScript 導入**:
  - `src/core/` (GameLoop, InputManager, State)
  - `src/audio/` (Synthwave Sequencer & SoundSynthesizer)
  - `src/entities/` (Player, Enemies, Weapons, Skills)
  - `src/stages/` (Parallax Camera, StageEnvironments)
- [ ] **CI/CD 自動化 (GitHub Actions)**:
  - push時の自動 lint / typecheck / build
  - GitHub Pages への自動デプロイパイプライン
- [ ] **新規PoC作品の継続追加**:
  - 物理パズル、ローグライトデッキ構築、生成AI連携ミニゲームなど

---

## 📜 ライセンス (License)

[MIT License](LICENSE) © 2026 Calpim
