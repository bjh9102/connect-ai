/* Rovion AI — 경로 유틸리티 모듈
 *
 * 두뇌 폴더(`~/.rovion-brain/`) 와 회사 폴더(`<brain>/_company/` 또는 detached path) 의
 * 위치를 결정하는 함수들.
 *
 * 의존: vscode 설정 읽기 (workspace.getConfiguration). settings.json 사용자 입력 우선.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export const COMPANY_SUBDIR = '_company';
export const BRAND_NAME = 'Rovion AI';
export const BRAIN_DIR_NAME = '.rovion-brain';
export const CONFIG_NAMESPACE = 'rovionAi';

/** Settings.json `rovionAi.localBrainPath` 입력 처리. ~/ 와 빈 문자열 케이스 정규화. */
export function _expandTilde(p: string): string {
    if (!p) { return ''; }
    const trimmed = p.trim();
    if (!trimmed) { return ''; }
    if (trimmed.startsWith('~/')) { return path.join(os.homedir(), trimmed.slice(2)); }
    if (trimmed === '~') { return os.homedir(); }
    return trimmed;
}

/** 사용자가 settings.json에 입력한 raw 경로 → 절대 경로.
 *  ~/ 정규화 + 절대 경로만 받음 (상대 경로는 surprise 방지로 거부 → 빈 문자열).
 *  빈 입력 / 잘못된 입력 모두 빈 문자열로 통일. */
export function _resolvePathInput(raw: string): string {
    let s = (raw || '').trim();
    if (!s) { return ''; }
    if (s.startsWith('~/') || s === '~') {
        s = s.replace(/^~/, os.homedir());
    }
    if (!path.isAbsolute(s)) { return ''; } // ignore non-absolute to avoid surprise
    return path.normalize(s);
}

/** 두뇌 폴더 위치 결정. settings.json `localBrainPath` 우선, 없으면 `~/.rovion-brain/`. */
export function _getBrainDir(): string {
    try {
        const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const raw = cfg.get<string>('localBrainPath', '') || '';
        const resolved = _resolvePathInput(raw);
        if (resolved) { return resolved; }
    } catch { /* config unavailable in some hot paths — fall through */ }
    return path.join(os.homedir(), BRAIN_DIR_NAME);
}

/** 사용자가 명시적으로 두뇌 폴더 경로를 설정했는지. */
export function _isBrainDirExplicitlySet(): boolean {
    try {
        const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const raw = cfg.get<string>('localBrainPath', '') || '';
        return !!raw.trim();
    } catch { return false; }
}

/** 회사 폴더 위치. settings.json `companyDir` 우선 (별도 위치). 없으면 `<brain>/_company/`. */
export function getCompanyDir(): string {
    try {
        const raw = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<string>('companyDir', '') || '';
        const resolved = _resolvePathInput(raw);
        if (resolved) { return resolved; }
    } catch { /* config unavailable in some hot paths — fall through */ }
    return path.join(_getBrainDir(), COMPANY_SUBDIR);
}

/** 스킬 저장 폴더: <brain>/🚀 Skills/ */
export function getSkillsDir(): string {
    return path.join(_getBrainDir(), '🚀 Skills');
}

/** 위키 폴더: <company>/10_Wiki/ */
export function getWikiDir(): string {
    return path.join(getCompanyDir(), '10_Wiki');
}

/** Raw 데이터 폴더: <company>/00_Raw/ */
export function getRawDir(): string {
    return path.join(getCompanyDir(), '00_Raw');
}

/** 트래커 파일 경로: <company>/tracker.json */
export function getTrackerPath(): string {
    return path.join(getCompanyDir(), 'tracker.json');
}
