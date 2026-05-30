/* Rovion AI — 시스템 스펙 유틸리티
 * 로컬 머신의 사양 정보를 수집하여 에이전트 컨텍스트에 제공합니다.
 */

import * as os from 'os';
import * as child_process from 'child_process';

export interface SystemSpecs {
    platform: string;
    arch: string;
    cpus: number;
    totalMemoryGb: number;
    freeMemoryGb: number;
    hostname: string;
    homeDir: string;
    ollama?: string;
    lmStudio?: string;
}

export function getSystemSpecs(): SystemSpecs {
    const specs: SystemSpecs = {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
        freeMemoryGb: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10,
        hostname: os.hostname(),
        homeDir: os.homedir()
    };

    // Check Ollama
    try {
        const ollamaVer = child_process.execSync('ollama --version', { stdio: 'pipe', timeout: 3000 })
            .toString().trim();
        specs.ollama = ollamaVer;
    } catch { /* Ollama not installed */ }

    return specs;
}

export function formatSystemSpecs(specs: SystemSpecs): string {
    return [
        `OS: ${specs.platform} (${specs.arch})`,
        `CPU: ${specs.cpus} cores`,
        `RAM: ${specs.freeMemoryGb}GB free / ${specs.totalMemoryGb}GB total`,
        specs.ollama ? `Ollama: ${specs.ollama}` : 'Ollama: not detected',
        specs.lmStudio ? `LM Studio: ${specs.lmStudio}` : 'LM Studio: status unknown'
    ].join(' | ');
}
