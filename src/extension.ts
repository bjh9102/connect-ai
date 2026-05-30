/* Rovion AI — VS Code Extension Entry Point
 * Rovion Inc. AI 1인 기업 에이전트 팀
 *
 * Architecture:
 *  - Sidebar WebView: 채팅 UI (에이전트 선택, 대화, 파일 첨부)
 *  - LLM Bridge: Ollama / LM Studio 자동 감지 및 라우팅
 *  - Brain Engine: ~/.rovion-brain/ 지식 구조화 & Git 동기화
 *  - Task Tracker: tracker.json 기반 할 일 관리
 *  - Daily Briefing: 매일 아침 에이전트 팀 브리핑
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import axios from 'axios';

import { AGENTS, AGENT_ORDER, AgentDef } from './agents';
import {
    _getBrainDir,
    getCompanyDir,
    getSkillsDir,
    getWikiDir,
    getRawDir,
    getTrackerPath,
    CONFIG_NAMESPACE,
    BRAND_NAME
} from './paths';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    agentId?: string;
    timestamp?: number;
}

interface LLMModel {
    name: string;
    engine: 'ollama' | 'lmstudio';
}

interface TrackerTask {
    id: string;
    title: string;
    agentId: string;
    status: 'pending' | 'in-progress' | 'done' | 'cancelled';
    priority: 'high' | 'normal' | 'low';
    createdAt: string;
    updatedAt: string;
    notes?: string;
}

// ─────────────────────────────────────────
// LLM Bridge
// ─────────────────────────────────────────

async function detectModels(): Promise<LLMModel[]> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const ollamaUrl = cfg.get<string>('ollamaUrl', 'http://localhost:11434');
    const lmUrl = cfg.get<string>('lmStudioUrl', 'http://localhost:1234');
    const models: LLMModel[] = [];

    // Try Ollama
    try {
        const res = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 3000 });
        const tags = res.data?.models || [];
        for (const m of tags) {
            models.push({ name: m.name, engine: 'ollama' });
        }
    } catch { /* Ollama not running */ }

    // Try LM Studio
    try {
        const res = await axios.get(`${lmUrl}/v1/models`, { timeout: 3000 });
        const lmModels = res.data?.data || [];
        for (const m of lmModels) {
            models.push({ name: m.id, engine: 'lmstudio' });
        }
    } catch { /* LM Studio not running */ }

    return models;
}

async function chatCompletion(
    messages: ChatMessage[],
    model: string,
    engine: 'ollama' | 'lmstudio',
    onChunk?: (chunk: string) => void
): Promise<string> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const ollamaUrl = cfg.get<string>('ollamaUrl', 'http://localhost:11434');
    const lmUrl = cfg.get<string>('lmStudioUrl', 'http://localhost:1234');

    if (engine === 'ollama') {
        const response = await axios.post(
            `${ollamaUrl}/api/chat`,
            {
                model,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                stream: !!onChunk
            },
            { timeout: 120000, responseType: onChunk ? 'stream' : 'json' }
        );

        if (onChunk && response.data) {
            let fullText = '';
            for await (const chunk of response.data) {
                const lines = chunk.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.content) {
                            fullText += parsed.message.content;
                            onChunk(parsed.message.content);
                        }
                    } catch { /* skip malformed lines */ }
                }
            }
            return fullText;
        }

        return response.data?.message?.content || '';
    } else {
        // LM Studio (OpenAI-compatible)
        const response = await axios.post(
            `${lmUrl}/v1/chat/completions`,
            {
                model,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                stream: false
            },
            { timeout: 120000 }
        );
        return response.data?.choices?.[0]?.message?.content || '';
    }
}

// ─────────────────────────────────────────
// Brain Engine (P-Reinforce Knowledge)
// ─────────────────────────────────────────

function ensureDirExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function initBrainStructure(): void {
    const brainDir = _getBrainDir();
    const companyDir = getCompanyDir();

    [
        brainDir,
        companyDir,
        getSkillsDir(),
        getWikiDir(),
        getRawDir(),
        path.join(companyDir, '20_Projects'),
        path.join(companyDir, '30_Resources'),
        path.join(companyDir, '40_Archive')
    ].forEach(ensureDirExists);

    // Create README if not exists
    const readmePath = path.join(brainDir, 'README.md');
    if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(readmePath,
            `# Rovion AI — Brain\n\n> Rovion Inc. AI 1인 기업 지식 베이스\n\n## 구조\n\n- \`_company/\` — 회사 운영 자료\n  - \`10_Wiki/\` — 위키 & 가이드\n  - \`00_Raw/\` — 원본 데이터\n  - \`20_Projects/\` — 프로젝트\n  - \`30_Resources/\` — 참고 자료\n  - \`40_Archive/\` — 아카이브\n- \`🚀 Skills/\` — 재사용 가능한 스킬 패키지\n\n---\n_Generated by Rovion AI_\n`
        );
    }
}

