<p align="center">
  <img src="assets/icon.png" width="120" alt="Rovion AI Logo" />
</p>

<h1 align="center">⚡ Rovion AI</h1>

<p align="center">
  <strong>100% Local · 100% Offline · AI 1인 기업 에이전트 팀</strong><br/>
  Rovion Inc. — VS Code 확장 프로그램으로, 나만의 AI 에이전트 팀과 제2의 두뇌를 한 곳에서.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-7C3AED" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/brand-Rovion_Inc.-EC4899" alt="brand" />
  <img src="https://img.shields.io/badge/engine-Ollama%20%7C%20LM_Studio-orange" alt="engine" />
</p>

---

## 🌟 Overview

Rovion AI는 단순한 코딩 에이전트를 넘어섭니다. **P-Reinforce 아키텍처**를 기반으로, CEO부터 유튜브 전문가, 디자이너, 개발자까지 — 완전한 AI 에이전트 팀이 당신의 VS Code 안에서 24시간 일합니다.

---

## ⚡ Core Features

### 🧑‍💼 AI 에이전트 팀 (8명)
| 에이전트 | 역할 | 전문 분야 |
|---------|------|---------|
| 🧭 CEO | Chief Executive Agent | 오케스트레이션, 전략, 작업 분배 |
| 📺 레오 | Head of YouTube | 영상 기획, 트렌드, 메타데이터 |
| 📷 소피 | Head of Instagram | 릴스, 캡션, 해시태그 전략 |
| 🎨 아트 | Lead Designer | 브랜드, 썸네일, 비주얼 시스템 |
| 💻 데브 | Lead Developer | 코딩, 아키텍처, 자동화 |
| ✍️ 라이터 | Head of Copywriting | 세일즈 카피, 뉴스레터, SEO |
| 📣 마케터 | Head of Marketing | 채널 전략, 퍼널, KPI |
| 🧠 브레인 | Knowledge Manager | 지식 정리, 위키, 메모리 |

### 📂 P-Reinforce 지식 구조화
```
~/.rovion-brain/
├── _company/
│   ├── 10_Wiki/          # 위키 & 가이드
│   ├── 00_Raw/           # 원본 데이터
│   ├── 20_Projects/      # 프로젝트
│   ├── 30_Resources/     # 참고 자료
│   └── 40_Archive/       # 아카이브
└── 🚀 Skills/            # 재사용 스킬
```

### ☁️ Auto-Git Sync
파일 생성 즉시 GitHub에 자동 push. 설정에서 토큰만 입력하면 완료.

### 🔗 모델 자동 감지
Ollama / LM Studio 설치 모델을 자동으로 감지하고 UI에 연결.

---

## 🚀 Getting Started

### 1. Ollama 설치 (권장)
```bash
# https://ollama.ai 에서 설치 후:
ollama pull llama3
# 또는
ollama pull gemma2
```

### 2. 확장 프로그램 설치 (개발 모드)
```bash
cd rovion-ai
npm install
npm run compile
# VS Code에서 F5로 Extension Development Host 실행
```

### 3. 에이전트와 대화 시작
- VS Code 좌측 사이드바에서 ⚡ 아이콘 클릭
- 에이전트 선택 후 대화 시작!

---

## ⚙️ 설정

`Ctrl+,` → "Rovion AI" 검색

| 설정 | 기본값 | 설명 |
|-----|--------|------|
| `rovionAi.ollamaUrl` | `http://localhost:11434` | Ollama 서버 URL |
| `rovionAi.lmStudioUrl` | `http://localhost:1234` | LM Studio URL |
| `rovionAi.localBrainPath` | `~/.rovion-brain/` | 두뇌 폴더 경로 |
| `rovionAi.companyDir` | `<brain>/_company/` | 회사 폴더 경로 |
| `rovionAi.autoGitSync` | `false` | GitHub 자동 동기화 |
| `rovionAi.dailyBriefingHour` | `9` | 데일리 브리핑 시간 |

---

## 📋 명령어

`Ctrl+Shift+P` → "Rovion AI" 검색

- `Rovion AI: New Chat` — 새 채팅
- `Rovion AI: Show Brain Topology 🧠` — 두뇌 폴더 열기
- `Rovion AI: 회사 폴더 변경 🏢` — 회사 폴더 경로 변경
- `Rovion AI: 회사 GitHub 연결 ☁️` — GitHub 자동 동기화 설정
- `🔍 LLM 연결 진단` — Ollama/LM Studio 연결 확인
- `지금 데일리 브리핑 발사` — 즉시 브리핑 실행

---

## 🛠️ 개발

```bash
npm install          # 의존성 설치
npm run compile      # TypeScript 빌드
npm run watch        # 개발 모드 (자동 빌드)
```

---

## 📄 License

MIT — Rovion Inc.

*Fork of [connect-ai](https://github.com/wonseokjung/connect-ai) by wonseokjung*