async function saveToWiki(title: string, content: string, agentId: string): Promise<string> {
    const wikiDir = getWikiDir();
    ensureDirExists(wikiDir);

    const safeTitle = title.replace(/[^\w\s가-힣]/g, '').trim().replace(/\s+/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${date}_${safeTitle}.md`;
    const filePath = path.join(wikiDir, fileName);
    const agent = AGENTS[agentId];

    const fileContent = `# ${title}\n\n> 작성: ${agent?.emoji || '🤖'} ${agent?.name || agentId} | ${new Date().toLocaleString('ko-KR')}\n\n---\n\n${content}\n\n---\n_Generated by Rovion AI — ${BRAND_NAME}_\n`;
    fs.writeFileSync(filePath, fileContent, 'utf8');

    await autoGitSync(`[Rovion AI] Wiki: ${title}`);
    return filePath;
}

async function saveSkill(name: string, content: string, agentId: string): Promise<string> {
    const skillsDir = getSkillsDir();
    ensureDirExists(skillsDir);

    const safeName = name.replace(/[^\w\s가-힣]/g, '').trim().replace(/\s+/g, '_');
    const filePath = path.join(skillsDir, `${safeName}.md`);
    const agent = AGENTS[agentId];

    const fileContent = `# 💎 스킬: ${name}\n\n> 저장: ${agent?.emoji || '🤖'} ${agent?.name || agentId} | ${new Date().toLocaleString('ko-KR')}\n\n---\n\n${content}\n\n---\n_Skill saved by Rovion AI_\n`;
    fs.writeFileSync(filePath, fileContent, 'utf8');

    await autoGitSync(`[Rovion AI] Skill: ${name}`);
    return filePath;
}

async function autoGitSync(commitMessage: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (!cfg.get<boolean>('autoGitSync', false)) { return; }

    const brainDir = _getBrainDir();
    if (!fs.existsSync(path.join(brainDir, '.git'))) { return; }

    try {
        child_process.execSync(
            `git add -A && git commit -m "${commitMessage}" && git push`,
            { cwd: brainDir, stdio: 'pipe' }
        );
    } catch (e) {
        console.warn('[Rovion AI] Git sync failed:', e);
    }
}

// ─────────────────────────────────────────
// Task Tracker
// ─────────────────────────────────────────

function loadTasks(): TrackerTask[] {
    const trackerPath = getTrackerPath();
    if (!fs.existsSync(trackerPath)) { return []; }
    try {
        return JSON.parse(fs.readFileSync(trackerPath, 'utf8')) as TrackerTask[];
    } catch { return []; }
}

function saveTasks(tasks: TrackerTask[]): void {
    const trackerPath = getTrackerPath();
    ensureDirExists(path.dirname(trackerPath));
    fs.writeFileSync(trackerPath, JSON.stringify(tasks, null, 2), 'utf8');
}

function addTask(title: string, agentId: string, priority: TrackerTask['priority'] = 'normal'): TrackerTask {
    const tasks = loadTasks();
    const newTask: TrackerTask = {
        id: Date.now().toString(),
        title,
        agentId,
        status: 'pending',
        priority,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    tasks.push(newTask);
    saveTasks(tasks);
    return newTask;
}

// ─────────────────────────────────────────
// System Prompt Builder
// ─────────────────────────────────────────

function buildSystemPrompt(agentId: string): string {
    const agent = AGENTS[agentId];
    if (!agent) { return `당신은 Rovion AI 에이전트입니다.`; }

    const brainDir = _getBrainDir();
    const companyDir = getCompanyDir();

    // Load wiki context (recent files)
    let wikiContext = '';
    const wikiDir = getWikiDir();
    if (fs.existsSync(wikiDir)) {
        const wikiFiles = fs.readdirSync(wikiDir)
            .filter(f => f.endsWith('.md'))
            .sort().reverse().slice(0, 3);
        for (const f of wikiFiles) {
            try {
                const content = fs.readFileSync(path.join(wikiDir, f), 'utf8').slice(0, 500);
                wikiContext += `\n### ${f}\n${content}\n`;
            } catch { /* skip */ }
        }
    }

    return `당신은 ${BRAND_NAME}의 에이전트 팀 멤버입니다.

## 내 정체
- **이름**: ${agent.name} (${agent.role})
- **이모지**: ${agent.emoji}
- **전문 분야**: ${agent.specialty}
- **핵심 미션**: ${agent.tagline}
${agent.persona ? `\n## 나의 페르소나\n${agent.persona}` : ''}

## 회사 컨텍스트
- **회사명**: Rovion Inc.
- **두뇌 폴더**: ${brainDir}
- **회사 폴더**: ${companyDir}
- **나의 역할**: Rovion Inc.의 AI 1인 기업 에이전트 팀의 일원으로, 사용자(대표)의 미션을 24시간 돕습니다.

## 행동 원칙
1. 항상 실행 가능한 결과물을 제시합니다 (단순 조언 X, 직접 만들어 드림)
2. 모든 산출물은 P-Reinforce 구조(10_Wiki, 🚀 Skills, 00_Raw)에 맞게 저장 가능한 형태로
3. 불확실하면 가정을 명시하고, 최선의 선택지를 먼저 제안
4. 대표님의 시간을 아끼는 것이 최우선
${wikiContext ? `\n## 최근 위키 컨텍스트\n${wikiContext}` : ''}`;
}

// ─────────────────────────────────────────
// WebView Provider
// ─────────────────────────────────────────

class RovionChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rovion-ai.chatView';

    private _view?: vscode.WebviewView;
    private _chatHistory: ChatMessage[] = [];
    private _currentAgentId = 'ceo';
    private _models: LLMModel[] = [];
    private _selectedModel = '';
    private _selectedEngine: 'ollama' | 'lmstudio' = 'ollama';
    private _isStreaming = false;
    private _context: vscode.ExtensionContext;

    constructor(private readonly extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._context = context;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        // Handle messages from WebView
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'init':
                    await this._handleInit();
                    break;
                case 'sendMessage':
                    await this._handleSendMessage(message.text, message.agentId);
                    break;
                case 'changeAgent':
                    this._currentAgentId = message.agentId;
                    this._postMessage({ command: 'agentChanged', agentId: message.agentId });
                    break;
                case 'changeModel':
                    this._selectedModel = message.model;
                    this._selectedEngine = message.engine;
                    break;
                case 'clearChat':
                    this._chatHistory = [];
                    this._postMessage({ command: 'chatCleared' });
                    break;
                case 'saveToWiki':
                    await this._handleSaveToWiki(message.title, message.content);
                    break;
                case 'saveSkill':
                    await this._handleSaveSkill(message.name, message.content);
                    break;
                case 'refreshModels':
                    await this._handleInit();
                    break;
                case 'openBrain':
                    vscode.commands.executeCommand('rovion-ai.showBrainNetwork');
                    break;
            }
        });

        // Init after resolve
        setTimeout(() => this._handleInit(), 500);
    }

    private async _handleInit() {
        this._models = await detectModels();
        const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const defaultModel = cfg.get<string>('defaultModel', '');

        if (this._models.length > 0 && !this._selectedModel) {
            const preferred = this._models.find(m => m.name === defaultModel) || this._models[0];
            this._selectedModel = preferred.name;
            this._selectedEngine = preferred.engine;
        }

        initBrainStructure();

        this._postMessage({
            command: 'initialized',
            agents: AGENT_ORDER.map(id => AGENTS[id]).filter(Boolean),
            models: this._models,
            selectedModel: this._selectedModel,
            selectedEngine: this._selectedEngine,
            currentAgentId: this._currentAgentId,
            brainDir: _getBrainDir(),
            companyDir: getCompanyDir()
        });
    }

    private async _handleSendMessage(text: string, agentId?: string) {
        if (this._isStreaming) { return; }
        if (!this._selectedModel) {
            this._postMessage({ command: 'error', message: '모델이 선택되지 않았습니다. LLM 서버(Ollama/LM Studio)를 시작하고 새로고침해주세요.' });
            return;
        }

        const activeAgentId = agentId || this._currentAgentId;
        const userMessage: ChatMessage = {
            role: 'user',
            content: text,
            timestamp: Date.now()
        };
        this._chatHistory.push(userMessage);

        this._isStreaming = true;
        this._postMessage({ command: 'streamStart', agentId: activeAgentId });

        try {
            const systemPrompt = buildSystemPrompt(activeAgentId);
            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...this._chatHistory.slice(-20) // last 20 messages for context
            ];

            let fullResponse = '';
            fullResponse = await chatCompletion(
                messages,
                this._selectedModel,
                this._selectedEngine,
                (chunk) => {
                    fullResponse += chunk;
                    this._postMessage({ command: 'streamChunk', chunk });
                }
            );

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: fullResponse,
                agentId: activeAgentId,
                timestamp: Date.now()
            };
            this._chatHistory.push(assistantMessage);

            this._postMessage({ command: 'streamEnd', fullResponse, agentId: activeAgentId });
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            this._postMessage({ command: 'error', message: `LLM 오류: ${errMsg}` });
        } finally {
            this._isStreaming = false;
        }
    }

    private async _handleSaveToWiki(title: string, content: string) {
        try {
            const filePath = await saveToWiki(title, content, this._currentAgentId);
            this._postMessage({ command: 'savedToWiki', filePath });
            vscode.window.showInformationMessage(`📖 위키에 저장됨: ${path.basename(filePath)}`);
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`위키 저장 실패: ${errMsg}`);
        }
    }

    private async _handleSaveSkill(name: string, content: string) {
        try {
            const filePath = await saveSkill(name, content, this._currentAgentId);
            this._postMessage({ command: 'savedSkill', filePath });
            vscode.window.showInformationMessage(`💎 스킬 저장됨: ${path.basename(filePath)}`);
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`스킬 저장 실패: ${errMsg}`);
        }
    }

    private _postMessage(message: Record<string, unknown>) {
        this._view?.webview.postMessage(message);
    }

    private _getHtmlContent(webview: vscode.Webview): string {
        // Build agents JSON for UI
        const agentsJson = JSON.stringify(
            AGENT_ORDER.map(id => AGENTS[id]).filter(Boolean)
        );

        return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rovion AI</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --badge-bg: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --accent: #7C3AED;
    --accent-light: #8B5CF6;
    --accent-dim: rgba(124, 58, 237, 0.15);
    --user-msg-bg: var(--accent-dim);
    --agent-msg-bg: var(--vscode-editor-inactiveSelectionBackground);
    --scrollbar: var(--vscode-scrollbarSlider-background);
  }

  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: 13px;
    background: var(--bg);
    color: var(--fg);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ─── Header ─── */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .header-logo {
    font-size: 18px;
  }
  .header-title {
    font-weight: 700;
    font-size: 13px;
    background: linear-gradient(135deg, #7C3AED, #EC4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    flex: 1;
  }
  .header-actions {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fg);
    opacity: 0.6;
    padding: 3px 5px;
    border-radius: 4px;
    font-size: 14px;
    transition: opacity 0.15s, background 0.15s;
  }
  .icon-btn:hover { opacity: 1; background: var(--accent-dim); }

  /* ─── Agent Strip ─── */
  .agent-strip {
    display: flex;
    gap: 4px;
    padding: 6px 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar) transparent;
  }
  .agent-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 20px;
    border: 1px solid var(--border);
    cursor: pointer;
    white-space: nowrap;
    font-size: 11px;
    transition: all 0.15s;
    background: transparent;
    color: var(--fg);
    opacity: 0.7;
  }
  .agent-chip:hover { opacity: 1; border-color: var(--accent-light); }
  .agent-chip.active {
    background: var(--accent-dim);
    border-color: var(--accent);
    opacity: 1;
    font-weight: 600;
    color: var(--accent-light);
  }
  .agent-chip .emoji { font-size: 13px; }

  /* ─── Model Bar ─── */
  .model-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    flex-shrink: 0;
  }
  .model-label { opacity: 0.5; }
  .model-select {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .engine-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    background: var(--badge-bg);
    color: var(--badge-fg);
  }
  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #10B981;
    flex-shrink: 0;
  }
  .status-dot.offline { background: #EF4444; }

  /* ─── Chat Area ─── */
  .chat-area {
    flex: 1;
    overflow-y: auto;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar) transparent;
  }
  .msg-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }

  .msg-header {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    opacity: 0.6;
    padding: 0 4px;
  }
  .msg-header .agent-name { font-weight: 600; }

  .msg-bubble {
    padding: 8px 10px;
    border-radius: 8px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .msg-bubble.user {
    background: var(--user-msg-bg);
    border: 1px solid var(--accent-dim);
    border-radius: 8px 8px 2px 8px;
    align-self: flex-end;
    max-width: 90%;
  }
  .msg-bubble.assistant {
    background: var(--agent-msg-bg);
    border-radius: 2px 8px 8px 8px;
  }

  .msg-actions {
    display: flex;
    gap: 4px;
    padding: 2px 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .msg-wrap:hover .msg-actions { opacity: 1; }
  .msg-action-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--fg);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    opacity: 0.7;
    transition: all 0.15s;
  }
  .msg-action-btn:hover { opacity: 1; background: var(--accent-dim); border-color: var(--accent); }

  .typing-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    background: var(--agent-msg-bg);
    border-radius: 8px;
    width: fit-content;
  }
  .typing-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent-light);
    animation: bounce 1.2s infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-4px); }
  }

  .welcome-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 16px;
    text-align: center;
  }
  .welcome-logo { font-size: 48px; }
  .welcome-title { font-size: 15px; font-weight: 700; opacity: 0.9; }
  .welcome-sub { font-size: 12px; opacity: 0.5; line-height: 1.5; }
  .no-model-warn {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    color: #FCA5A5;
    margin: 0 4px;
  }

  /* ─── Input Area ─── */
  .input-area {
    padding: 8px 10px 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  .input-wrap {
    display: flex;
    gap: 6px;
    align-items: flex-end;
  }
  .input-box {
    flex: 1;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
    resize: none;
    min-height: 36px;
    max-height: 150px;
    line-height: 1.4;
    transition: border-color 0.15s;
    overflow-y: auto;
  }
  .input-box:focus {
    outline: none;
    border-color: var(--accent);
  }
  .send-btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 14px;
    height: 36px;
    transition: background 0.15s, transform 0.1s;
    flex-shrink: 0;
  }
  .send-btn:hover { background: var(--accent-light); }
  .send-btn:active { transform: scale(0.96); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .quick-actions {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .quick-btn {
    background: var(--input-bg);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.7;
    transition: all 0.15s;
  }
  .quick-btn:hover { opacity: 1; border-color: var(--accent); }

  /* ─── Toast ─── */
  .toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #1F2937;
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 999;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
    white-space: nowrap;
  }
  .toast.show { opacity: 1; }

  /* code blocks in chat */
  .msg-bubble code {
    background: var(--vscode-textCodeBlock-background);
    padding: 0 3px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }
  .msg-bubble pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 8px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 4px 0;
  }
  .msg-bubble pre code { background: none; padding: 0; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <span class="header-logo">⚡</span>
  <span class="header-title">Rovion AI</span>
  <div class="header-actions">
    <button class="icon-btn" onclick="refreshModels()" title="모델 새로고침">↺</button>
    <button class="icon-btn" onclick="clearChat()" title="채팅 초기화">🗑</button>
    <button class="icon-btn" onclick="openBrain()" title="두뇌 열기">🧠</button>
  </div>
</div>

<!-- Agent Strip -->
<div class="agent-strip" id="agentStrip">
  <!-- populated by JS -->
</div>

<!-- Model Bar -->
<div class="model-bar">
  <span class="status-dot offline" id="statusDot"></span>
  <span class="model-label">모델:</span>
  <select class="model-select" id="modelSelect" onchange="onModelChange()">
    <option value="">-- LLM 서버를 시작하세요 --</option>
  </select>
  <span class="engine-badge" id="engineBadge">-</span>
</div>

<!-- Chat Area -->
<div class="chat-area" id="chatArea">
  <div class="welcome-card" id="welcomeCard">
    <div class="welcome-logo">🚀</div>
    <div class="welcome-title">Rovion AI에 오신 것을 환영합니다</div>
    <div class="welcome-sub">에이전트 팀과 함께 AI 1인 기업을 운영하세요.<br>CEO부터 유튜브, 디자이너, 개발자까지.<br><br>위에서 에이전트를 선택하고 채팅을 시작하세요.</div>
  </div>
</div>

<!-- Input Area -->
<div class="input-area">
  <div class="quick-actions" id="quickActions">
    <button class="quick-btn" onclick="quickSend('오늘 할 일 브리핑해줘')">📋 오늘 브리핑</button>
    <button class="quick-btn" onclick="quickSend('유튜브 영상 아이디어 10개 줘')">💡 아이디어</button>
    <button class="quick-btn" onclick="quickSend('방금 대화 위키에 저장해줘')">📖 위키 저장</button>
  </div>
  <div class="input-wrap">
    <textarea
      class="input-box"
      id="inputBox"
      placeholder="에이전트에게 말하세요... (Shift+Enter로 줄바꿈)"
      rows="1"
      onkeydown="onKeyDown(event)"
      oninput="autoResize(this)"
    ></textarea>
    <button class="send-btn" id="sendBtn" onclick="sendMessage()">↑</button>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
  const vscode = acquireVsCodeApi();

  let currentAgentId = 'ceo';
  let selectedModel = '';
  let selectedEngine = 'ollama';
  let isStreaming = false;
  let streamBuffer = '';
  let agents = [];
  let models = [];

  const agentColors = {
    ceo: '#F8FAFC', youtube: '#FF4444', instagram: '#E1306C',
    designer: '#A78BFA', developer: '#34D399', copywriter: '#FBBF24',
    marketing: '#F97316', brain: '#60A5FA'
  };

  // ── Init ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.command) {
      case 'initialized': handleInit(msg); break;
      case 'agentChanged': handleAgentChanged(msg.agentId); break;
      case 'streamStart': handleStreamStart(msg.agentId); break;
      case 'streamChunk': handleStreamChunk(msg.chunk); break;
      case 'streamEnd': handleStreamEnd(msg.fullResponse, msg.agentId); break;
      case 'chatCleared': handleChatCleared(); break;
      case 'error': showError(msg.message); break;
      case 'savedToWiki': showToast('📖 위키에 저장됨!'); break;
      case 'savedSkill': showToast('💎 스킬 저장됨!'); break;
    }
  });

  vscode.postMessage({ command: 'init' });

  function handleInit(msg) {
    agents = msg.agents || [];
    models = msg.models || [];
    selectedModel = msg.selectedModel || '';
    selectedEngine = msg.selectedEngine || 'ollama';
    currentAgentId = msg.currentAgentId || 'ceo';

    renderAgentStrip();
    renderModelSelect();
  }

  function renderAgentStrip() {
    const strip = document.getElementById('agentStrip');
    strip.innerHTML = '';
    for (const agent of agents) {
      const chip = document.createElement('button');
      chip.className = 'agent-chip' + (agent.id === currentAgentId ? ' active' : '');
      chip.dataset.id = agent.id;
      chip.innerHTML = \`<span class="emoji">\${agent.emoji}</span><span>\${agent.name}</span>\`;
      chip.onclick = () => selectAgent(agent.id);
      strip.appendChild(chip);
    }
  }

  function renderModelSelect() {
    const sel = document.getElementById('modelSelect');
    const dot = document.getElementById('statusDot');
    const badge = document.getElementById('engineBadge');
    sel.innerHTML = '';

    if (models.length === 0) {
      sel.innerHTML = '<option>-- LLM 서버 없음 --</option>';
      dot.className = 'status-dot offline';
      badge.textContent = '-';
      document.getElementById('welcomeCard').innerHTML +=
        '<div class="no-model-warn" style="margin-top:12px">⚠️ Ollama 또는 LM Studio를 먼저 시작하세요</div>';
      return;
    }

    dot.className = 'status-dot';

    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.name + '|' + m.engine;
      opt.textContent = \`[\${m.engine === 'ollama' ? 'O' : 'L'}] \${m.name}\`;
      if (m.name === selectedModel) { opt.selected = true; }
      sel.appendChild(opt);
    }

    onModelChange();
  }

  function onModelChange() {
    const sel = document.getElementById('modelSelect');
    const [name, engine] = (sel.value || '').split('|');
    selectedModel = name || '';
    selectedEngine = (engine || 'ollama');
    document.getElementById('engineBadge').textContent = selectedEngine === 'ollama' ? 'Ollama' : 'LM Studio';
    vscode.postMessage({ command: 'changeModel', model: selectedModel, engine: selectedEngine });
  }

  function selectAgent(id) {
    currentAgentId = id;
    document.querySelectorAll('.agent-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.id === id);
    });
    vscode.postMessage({ command: 'changeAgent', agentId: id });
    showToast(\`\${agents.find(a => a.id === id)?.emoji} \${agents.find(a => a.id === id)?.name} 에이전트로 전환\`);
  }

  function handleAgentChanged(id) {
    currentAgentId = id;
  }

  // ── Messaging ──
  function sendMessage() {
    if (isStreaming) { return; }
    const box = document.getElementById('inputBox');
    const text = box.value.trim();
    if (!text) { return; }

    box.value = '';
    autoResize(box);
    appendUserMessage(text);
    vscode.postMessage({ command: 'sendMessage', text, agentId: currentAgentId });
  }

  function quickSend(text) {
    document.getElementById('inputBox').value = text;
    sendMessage();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }

  function appendUserMessage(text) {
    hideWelcome();
    const chatArea = document.getElementById('chatArea');
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap';
    wrap.innerHTML = \`
      <div class="msg-header" style="justify-content:flex-end">
        <span>나</span>
        <span>\${new Date().toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'})}</span>
      </div>
      <div class="msg-bubble user">\${escapeHtml(text)}</div>
    \`;
    chatArea.appendChild(wrap);
    scrollToBottom();
  }

  let streamingWrap = null;
  let streamingBubble = null;

  function handleStreamStart(agentId) {
    isStreaming = true;
    streamBuffer = '';
    document.getElementById('sendBtn').disabled = true;

    const agent = agents.find(a => a.id === agentId) || { name: agentId, emoji: '🤖' };
    const chatArea = document.getElementById('chatArea');

    streamingWrap = document.createElement('div');
    streamingWrap.className = 'msg-wrap';

    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerHTML = \`<span>\${agent.emoji}</span><span class="agent-name">\${agent.name}</span>\`;

    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typingIndicator';
    typing.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

    streamingBubble = document.createElement('div');
    streamingBubble.className = 'msg-bubble assistant';
    streamingBubble.style.display = 'none';

    streamingWrap.appendChild(header);
    streamingWrap.appendChild(typing);
    streamingWrap.appendChild(streamingBubble);
    chatArea.appendChild(streamingWrap);
    scrollToBottom();
  }

  function handleStreamChunk(chunk) {
    streamBuffer += chunk;
    const typing = document.getElementById('typingIndicator');
    if (typing) { typing.style.display = 'none'; }
    if (streamingBubble) {
      streamingBubble.style.display = '';
      streamingBubble.textContent = streamBuffer;
      scrollToBottom();
    }
  }

  function handleStreamEnd(fullResponse, agentId) {
    isStreaming = false;
    document.getElementById('sendBtn').disabled = false;

    const typing = document.getElementById('typingIndicator');
    if (typing) { typing.style.display = 'none'; }

    if (streamingBubble) {
      streamingBubble.style.display = '';
      streamingBubble.textContent = fullResponse;
    }

    // Add action buttons
    if (streamingWrap) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = \`
        <button class="msg-action-btn" onclick="copyToClipboard(this)">📋 복사</button>
        <button class="msg-action-btn" onclick="promptSaveWiki(this)">📖 위키 저장</button>
        <button class="msg-action-btn" onclick="promptSaveSkill(this)">💎 스킬 저장</button>
      \`;
      // Store response in actions for later
      actions.dataset.response = fullResponse;
      streamingWrap.appendChild(actions);
    }

    streamingWrap = null;
    streamingBubble = null;
    scrollToBottom();
  }

  function handleChatCleared() {
    const chatArea = document.getElementById('chatArea');
    chatArea.innerHTML = \`
      <div class="welcome-card" id="welcomeCard">
        <div class="welcome-logo">🚀</div>
        <div class="welcome-title">채팅이 초기화되었습니다</div>
        <div class="welcome-sub">새 대화를 시작하세요!</div>
      </div>
    \`;
  }

  // ── Actions ──
  function copyToClipboard(btn) {
    const actionsEl = btn.closest('.msg-actions');
    const response = actionsEl?.dataset.response || '';
    navigator.clipboard.writeText(response).then(() => showToast('📋 복사됨!'));
  }

  function promptSaveWiki(btn) {
    const actionsEl = btn.closest('.msg-actions');
    const content = actionsEl?.dataset.response || '';
    const title = prompt('위키 제목을 입력하세요:', '');
    if (title?.trim()) {
      vscode.postMessage({ command: 'saveToWiki', title: title.trim(), content });
    }
  }

  function promptSaveSkill(btn) {
    const actionsEl = btn.closest('.msg-actions');
    const content = actionsEl?.dataset.response || '';
    const name = prompt('스킬 이름을 입력하세요:', '');
    if (name?.trim()) {
      vscode.postMessage({ command: 'saveSkill', name: name.trim(), content });
    }
  }

  function clearChat() {
    if (confirm('채팅 기록을 초기화할까요?')) {
      vscode.postMessage({ command: 'clearChat' });
    }
  }

  function refreshModels() {
    vscode.postMessage({ command: 'refreshModels' });
    showToast('↺ 모델 목록 새로고침 중...');
  }

  function openBrain() {
    vscode.postMessage({ command: 'openBrain' });
  }

  // ── Helpers ──
  function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function hideWelcome() {
    const wc = document.getElementById('welcomeCard');
    if (wc) { wc.remove(); }
  }

  function showError(msg) {
    isStreaming = false;
    document.getElementById('sendBtn').disabled = false;
    const typing = document.getElementById('typingIndicator');
    if (typing) { typing.style.display = 'none'; }
    const chatArea = document.getElementById('chatArea');
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px 12px;font-size:12px;color:#FCA5A5;margin:4px 0;';
    errDiv.textContent = '⚠️ ' + msg;
    chatArea.appendChild(errDiv);
    scrollToBottom();
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function escapeHtml(text) {
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>`;
    }

    /** Public method to insert text into chat input (e.g., from code selection) */
    public insertText(text: string) {
        this._postMessage({ command: 'insertText', text });
    }
}

// ─────────────────────────────────────────
// Extension Activation
// ─────────────────────────────────────────

let chatProvider: RovionChatViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log(`[${BRAND_NAME}] Activating...`);

    // Initialize brain structure
    initBrainStructure();

    // Register WebView provider
    chatProvider = new RovionChatViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            RovionChatViewProvider.viewType,
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // ── Commands ──

    // New Chat
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.newChat', () => {
            vscode.commands.executeCommand('rovion-ai.chatView.focus');
        })
    );

    // Open Settings
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:rovion.rovion-ai');
        })
    );

    // Explain Selection
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.explainSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const selection = editor.document.getText(editor.selection);
            if (!selection.trim()) {
                vscode.window.showWarningMessage('코드를 먼저 선택하세요.');
                return;
            }
            const lang = editor.document.languageId;
            chatProvider?.insertText(`다음 ${lang} 코드를 설명해줘:\n\`\`\`${lang}\n${selection}\n\`\`\``);
            vscode.commands.executeCommand('rovion-ai.chatView.focus');
        })
    );

    // Show Brain Network (open brain dir in file explorer)
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.showBrainNetwork', () => {
            const brainDir = _getBrainDir();
            initBrainStructure();
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(brainDir));
            vscode.window.showInformationMessage(`🧠 두뇌 폴더: ${brainDir}`);
        })
    );

    // Change Company Dir
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.changeCompanyDir', async () => {
            const input = await vscode.window.showInputBox({
                prompt: '회사 폴더 경로를 입력하세요 (비워두면 기본값 사용)',
                placeHolder: '예: ~/Documents/MyCompany 또는 C:\\Users\\user\\MyCompany'
            });
            if (input !== undefined) {
                await vscode.workspace.getConfiguration(CONFIG_NAMESPACE).update(
                    'companyDir', input, vscode.ConfigurationTarget.Global
                );
                vscode.window.showInformationMessage(`🏢 회사 폴더 변경됨: ${input || '기본값'}`);
            }
        })
    );

    // Connect GitHub Repo
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.connectCompanyRepo', async () => {
            const token = await vscode.window.showInputBox({
                prompt: 'GitHub Personal Access Token을 입력하세요',
                password: true
            });
            if (!token) { return; }
            const repo = await vscode.window.showInputBox({
                prompt: 'GitHub 저장소 (username/repo)',
                placeHolder: 'rovion-inc/my-brain'
            });
            if (!repo) { return; }

            const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            await cfg.update('githubToken', token, vscode.ConfigurationTarget.Global);
            await cfg.update('githubRepo', repo, vscode.ConfigurationTarget.Global);
            await cfg.update('autoGitSync', true, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(`☁️ GitHub 연결됨: ${repo}`);
        })
    );

    // Diagnose Connection
    context.subscriptions.push(
        vscode.commands.registerCommand('rovionAi.diagnoseConnection', async () => {
            const models = await detectModels();
            if (models.length === 0) {
                vscode.window.showErrorMessage(
                    '❌ LLM 서버를 찾을 수 없습니다. Ollama 또는 LM Studio를 시작하세요.',
                    'Ollama 설치 안내'
                ).then(sel => {
                    if (sel) { vscode.env.openExternal(vscode.Uri.parse('https://ollama.ai')); }
                });
            } else {
                const names = models.map(m => `${m.engine}: ${m.name}`).join('\n');
                vscode.window.showInformationMessage(`✅ ${models.length}개 모델 감지됨:\n${names}`);
            }
        })
    );

    // Daily Briefing
    context.subscriptions.push(
        vscode.commands.registerCommand('rovionAi.dailyBriefing.fireNow', async () => {
            vscode.commands.executeCommand('rovion-ai.newChat');
            chatProvider?.insertText('오늘 Rovion Inc. 데일리 브리핑을 해줘. 할 일, 우선순위, 포커스 포인트를 정리해줘.');
        })
    );

    // Task commands
    context.subscriptions.push(
        vscode.commands.registerCommand('rovionAi.tasks.openTrackerJson', () => {
            const trackerPath = getTrackerPath();
            initBrainStructure();
            if (!fs.existsSync(trackerPath)) {
                saveTasks([]);
            }
            vscode.workspace.openTextDocument(trackerPath).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        })
    );

    // Google Calendar (placeholder)
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.connectGoogleCalendarWrite', () => {
            vscode.window.showInformationMessage('📅 Google Calendar 연동은 곧 출시됩니다!');
        })
    );

    // Skill: save last
    context.subscriptions.push(
        vscode.commands.registerCommand('rovionAi.skill.saveLast', async () => {
            const name = await vscode.window.showInputBox({
                prompt: '스킬 이름을 입력하세요',
                placeHolder: '예: 유튜브 제목 작성법'
            });
            if (name?.trim()) {
                vscode.window.showInformationMessage(`💎 스킬 저장 중: ${name}`);
            }
        })
    );

    // Developer: scaffold project
    context.subscriptions.push(
        vscode.commands.registerCommand('rovionAi.developer.scaffoldProject', async () => {
            const projectName = await vscode.window.showInputBox({
                prompt: '새 프로젝트 이름을 입력하세요',
                placeHolder: '예: my-landing-page'
            });
            if (!projectName?.trim()) { return; }

            const companyDir = getCompanyDir();
            const projectDir = path.join(companyDir, '20_Projects', projectName.trim());
            ensureDirExists(projectDir);

            const readmePath = path.join(projectDir, 'README.md');
            fs.writeFileSync(readmePath,
                `# ${projectName}\n\n> 생성: ${new Date().toLocaleString('ko-KR')}\n\n## 개요\n\n## 목표\n\n## 기술 스택\n\n## 진행 상황\n`
            );

            vscode.workspace.openTextDocument(readmePath).then(doc => {
                vscode.window.showTextDocument(doc);
            });
            vscode.window.showInformationMessage(`🚀 프로젝트 생성됨: ${projectName}`);
        })
    );

    // Focus chat
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.focusChat', () => {
            vscode.commands.executeCommand('rovion-ai.chatView.focus');
        })
    );

    // Export chat
    context.subscriptions.push(
        vscode.commands.registerCommand('rovion-ai.exportChat', async () => {
            vscode.window.showInformationMessage('채팅 내보내기는 채팅창의 위키 저장 버튼을 사용하세요.');
        })
    );

    // Daily briefing scheduler
    scheduleDailyBriefing(context);

    vscode.window.showInformationMessage(`⚡ ${BRAND_NAME} 활성화됨 — AI 1인 기업을 시작합니다!`);
    console.log(`[${BRAND_NAME}] Activated successfully.`);
}

// ─────────────────────────────────────────
// Daily Briefing Scheduler
// ─────────────────────────────────────────

function scheduleDailyBriefing(context: vscode.ExtensionContext) {
    const checkBriefing = () => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const hour = cfg.get<number>('dailyBriefingHour', 9);
        const now = new Date();

        if (now.getHours() === hour && now.getMinutes() === 0) {
            const lastBriefing = context.globalState.get<string>('lastBriefingDate', '');
            const today = now.toISOString().slice(0, 10);

            if (lastBriefing !== today) {
                context.globalState.update('lastBriefingDate', today);
                vscode.window.showInformationMessage(
                    `☀️ Rovion AI 데일리 브리핑 시간입니다!`,
                    '브리핑 시작'
                ).then(sel => {
                    if (sel) {
                        vscode.commands.executeCommand('rovionAi.dailyBriefing.fireNow');
                    }
                });
            }
        }
    };

    // Check every minute
    const interval = setInterval(checkBriefing, 60 * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

// ─────────────────────────────────────────
// Deactivation
// ─────────────────────────────────────────

export function deactivate() {
    console.log(`[${BRAND_NAME}] Deactivated.`);
}
